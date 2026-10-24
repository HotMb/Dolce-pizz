import {env} from 'cloudflare:workers';
import {headers} from 'next/headers';
import {db} from './server';
export type Member={id:string;phone:string;name:string};
export class AuthError extends Error{constructor(public status:number,message:string){super(message);}}
const COOKIE='dolce_session',SESSION_DAYS=90,CODE_MINUTES=10,MAX_ATTEMPTS=5,RESEND_MS=60000,HOUR=3600000;
const vars=env as unknown as Record<string,string|undefined>;
const hex=(bytes:Uint8Array)=>Array.from(bytes,v=>v.toString(16).padStart(2,'0')).join('');
const sha256=async(s:string)=>hex(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s))));
// Only French mobiles (06/07): SMS codes are billed, this also blocks premium-rate and foreign SMS pumping.
export function normalizePhone(raw:string){const m=/^(?:\+33|0033|0)([67]\d{8})$/.exec(raw.replace(/[\s.\-()]/g,''));return m?`+33${m[1]}`:null;}
export const localPhone=(phone:string)=>`0${phone.slice(3)}`.replace(/(\d{2})(?=\d)/g,'$1 ');
const readCookie=(header:string|null)=>header?.split(/;\s*/).find(v=>v.startsWith(`${COOKIE}=`))?.slice(COOKIE.length+1)||'';
export async function sessionUser(cookieHeader:string|null):Promise<Member|null>{
 const token=readCookie(cookieHeader);if(!/^[0-9a-f]{64}$/.test(token))return null;
 return await db().prepare('SELECT u.id,u.phone,u.name FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id=? AND s.expires_at>?').bind(await sha256(token),Date.now()).first<Member>();
}
export async function currentUser(){return sessionUser((await headers()).get('cookie'));}
export const sessionCookie=(token:string,secure:boolean)=>`${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${token?SESSION_DAYS*86400:0}${secure?'; Secure':''}`;
export async function endSession(cookieHeader:string|null){const token=readCookie(cookieHeader);if(token)await db().prepare('DELETE FROM sessions WHERE id=?').bind(await sha256(token)).run();}
export async function underLimit(key:string,limit:number){
 const now=Date.now();
 const r=await db().prepare('INSERT INTO rate_limits(key,count,window_start) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN window_start<? THEN 1 ELSE count+1 END,window_start=CASE WHEN window_start<? THEN excluded.window_start ELSE window_start END RETURNING count').bind(key,now,now-HOUR,now-HOUR).first<{count:number}>();
 return (r?.count||0)<=limit;
}
export async function sendCode(phone:string,ip:string,local:boolean):Promise<{devCode?:string}>{
 const now=Date.now();
 const key=vars.BREVO_API_KEY;
 // Hosted authentication always needs a real SMS provider. Demo flags must never reveal hosted OTPs.
 if(!key&&!local)throw new AuthError(503,'L’envoi des SMS n’est pas encore configuré. Appelez la pizzeria pour commander.');
 const last=await db().prepare('SELECT created_at FROM otp_codes WHERE phone=?').bind(phone).first<{created_at:number}>();
 if(last&&now-last.created_at<RESEND_MS)throw new AuthError(429,`Patientez ${Math.ceil((RESEND_MS-(now-last.created_at))/1000)} s avant de demander un nouveau code.`);
 // Local previews share one loopback address between phones; hosted SMS gets the tighter limit.
 if(!await underLimit(`phone:${phone}`,5)||!await underLimit(`ip:${ip}`,local?60:10))throw new AuthError(429,'Trop de demandes de code. Réessayez dans une heure ou appelez la pizzeria.');
 const code=String(crypto.getRandomValues(new Uint32Array(1))[0]%1000000).padStart(6,'0');
 await db().batch([
  db().prepare('DELETE FROM otp_codes WHERE expires_at<?').bind(now),
  db().prepare('DELETE FROM sessions WHERE expires_at<?').bind(now),
  db().prepare('DELETE FROM rate_limits WHERE window_start<?').bind(now-HOUR),
  db().prepare('INSERT INTO otp_codes(phone,code_hash,expires_at,attempts,created_at) VALUES(?,?,?,0,?) ON CONFLICT(phone) DO UPDATE SET code_hash=excluded.code_hash,expires_at=excluded.expires_at,attempts=0,created_at=excluded.created_at').bind(phone,await sha256(`${phone}:${code}`),now+CODE_MINUTES*60000,now)
 ]);
 if(!key){
  // Only a loopback development request may display an OTP when no SMS account is configured.
  if(local){return {devCode:code};}
  throw new AuthError(503,'L’envoi des SMS n’est pas encore configuré. Appelez la pizzeria pour commander.');
 }
 // Forget the unsent code so the customer can retry at once instead of waiting for the resend delay.
 if(!await sendSms(phone,`Dolce Pizz' : votre code de connexion est ${code}. Il expire dans ${CODE_MINUTES} minutes.`,'transactional','connexion')){await db().prepare('DELETE FROM otp_codes WHERE phone=? AND code_hash=?').bind(phone,await sha256(`${phone}:${code}`)).run();throw new AuthError(503,'Le SMS n’a pas pu être envoyé. Réessayez dans un instant.');}
 return {};
}
export async function verifyCode(phone:string,code:string){
 const row=await db().prepare('SELECT code_hash,expires_at,attempts FROM otp_codes WHERE phone=?').bind(phone).first<{code_hash:string;expires_at:number;attempts:number}>();
 if(!row||row.expires_at<Date.now())throw new AuthError(400,'Ce code a expiré. Demandez-en un nouveau.');
 const counted=await db().prepare('UPDATE otp_codes SET attempts=attempts+1 WHERE phone=? AND code_hash=? AND expires_at>? AND attempts<? RETURNING attempts').bind(phone,row.code_hash,Date.now(),MAX_ATTEMPTS).first<{attempts:number}>();
 if(!counted)throw new AuthError(429,'Trop d’essais. Demandez un nouveau code.');
 const hash=await sha256(`${phone}:${code}`);
 if(hash!==row.code_hash){const left=MAX_ATTEMPTS-counted.attempts;throw new AuthError(400,left>0?`Code incorrect. Il vous reste ${left} essai${left>1?'s':''}.`:'Code incorrect. Demandez un nouveau code.');}
 const used=await db().prepare('DELETE FROM otp_codes WHERE phone=? AND code_hash=? AND expires_at>?').bind(phone,hash,Date.now()).run();
 if(!used.meta.changes)throw new AuthError(400,'Ce code a déjà été utilisé. Demandez-en un nouveau.');
 await db().prepare("INSERT INTO users(id,phone,name,created_at) VALUES(?,?,'',?) ON CONFLICT(phone) DO NOTHING").bind(crypto.randomUUID(),phone,new Date().toISOString()).run();
 const user=await db().prepare('SELECT id,phone,name FROM users WHERE phone=?').bind(phone).first<Member>();if(!user)throw new Error('User unavailable');
 const token=hex(crypto.getRandomValues(new Uint8Array(32)));
 await db().prepare('INSERT INTO sessions(id,user_id,expires_at,created_at) VALUES(?,?,?,?)').bind(await sha256(token),user.id,Date.now()+SESSION_DAYS*86400000,new Date().toISOString()).run();
 return {user,token};
}
/** 'live' sends through Brevo; 'demo' (local preview or SMS_CAMPAIGNS_DEMO=1) only simulates; 'off' cannot send. */
export const smsMode=(local:boolean)=>vars.BREVO_API_KEY?'live':local||vars.SMS_CAMPAIGNS_DEMO==='1'?'demo':'off';
export type SmsProviderResult={accepted:boolean;outcome:'accepted'|'rejected'|'unknown';providerMessageId?:string};
export async function sendSmsDetailed(phone:string,content:string,type:'transactional'|'marketing',tag:string):Promise<SmsProviderResult>{
 const r=await fetch('https://api.brevo.com/v3/transactionalSMS/send',{method:'POST',headers:{'api-key':vars.BREVO_API_KEY||'','content-type':'application/json',accept:'application/json'},body:JSON.stringify({sender:vars.SMS_SENDER||'DolcePizz',recipient:phone.slice(1),content,type,tag}),signal:AbortSignal.timeout(12000)}).catch(()=>null);
 if(!r)return {accepted:false,outcome:'unknown'};
 if(!r.ok){console.error('Brevo SMS error',r.status);return {accepted:false,outcome:r.status===408||r.status===425||r.status===429||r.status>=500?'unknown':'rejected'};}
 let providerMessageId='';try{const body=await r.json() as {messageId?:unknown};if(typeof body.messageId==='string'||typeof body.messageId==='number')providerMessageId=String(body.messageId).slice(0,160);}catch{return {accepted:false,outcome:'unknown'};}
 return providerMessageId?{accepted:true,outcome:'accepted',providerMessageId}:{accepted:false,outcome:'unknown'};
}
export async function sendSms(phone:string,content:string,type:'transactional'|'marketing',tag:string){return (await sendSmsDetailed(phone,content,type,tag)).accepted;}
