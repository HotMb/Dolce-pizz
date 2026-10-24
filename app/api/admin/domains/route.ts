import {env} from 'cloudflare:workers';
import {NextResponse} from 'next/server';
import {z} from 'zod';
import {db} from '@/lib/server';
import {sessionUser,underLimit} from '@/lib/auth';

export const dynamic='force-dynamic';
const json=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'no-store'}});
class ApiError extends Error{constructor(public status:number,message:string){super(message);}}
const id=z.string().trim().regex(/^[a-z0-9][a-z0-9_-]{1,63}$/);
const host=z.string().trim().toLowerCase().regex(/^(?=.{1,253}$)(?!localhost$)(?!.*\.dolcepizza\.workers\.dev$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/,'Indiquez un domaine public valide.');
const createInput=z.object({action:z.literal('create'),organizationId:id,locationId:id,host}).strict();
const verifyInput=z.object({action:z.literal('verify'),organizationId:id,host,token:z.string().trim().regex(/^[a-f0-9]{64}$/)}).strict();
const owner=async(userId:string,organizationId:string)=>!!await db().prepare("SELECT 1 FROM organization_memberships WHERE organization_id=? AND principal_id=? AND role='owner' AND location_id IS NULL AND status='active'").bind(organizationId,userId).first();
const hash=async(value:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),v=>v.toString(16).padStart(2,'0')).join('');
const token=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),v=>v.toString(16).padStart(2,'0')).join('');
const dnsTxt=async(domain:string)=>{
 const response=await fetch(`https://dns.google/resolve?name=_dolce-verify.${encodeURIComponent(domain)}&type=TXT`,{headers:{accept:'application/dns-json'},signal:AbortSignal.timeout(5000)});
 if(!response.ok)return [];
 const body=await response.json() as {Answer?:Array<{type?:number;data?:string}>};
 return (body.Answer||[]).filter(answer=>answer.type===16&&typeof answer.data==='string').map(answer=>answer.data!.replace(/^"|"$/g,'').replaceAll('"',''));
};

/** Register a domain and verify ownership with a DNS TXT record before public activation. */
export async function GET(request:Request){
 try{
  const user=await sessionUser(request.headers.get('cookie'));if(!user)throw new ApiError(401,'Connectez-vous avant de gérer les domaines.');
  const organizationId=new URL(request.url).searchParams.get('organizationId')||'';if(!id.safeParse(organizationId).success||!await owner(user.id,organizationId))throw new ApiError(403,'Cette action est réservée au propriétaire de l’enseigne.');
  const rows=await db().prepare('SELECT host,organization_id,location_id,status,created_at,verified_at FROM tenant_domains WHERE organization_id=? ORDER BY created_at DESC').bind(organizationId).all();return json({domains:rows.results});
 }catch(error){if(error instanceof ApiError)return json({error:error.message},error.status);return json({error:'Impossible de charger les domaines.'},503);}
}
export async function POST(request:Request){
 try{
  const url=new URL(request.url),origin=request.headers.get('origin');if(!origin||origin!==url.origin)throw new ApiError(403,'Cette demande doit être envoyée depuis le site.');
  const user=await sessionUser(request.headers.get('cookie'));if(!user)throw new ApiError(401,'Connectez-vous avant de gérer les domaines.');
  const ip=request.headers.get('cf-connecting-ip')||'local';if(!await underLimit(`domains:${user.id}:${ip}`,10))throw new ApiError(429,'Trop de tentatives. Réessayez plus tard.');
  const raw=await request.text();if(raw.length>8000)throw new ApiError(413,'La demande est trop volumineuse.');let parsed:unknown;try{parsed=JSON.parse(raw);}catch{throw new ApiError(400,'La demande est illisible.');}
  if(typeof parsed!=='object'||!parsed)throw new ApiError(400,'Vérifiez les informations.');
  if((parsed as {action?:string}).action==='create'){
   const input=createInput.parse(parsed);if(!await owner(user.id,input.organizationId))throw new ApiError(403,'Cette action est réservée au propriétaire de l’enseigne.');
   const location=await db().prepare("SELECT 1 FROM locations l JOIN organizations o ON o.id=l.organization_id AND o.status='active' WHERE l.organization_id=? AND l.id=? AND l.status='active'").bind(input.organizationId,input.locationId).first();if(!location)throw new ApiError(400,'Cet établissement est introuvable ou inactif.');
   const verificationToken=token(),now=new Date().toISOString();try{await db().prepare('INSERT INTO tenant_domains(host,organization_id,location_id,verification_token_hash,status,created_by,created_at) VALUES(?,?,?,? ,\'pending\',?,?)').bind(input.host,input.organizationId,input.locationId,await hash(verificationToken),user.id,now).run();}catch{throw new ApiError(409,'Ce domaine est déjà enregistré.');}
   return json({domain:{host:input.host,organizationId:input.organizationId,locationId:input.locationId,status:'pending'},dns:{type:'TXT',name:`_dolce-verify.${input.host}`,value:verificationToken},message:'Ajoutez cet enregistrement TXT puis demandez la vérification.'},201);
  }
  const input=verifyInput.parse(parsed);if(!await owner(user.id,input.organizationId))throw new ApiError(403,'Cette action est réservée au propriétaire de l’enseigne.');
  const row=await db().prepare('SELECT verification_token_hash,status FROM tenant_domains WHERE host=? AND organization_id=?').bind(input.host,input.organizationId).first<{verification_token_hash:string;status:string}>();if(!row)throw new ApiError(404,'Domaine introuvable.');
  if(row.verification_token_hash!==await hash(input.token))throw new ApiError(403,'Le jeton de vérification est incorrect.');
  if(!(await dnsTxt(input.host)).includes(input.token))throw new ApiError(409,'L’enregistrement DNS TXT n’est pas encore visible.');
  const now=new Date().toISOString();await db().prepare("UPDATE tenant_domains SET status='verified',verified_at=? WHERE host=? AND organization_id=? AND status='pending'").bind(now,input.host,input.organizationId).run();return json({domain:{host:input.host,status:'verified',verifiedAt:now}});
 }catch(error){if(error instanceof z.ZodError)return json({error:error.issues[0]?.message||'Vérifiez les informations.'},400);if(error instanceof ApiError)return json({error:error.message},error.status);console.error('Tenant domain error',error instanceof Error?error.message:'unknown');return json({error:'La gestion du domaine a échoué.'},503);}
}
