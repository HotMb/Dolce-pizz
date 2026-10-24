import {NextResponse} from 'next/server';
import {env} from 'cloudflare:workers';
import {z} from 'zod';
import {db,ensureSeed,settings,productList,ingredientList,menu,balance,isAdmin,orderView,secret,marketingStopSecret,insertProduct,toProduct,toIngredient} from '@/lib/server';
import {sessionUser,sendCode,verifyCode,sessionCookie,endSession,normalizePhone,localPhone,AuthError,underLimit,smsMode,sendSmsDetailed} from '@/lib/auth';
import {slots,allowedSlot,nextStatus,parisParts} from '@/lib/rules';
import {priceCart} from '@/lib/pricing';
import {categories,type Product} from '@/lib/catalog';
import {allergenIds,describe,slugify} from '@/lib/menu';
import {snapshotPricedLines} from '@/lib/production-repository';
import {createMarketingStopProof,matchesMarketingStopProof} from '@/lib/marketing-stop';
import {loadStaffScope} from '@/lib/staff-access';
import {resolveTenant} from '@/lib/tenant';
export const dynamic='force-dynamic';
const json=(data:unknown,status=200,cookie?:string)=>{const r=NextResponse.json(data,{status,headers:{'Cache-Control':'no-store'}});if(cookie)r.headers.append('Set-Cookie',cookie);return r;};
class HttpError extends Error{constructor(public status:number,message:string){super(message);}}
function fail(status:number,message:string):never{throw new HttpError(status,message);}
const clean=z.string().trim();
const mobile=(raw:string)=>normalizePhone(raw)??fail(400,'Indiquez un numéro de mobile français (06 ou 07).');
const PILOT_ORGANIZATION_ID='dolce-pizza',PILOT_LOCATION_ID='ronchin';
const ids=z.array(clean.max(80)).max(20).optional();
const STOP_COOKIE='dolce_stop_proof';
async function marketingStopProof(organizationId:string,phone:string){
 const key=marketingStopSecret();if(!key)fail(503,'La désinscription SMS n’est pas configurée. Réessayez plus tard.');
 // A 128-bit HMAC tag is opaque and sufficient for an unguessable, recipient-bound proof.
 return createMarketingStopProof(organizationId,phone,key);
}
type CustomerProfile={name:string;marketing:number;marketing_at:string;marketing_source:string};
const customerProfile=(organizationId:string,userId:string)=>db().prepare('SELECT name,marketing,marketing_at,marketing_source FROM customer_profiles WHERE organization_id=? AND user_id=?').bind(organizationId,userId).first<CustomerProfile>();
async function canManagePilot(userId:string,organizationId=PILOT_ORGANIZATION_ID,locationId=PILOT_LOCATION_ID){const scope=await loadStaffScope(db(),userId,{organizationId,locationId});return !!scope&&scope.roles.some(role=>role==='owner'||role==='manager');}
const campaignOwnerGuardSql=`EXISTS(
 SELECT 1 FROM organization_memberships m JOIN organizations o ON o.id=m.organization_id AND o.status='active'
 WHERE m.organization_id=? AND m.principal_id=? AND m.role='owner' AND m.status='active' AND m.location_id IS NULL
)`;
async function isCampaignOwner(userId:string,organizationId:string){
 const owner=await db().prepare(`SELECT 1 FROM organization_memberships m JOIN organizations o ON o.id=m.organization_id AND o.status='active' WHERE m.organization_id=? AND m.principal_id=? AND m.role='owner' AND m.status='active' AND m.location_id IS NULL`).bind(organizationId,userId).first();
 return !!owner;
}
async function requireCampaignOwner(userId:string,organizationId:string){
 if(!await isCampaignOwner(userId,organizationId))fail(403,'Les campagnes de l’enseigne sont réservées à son propriétaire.');
}
const stopProofCookie=(token:string,secure:boolean,maxAge=1800)=>`${STOP_COOKIE}=${token}; Path=/api/marketing/stop; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure?'; Secure':''}`;
const stopProofFromCookie=(header:string|null)=>header?.split(/;\s*/).find(v=>v.startsWith(`${STOP_COOKIE}=`))?.slice(STOP_COOKIE.length+1)||'';
const orderSlot=z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{3})?)?Z$/,'Choisissez un créneau valide.').refine(value=>Number.isFinite(Date.parse(value)),'Choisissez un créneau valide.');
const orderInput=z.object({key:z.string().uuid(),name:clean.min(2,'Indiquez votre nom.').max(80),note:clean.max(500).default(''),slot:orderSlot,ticket:z.boolean(),items:z.array(z.object({id:clean.max(80),size:z.enum(['senior','xxl','unique']),quantity:z.number().int().min(1).max(20),option:clean.max(80).default(''),freeId:clean.max(80).optional(),freeOption:clean.max(80).default(''),removed:ids,added:ids,freeRemoved:ids,freeAdded:ids})).min(1).max(40)});
const settingsInput=z.object({enabled:z.boolean(),hoursConfirmed:z.boolean(),leadMinutes:z.number().int().min(15).max(180),cutoffMinutes:z.number().int().min(0).max(120),capacity:z.number().int().min(1).max(30),hours:z.array(z.object({open:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),close:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),closed:z.boolean()})).length(7),closures:z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).max(365),loyaltyEnabled:z.boolean(),pointsPerEuro:z.number().int().min(1).max(10),rewardPoints:z.number().int().min(10).max(10000),extraPrice:z.number().int().min(0,'Le prix d’un supplément ne peut pas être négatif.').max(1000,'Un supplément coûte 10 € au maximum.'),version:z.number().int().positive()});
const allergen=z.enum(allergenIds as [string,...string[]]);
const productFields=z.object({name:clean.min(2,'Indiquez le nom.').max(60,'60 caractères maximum pour le nom.'),category:z.enum(categories.map(c=>c.id) as [string,...string[]]),description:clean.max(300),tagline:clean.max(80),price:z.number().int().min(1,'Indiquez un prix.').max(10000),xxl:z.number().int().min(1).max(10000).nullable(),ingredients:z.array(clean.max(80)).max(20,'20 ingrédients maximum.'),allergens:z.array(allergen).max(14),allergensChecked:z.boolean(),options:z.array(clean.min(1).max(40)).max(8),spicy:z.boolean(),offer:z.boolean(),available:z.boolean(),status:z.enum(['published','draft','archived'])});
const ingredientFields=z.object({name:clean.min(2,'Indiquez le nom de l’ingrédient.').max(40),allergens:z.array(allergen).max(14),meat:z.enum(['','boeuf','porc','volaille','agneau']),origin:clean.max(80),extra:z.boolean(),available:z.boolean()});
const MAX_PHOTO=1900000;
async function handler(request:Request){
 try{
  const url=new URL(request.url);const path=url.pathname.slice(5).split('/'); const method=request.method;
  let tenant=resolveTenant(request,(env as unknown as Record<string,string|undefined>).TENANT_HOSTS_JSON||'');
  if(!tenant){const host=url.hostname.toLowerCase();const row=await db().prepare("SELECT organization_id,location_id FROM tenant_domains WHERE host=? AND status='verified'").bind(host).first<{organization_id:string;location_id:string}>();if(row)tenant={organizationId:row.organization_id,locationId:row.location_id,host};}
  if(!tenant)fail(404,'Cette enseigne n’est pas configurée pour ce domaine.');
  const PILOT_ORGANIZATION_ID=tenant.organizationId,PILOT_LOCATION_ID=tenant.locationId;
  if(path[0]==='photos'&&method==='GET')return await photo(request,path[1],path[2],Number(path[3]),PILOT_ORGANIZATION_ID);
  // Photos arrive already cut out and compressed by the tablet: 3 WebP files, under 2 MB each.
  const upload=method==='POST'&&path[0]==='admin'&&path[1]==='products'&&path[3]==='photo';
  if(method!=='GET'){
   const origin=request.headers.get('origin');if(!origin||origin!==url.origin)fail(403,'Cette demande doit être envoyée depuis le site.');
   if(Number(request.headers.get('content-length')||0)>(upload?3*MAX_PHOTO+20000:35000))fail(413,'La demande est trop volumineuse.');
  }
  await ensureSeed();
  const cookie=request.headers.get('cookie');const user=await sessionUser(cookie);const secure=url.protocol==='https:';
  const local=['localhost','127.0.0.1','[::1]'].includes(url.hostname);const ip=request.headers.get('cf-connecting-ip')||'local';
  const body=async()=>{const text=await request.text();if(text.length>35000)fail(413,'La demande est trop volumineuse.');try{return JSON.parse(text);}catch{fail(400,'Vérifiez les informations envoyées.');}};
  if(path[0]==='auth'&&method==='POST'){
   if(path[1]==='code'){const phone=mobile(z.object({phone:clean.max(30)}).parse(await body()).phone);return json({phone:localPhone(phone),...await sendCode(phone,ip,local)});}
   if(path[1]==='verify'){const input=z.object({phone:clean.max(30),code:clean.regex(/^\d{6}$/,'Saisissez les 6 chiffres reçus par SMS.')}).parse(await body());const{user:member,token}=await verifyCode(mobile(input.phone),input.code);const profile=await customerProfile(PILOT_ORGANIZATION_ID,member.id);return json({user:{name:profile?.name||'',phone:localPhone(member.phone)}},200,sessionCookie(token,secure));}
   if(path[1]==='logout'){await endSession(cookie);return json({ok:true},200,sessionCookie('',secure));}
  }
  if(path[0]==='catalog'&&method==='GET'){const m=await menu(PILOT_ORGANIZATION_ID,PILOT_LOCATION_ID);return json(m);}
  // The SMS link carries a signed, opaque proof; this short-lived cookie lets the existing form confirm the recipient's phone.
  if(path[0]==='marketing'&&path[1]==='stop'&&method==='GET'){
   const token=url.searchParams.get('token')||'';const response=NextResponse.redirect(new URL('/stop',url),303);
   response.headers.set('Cache-Control','no-store');response.headers.set('Referrer-Policy','no-referrer');
   if(/^[A-Za-z0-9_-]{22}$/.test(token))response.headers.append('Set-Cookie',stopProofCookie(token,secure));
   return response;
  }
  // Unsubscribing needs no account login; the signed link proves the caller has the recipient-specific SMS link.
  if(path[0]==='marketing'&&path[1]==='stop'&&method==='POST'){
   const phone=mobile(z.object({phone:clean.max(30)}).parse(await body()).phone);
   if(!await underLimit(`stop:${PILOT_ORGANIZATION_ID}:${ip}`,20))fail(429,'Trop de demandes. Réessayez dans une heure ou appelez la pizzeria.');
   const supplied=stopProofFromCookie(cookie);const key=marketingStopSecret();
   if(!key)fail(503,'La désinscription SMS n’est pas configurée. Réessayez plus tard.');
   if(!await matchesMarketingStopProof(PILOT_ORGANIZATION_ID,phone,key,supplied))fail(403,'Ouvrez le lien de désinscription reçu par SMS et saisissez le numéro associé.');
   const now=new Date().toISOString();const eventId=crypto.randomUUID();
   await db().batch([
    db().prepare("INSERT INTO marketing_consent_events(id,organization_id,user_id,marketing,source,actor,occurred_at) SELECT ?,p.organization_id,p.user_id,0,'stop','stop_link',? FROM customer_profiles p JOIN users u ON u.id=p.user_id WHERE p.organization_id=? AND u.phone=? AND p.marketing=1").bind(eventId,now,PILOT_ORGANIZATION_ID,phone),
    db().prepare("UPDATE customer_profiles SET marketing=0,marketing_at=?,marketing_source='stop',updated_at=? WHERE organization_id=? AND user_id=(SELECT id FROM users WHERE phone=?) AND marketing=1").bind(now,now,PILOT_ORGANIZATION_ID,phone)
   ]);
   return json({ok:true},200,stopProofCookie('',secure,0));
  }
  if(path[0]==='slots'&&method==='GET'){
   const active=await db().prepare("SELECT l.id FROM locations l JOIN organizations o ON o.id=l.organization_id AND o.status='active' WHERE l.organization_id=? AND l.id=? AND l.status='active'").bind(PILOT_ORGANIZATION_ID,PILOT_LOCATION_ID).first();
   if(!active)return json({slots:[],settings:await settings(PILOT_ORGANIZATION_ID,PILOT_LOCATION_ID)});
   const s=await settings(PILOT_ORGANIZATION_ID,PILOT_LOCATION_ID);const r=await db().prepare("SELECT substr(slot,1,16)||':00.000Z' AS slot,COUNT(*) AS n FROM orders WHERE organization_id=? AND location_id=? AND status NOT IN ('rejected','cancelled') AND substr(slot,1,16)||':00.000Z'>? GROUP BY substr(slot,1,16)||':00.000Z'").bind(PILOT_ORGANIZATION_ID,PILOT_LOCATION_ID,new Date().toISOString()).all<{slot:string;n:number}>();
   return json({slots:slots(s,Object.fromEntries(r.results.map(v=>[v.slot,v.n]))),settings:s});
  }
  if(path[0]==='me'&&method==='GET'){
   const s=await settings(PILOT_ORGANIZATION_ID,PILOT_LOCATION_ID);const loyalty={enabled:s.loyaltyEnabled,pointsPerEuro:s.pointsPerEuro,rewardPoints:s.rewardPoints};
   if(!user)return json({user:null,admin:false,balance:0,orders:[],loyalty});
   // Staff-entered orders share the employee's account id for attribution, but are not customer orders.
   const rows=await db().prepare("SELECT * FROM orders WHERE organization_id=? AND customer_user_id=? AND channel='web' ORDER BY created_at DESC LIMIT 100").bind(PILOT_ORGANIZATION_ID,user.id).all();
   const profile=await customerProfile(PILOT_ORGANIZATION_ID,user.id);
   return json({user:{name:profile?.name||'',phone:localPhone(user.phone),marketing:!!profile?.marketing},admin:await canManagePilot(user.id,PILOT_ORGANIZATION_ID,PILOT_LOCATION_ID),campaignAdmin:await isCampaignOwner(user.id,PILOT_ORGANIZATION_ID),balance:await balance(PILOT_ORGANIZATION_ID,user.id),orders:rows.results.map(orderView),loyalty});
  }
  if(!user)fail(401,'Connectez-vous pour continuer.');
  const actor=user.id;
  if(path[0]==='me'&&method==='PATCH'){
   // The route determines the legal evidence source. Client-supplied labels are ignored.
   const input=z.object({name:clean.min(2,'Indiquez votre nom.').max(80).optional(),marketing:z.boolean().optional()}).parse(await body());
   const previous=await customerProfile(PILOT_ORGANIZATION_ID,actor);const now=new Date().toISOString();
   const name=input.name??previous?.name??'';const statements:D1PreparedStatement[]=[
    db().prepare("INSERT INTO customer_profiles(organization_id,user_id,name,marketing,marketing_at,marketing_source,created_at,updated_at) SELECT ?,id,?,0,'','',?,? FROM users WHERE id=? ON CONFLICT(organization_id,user_id) DO UPDATE SET name=excluded.name,updated_at=excluded.updated_at").bind(PILOT_ORGANIZATION_ID,name,now,now,actor)
   ];
   // Consent changes are tenant-scoped and append an immutable proof event.
   if(input.marketing!==undefined&&(!previous||!!previous.marketing!==input.marketing)){
    const source=input.marketing?(previous?'compte':'inscription'):'compte';
    statements.push(db().prepare('UPDATE customer_profiles SET marketing=?,marketing_at=?,marketing_source=?,updated_at=? WHERE organization_id=? AND user_id=?').bind(input.marketing?1:0,now,source,now,PILOT_ORGANIZATION_ID,actor));
    statements.push(db().prepare('INSERT INTO marketing_consent_events(id,organization_id,user_id,marketing,source,actor,occurred_at) VALUES(?,?,?,?,?,?,?)').bind(crypto.randomUUID(),PILOT_ORGANIZATION_ID,actor,input.marketing?1:0,source,'self',now));
   }
   await db().batch(statements);
   return json({ok:true});
  }
  if(path[0]==='me'&&method==='DELETE'){
   const origin=request.headers.get('origin');if(!origin||origin!==url.origin)fail(403,'Cette demande doit être envoyée depuis le site.');
   const now=new Date().toISOString();
   await db().batch([
    db().prepare("INSERT INTO marketing_consent_events(id,organization_id,user_id,marketing,source,actor,occurred_at) SELECT ?,organization_id,user_id,0,'compte','self_delete',? FROM customer_profiles WHERE organization_id=? AND user_id=? AND marketing=1").bind(crypto.randomUUID(),now,PILOT_ORGANIZATION_ID,actor),
    db().prepare("UPDATE customer_profiles SET name='',marketing=0,marketing_at=?,marketing_source='compte',updated_at=? WHERE organization_id=? AND user_id=?").bind(now,now,PILOT_ORGANIZATION_ID,actor),
    db().prepare("UPDATE orders SET name='Client anonymisé',phone='',email='',notification_phone='',notification_phone_basis='none',notification_phone_captured_at=NULL,updated_at=?,version=version+1 WHERE organization_id=? AND customer_user_id=? AND channel='web'").bind(now,PILOT_ORGANIZATION_ID,actor),
   ]);
   return json({ok:true,deleted:true});
  }
  if(path[0]==='orders'&&method==='POST'&&!path[1]){
   const input=orderInput.parse(await body());
   const previous=await db().prepare("SELECT * FROM orders WHERE organization_id=? AND location_id=? AND user_id=? AND idempotency=? AND channel='web'").bind(PILOT_ORGANIZATION_ID,PILOT_LOCATION_ID,actor,input.key).first();
   if(previous)return json({order:orderView(previous)});
   // This public web flow is currently configured for the verified Ronchin pickup site.
   // Never create a new unscoped order or silently route to the unconfigured Tourcoing site.
   const organizationId=PILOT_ORGANIZATION_ID,locationId=PILOT_LOCATION_ID;
   const location=await db().prepare("SELECT l.id FROM locations l JOIN organizations o ON o.id=l.organization_id AND o.status='active' WHERE l.id=? AND l.organization_id=? AND l.status='active'").bind(locationId,organizationId).first();
   if(!location)fail(503,'La prise de commande pour le retrait à Ronchin est momentanément indisponible.');
   const s=await settings(organizationId,locationId);
   if(!s.hoursConfirmed)fail(409,'Les horaires de retrait doivent encore être confirmés par la pizzeria.');
   const slotMs=Date.parse(input.slot);
   if(!Number.isFinite(slotMs))fail(400,'Choisissez un créneau valide.');
   const slot=new Date(slotMs).toISOString();
   if(!allowedSlot(slotMs,s))fail(409,'Ce créneau n’est plus disponible. Choisissez un autre horaire.');
   const [products,ingredients]=await Promise.all([productList(false,organizationId,locationId),ingredientList(organizationId)]);
   const priced=priceCart(input.items,{products,ingredients,extraPrice:s.extraPrice},input.ticket);
   if(priced.problem)fail(409,priced.problem);
   if(priced.count>30)fail(400,'Pour plus de 30 articles, appelez la pizzeria.');
   if(input.ticket&&!s.loyaltyEnabled)fail(409,'La fidélité n’est pas encore activée.');
   if(input.ticket&&priced.ticketLine<0)fail(409,'Le ticket pizza offerte s’utilise sur une pizza hors offre « 2e pizza offerte ».');
   const items=snapshotPricedLines(priced.lines,products,ingredients).map((line,i)=>({...line,...(i===priced.ticketLine?{ticket:true}:{})}));
   const redeemed=input.ticket?s.rewardPoints:0;const earned=s.loyaltyEnabled?Math.floor(priced.total/100)*s.pointsPerEuro:0;
   const id=crypto.randomUUID();const now=new Date().toISOString();
   await db().prepare("INSERT INTO customer_profiles(organization_id,user_id,name,marketing,marketing_at,marketing_source,created_at,updated_at) SELECT ?,id,?,0,'','',?,? FROM users WHERE id=? ON CONFLICT(organization_id,user_id) DO UPDATE SET name=excluded.name,updated_at=excluded.updated_at").bind(organizationId,input.name,now,now,actor).run();
   const result=await db().batch([
    db().prepare("INSERT INTO orders(id,user_id,customer_user_id,idempotency,name,phone,email,items,note,slot,subtotal,offer_discount,discount,total,redeemed,earned,status,organization_id,location_id,channel,fulfillment,payment_status,payment_method,notification_phone,notification_phone_basis,notification_phone_captured_at,created_at,updated_at,version) SELECT ?,?,?,?,? ,?,'',?,?,?,?,?,?,?,?,?,'pending',?,?,?,'pickup','due_at_pickup',NULL,?,'account_otp',?,?,?,1 WHERE EXISTS(SELECT 1 FROM locations l JOIN organizations o ON o.id=l.organization_id AND o.status='active' WHERE l.organization_id=? AND l.id=? AND l.status='active') AND COALESCE((SELECT version FROM location_config WHERE organization_id=? AND location_id=?),(SELECT version FROM config WHERE organization_id=?))=? AND (SELECT COUNT(*) FROM orders WHERE organization_id=? AND location_id=? AND substr(slot,1,16)||':00.000Z'=? AND status NOT IN ('rejected','cancelled'))<? AND (SELECT COALESCE(SUM(delta),0) FROM ledger WHERE organization_id=? AND user_id=?)>=? AND (SELECT COUNT(*) FROM orders WHERE organization_id=? AND customer_user_id=? AND channel='web' AND status='pending')<5 ON CONFLICT(organization_id,location_id,user_id,idempotency) DO NOTHING").bind(id,actor,actor,input.key,input.name,localPhone(user.phone),JSON.stringify(items),input.note,slot,priced.subtotal,priced.offer,priced.ticketDiscount,priced.total,redeemed,earned,organizationId,locationId,'web',user.phone,now,now,now,organizationId,locationId,organizationId,locationId,organizationId,s.version,organizationId,locationId,slot,s.capacity,organizationId,actor,redeemed,organizationId,actor),
    db().prepare("INSERT OR IGNORE INTO ledger(id,organization_id,user_id,order_id,delta,kind,created_at) SELECT ?,organization_id,customer_user_id,id,-redeemed,'redemption',? FROM orders WHERE id=? AND organization_id=? AND location_id=? AND customer_user_id IS NOT NULL AND redeemed>0").bind(`${id}:redemption`,now,id,organizationId,locationId),
    db().prepare("INSERT OR IGNORE INTO events(id,order_id,status,actor,note,created_at) SELECT ?,id,'pending',?,'Commande envoyée',? FROM orders WHERE id=? AND organization_id=? AND location_id=?").bind(`${id}:1`,actor,now,id,organizationId,locationId)
   ]);
   if(!result[0].meta.changes){const repeat=await db().prepare("SELECT * FROM orders WHERE organization_id=? AND location_id=? AND user_id=? AND idempotency=? AND channel='web'").bind(organizationId,locationId,actor,input.key).first();if(repeat)return json({order:orderView(repeat)});fail(409,'Le créneau, votre solde ou la carte a changé. Actualisez les disponibilités et réessayez.');}
   return json({order:orderView(await db().prepare('SELECT * FROM orders WHERE id=? AND organization_id=? AND location_id=?').bind(id,organizationId,locationId).first())},201);
  }
  if(path[0]==='orders'&&path[1]&&method==='GET'){
   const order=await db().prepare("SELECT * FROM orders WHERE id=? AND organization_id=? AND customer_user_id=? AND channel='web'").bind(path[1],PILOT_ORGANIZATION_ID,actor).first();if(!order)fail(404,'Commande introuvable.');
   const events=await db().prepare('SELECT e.status,e.note,e.created_at FROM events e JOIN orders o ON o.id=e.order_id WHERE e.order_id=? AND o.organization_id=? AND o.customer_user_id=? ORDER BY e.created_at').bind(path[1],PILOT_ORGANIZATION_ID,actor).all();return json({order:orderView(order),events:events.results});
  }
  if(path[0]==='admin'&&path[1]==='claim'&&method==='POST'){
   const input=z.object({code:z.string().min(20).max(200)}).parse(await body());const required=secret();
   const digest=async(s:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s))));const a=await digest(input.code),b=await digest(required);let difference=0;for(let i=0;i<a.length;i++)difference|=a[i]^b[i];
   if(!required||difference)fail(403,'Code d’installation incorrect.');
   const now=new Date().toISOString();
   const result=await db().batch([
    db().prepare("INSERT INTO roles(user_id,role) SELECT ?,'admin' WHERE NOT EXISTS(SELECT 1 FROM roles WHERE role='admin')").bind(actor),
    db().prepare("INSERT INTO organization_memberships(id,organization_id,location_id,principal_id,role,status,created_at,updated_at) SELECT ?,?,NULL,?,'owner','active',?,? WHERE EXISTS(SELECT 1 FROM roles WHERE user_id=? AND role='admin') AND EXISTS(SELECT 1 FROM organizations WHERE id=? AND status='active') AND NOT EXISTS(SELECT 1 FROM organization_memberships WHERE organization_id=? AND role='owner' AND location_id IS NULL)").bind(`bootstrap-owner:${PILOT_ORGANIZATION_ID}:${actor}`,PILOT_ORGANIZATION_ID,actor,now,now,actor,PILOT_ORGANIZATION_ID,PILOT_ORGANIZATION_ID),
   ]);
   if(!result[0].meta.changes&&!(await isAdmin(actor)))fail(403,'L’administration est déjà attribuée.');return json({ok:true});
  }
  if(path[0]==='orders'&&path[1]&&method==='PATCH')return await updateOrder(path[1],actor,await body(),false,PILOT_ORGANIZATION_ID,PILOT_LOCATION_ID);
  if(path[0]!=='admin')fail(404,'Page introuvable.');
  if(!(await canManagePilot(actor,PILOT_ORGANIZATION_ID,PILOT_LOCATION_ID)))fail(403,'Cet espace est réservé aux responsables de cet établissement.');
  if(method==='GET'&&!path[1]){
   const orders=await db().prepare('SELECT * FROM orders WHERE organization_id=? AND location_id=? ORDER BY created_at DESC LIMIT 300').bind(PILOT_ORGANIZATION_ID,PILOT_LOCATION_ID).all();
   const stats=await db().prepare("SELECT COUNT(*) AS count,COALESCE(SUM(total),0) AS revenue FROM orders WHERE organization_id=? AND location_id=? AND status='completed'").bind(PILOT_ORGANIZATION_ID,PILOT_LOCATION_ID).first();
   const audience=await db().prepare('SELECT COUNT(*) AS customers,COALESCE(SUM(marketing),0) AS subscribers FROM customer_profiles WHERE organization_id=?').bind(PILOT_ORGANIZATION_ID).first<{customers:number;subscribers:number}>();
   return json({orders:orders.results.map(orderView),settings:await settings(PILOT_ORGANIZATION_ID,PILOT_LOCATION_ID),products:await productList(true,PILOT_ORGANIZATION_ID),ingredients:await ingredientList(PILOT_ORGANIZATION_ID),stats,audience,sms:smsMode(local),campaignsAllowed:await isCampaignOwner(actor,PILOT_ORGANIZATION_ID)});
  }
  if(path[1]==='kitchen'&&method==='GET'){
   const orders=await db().prepare("SELECT * FROM orders WHERE organization_id=? AND location_id=? AND (status='preparing' OR (status='ready' AND updated_at>?)) ORDER BY slot LIMIT 100").bind(PILOT_ORGANIZATION_ID,PILOT_LOCATION_ID,new Date(Date.now()-2*3600000).toISOString()).all();
   return json({orders:orders.results.map(orderView)});
  }
  if(path[1]==='orders'&&path[2]&&method==='PATCH')return await updateOrder(path[2],actor,await body(),true,PILOT_ORGANIZATION_ID,PILOT_LOCATION_ID);
  if(path[1]==='settings'&&method==='PUT'){
   const s=settingsInput.parse(await body());
   for(const h of s.hours){if(!h.closed&&h.close!=='00:00'&&h.open>=h.close)fail(400,'L’heure de fermeture doit suivre l’ouverture, ou être minuit.');}
   let result=await db().prepare('UPDATE location_config SET value=?,version=version+1 WHERE organization_id=? AND location_id=? AND version=?').bind(JSON.stringify(s),PILOT_ORGANIZATION_ID,PILOT_LOCATION_ID,s.version).run();
   if(!result.meta.changes)result=await db().prepare('UPDATE config SET value=?,version=version+1 WHERE organization_id=? AND version=?').bind(JSON.stringify(s),PILOT_ORGANIZATION_ID,s.version).run();
   if(!result.meta.changes)fail(409,'Les réglages ont changé. Rechargez-les avant d’enregistrer.');return json({settings:await settings(PILOT_ORGANIZATION_ID,PILOT_LOCATION_ID)});
  }
  if(path[1]==='products')return await products(request,path[2],path[3],method,body,PILOT_ORGANIZATION_ID,actor);
  if(path[1]==='ingredients'||path[1]==='origins')return await ingredients(path[1],path[2],method,body,PILOT_ORGANIZATION_ID);
  if(path[1]==='campaigns')return await campaigns(url,path[2],path[3],method,body,actor,local,PILOT_ORGANIZATION_ID);
  fail(404,'Cette action est introuvable.');
 }catch(e){if(e instanceof z.ZodError)return json({error:e.issues[0]?.message||'Vérifiez les champs du formulaire.',fields:e.flatten().fieldErrors},400);if(e instanceof HttpError||e instanceof AuthError)return json({error:e.message},e.status);console.error('Dolce API error',e instanceof Error?e.message:'unknown');return json({error:'Le service est momentanément indisponible. Vos informations sont conservées ; réessayez.'},503);}
}
async function updateOrder(id:string,actor:string,data:unknown,admin:boolean,organizationId=PILOT_ORGANIZATION_ID,locationId=PILOT_LOCATION_ID){
 const input=z.object({status:z.enum(['confirmed','preparing','ready','completed','rejected','cancelled']),version:z.number().int().positive(),reason:z.string().trim().max(250).default('')}).parse(data);
 // Ready is an Expeditor-only transition. Completion also requires the future pickup-payment flow.
 if(admin&&['ready','completed'].includes(input.status))fail(409,'Utilisez les postes de production pour finaliser la commande; le retrait et l’encaissement seront validés dans le parcours de caisse.');
 const order=admin
  ?await db().prepare('SELECT customer_user_id,organization_id,status,version FROM orders WHERE id=? AND organization_id=? AND location_id=?').bind(id,organizationId,locationId).first<{customer_user_id:string|null;organization_id:string;status:string;version:number}>()
  :await db().prepare("SELECT customer_user_id,organization_id,status,version FROM orders WHERE id=? AND organization_id=? AND location_id=? AND customer_user_id=? AND channel='web'").bind(id,organizationId,locationId,actor).first<{customer_user_id:string|null;organization_id:string;status:string;version:number}>();if(!order||(!admin&&order.customer_user_id!==actor))fail(404,'Commande introuvable.');
 if(!admin&&(order.status!=='pending'||input.status!=='cancelled'))fail(409,'Cette commande a déjà été prise en charge. Appelez la pizzeria.');
 if(!nextStatus(order.status,input.status))fail(409,'Cette commande a changé d’état. Actualisez la liste.');
 if(admin&&['cancelled','rejected'].includes(input.status)&&input.reason.length<3)fail(400,'Indiquez le motif communiqué au client.');
 const now=new Date().toISOString();const next=input.version+1;
 const reason=input.reason||(!admin?'Annulée par le client':'');const note=reason||(input.status==='preparing'?(order.status==='pending'?'Validée et envoyée en cuisine':'Envoyée en cuisine'):'');
 const result=await db().batch([
  db().prepare("UPDATE orders SET status=?,reason=?,version=version+1,updated_at=? WHERE id=? AND version=? AND status=? AND organization_id=? AND location_id=? AND (?=1 OR (customer_user_id=? AND channel='web'))").bind(input.status,reason,now,id,input.version,order.status,organizationId,locationId,admin?1:0,actor),
  // Points are credited once, as soon as the team validates the order.
  db().prepare("INSERT OR IGNORE INTO ledger(id,organization_id,user_id,order_id,delta,kind,created_at) SELECT ?,organization_id,customer_user_id,id,earned,'earned',? FROM orders WHERE id=? AND organization_id=? AND version=? AND status IN ('confirmed','preparing') AND customer_user_id IS NOT NULL AND earned>0").bind(`${id}:earned`,now,id,organizationId,next),
  db().prepare("INSERT OR IGNORE INTO print_outbox(id,operation_id,organization_id,location_id,order_id,job_type,payload,status,attempts,available_at,created_at,updated_at) SELECT ?,?,?,?,?,?,?,'pending',0,?,?,? FROM orders WHERE id=? AND organization_id=? AND location_id=? AND status='preparing' AND version=?").bind(`${id}:print:kitchen`,`${id}:print:kitchen`,organizationId,locationId,id,'kitchen_ticket',JSON.stringify({orderId:id,format:'ticket-v1'}),now,now,now,id,organizationId,locationId,next),
  db().prepare("INSERT OR IGNORE INTO print_outbox(id,operation_id,organization_id,location_id,order_id,job_type,payload,status,attempts,available_at,created_at,updated_at) SELECT ?,?,?,?,?,?,?,'pending',0,?,?,? FROM orders WHERE id=? AND organization_id=? AND location_id=? AND status='preparing' AND version=? AND notification_phone=''").bind(`${id}:print:receipt`,`${id}:print:receipt`,organizationId,locationId,id,'customer_receipt',JSON.stringify({orderId:id,format:'receipt-v1'}),now,now,now,id,organizationId,locationId,next),
  db().prepare("INSERT OR IGNORE INTO ledger(id,organization_id,user_id,order_id,delta,kind,created_at) SELECT ?,organization_id,customer_user_id,id,redeemed,'refund',? FROM orders WHERE id=? AND organization_id=? AND status IN ('rejected','cancelled') AND version=? AND customer_user_id IS NOT NULL AND redeemed>0").bind(`${id}:refund`,now,id,organizationId,next),
  // A validated order cancelled later loses its points, without pushing the balance below zero.
  db().prepare("INSERT OR IGNORE INTO ledger(id,organization_id,user_id,order_id,delta,kind,created_at) SELECT ?,o.organization_id,o.customer_user_id,o.id,-MIN(o.earned,MAX((SELECT COALESCE(SUM(delta),0) FROM ledger WHERE organization_id=o.organization_id AND user_id=o.customer_user_id),0)),'reversal',? FROM orders o WHERE o.id=? AND o.organization_id=? AND o.customer_user_id IS NOT NULL AND o.version=? AND o.status='cancelled' AND EXISTS(SELECT 1 FROM ledger WHERE id=? AND organization_id=o.organization_id)").bind(`${id}:reversal`,now,id,organizationId,next,`${id}:earned`),
  db().prepare('INSERT OR IGNORE INTO events(id,order_id,status,actor,note,created_at) SELECT ?,id,status,?,?,? FROM orders WHERE id=? AND version=? AND status=?').bind(`${id}:${next}`,actor,note,now,id,next,input.status)
 ]);
 if(!result[0].meta.changes)fail(409,'Une autre action a modifié cette commande. Actualisez la liste.');
 const updated=admin
  ?await db().prepare('SELECT * FROM orders WHERE id=? AND organization_id=? AND location_id=?').bind(id,organizationId,locationId).first()
  :await db().prepare("SELECT * FROM orders WHERE id=? AND organization_id=? AND location_id=? AND customer_user_id=? AND channel='web'").bind(id,organizationId,locationId,actor).first();
 return json({order:orderView(updated)});
}

// ── Menu administration ────────────────────────────────────────────────
const productRow=(id:string,organizationId=PILOT_ORGANIZATION_ID)=>db().prepare('SELECT * FROM products WHERE organization_id=? AND id=?').bind(organizationId,id).first<Parameters<typeof toProduct>[0]>();
async function uniqueId(table:'products'|'ingredients',name:string,fallback:string){
 const base=slugify(name)||fallback;for(let n=1;n<100;n++){const id=n===1?base:`${base}-${n}`;if(!await db().prepare(`SELECT 1 FROM ${table} WHERE id=?`).bind(id).first())return id;}
 return `${base}-${crypto.randomUUID().slice(0,6)}`;
}
async function checkProduct(p:z.infer<typeof productFields>,organizationId=PILOT_ORGANIZATION_ID){
 const known=new Set((await ingredientList(organizationId)).map(i=>i.id));
 if(p.xxl!==null&&p.xxl<=p.price)fail(400,'Le prix XXL doit être supérieur au prix Senior.');
 if(p.offer&&p.xxl===null)fail(400,'L’offre « 2e pizza offerte » concerne uniquement les pizzas Senior et XXL.');
 if(new Set(p.ingredients).size!==p.ingredients.length)fail(400,'Un ingrédient apparaît deux fois dans la recette.');
 const unknown=p.ingredients.find(id=>!known.has(id));if(unknown)fail(400,'Un ingrédient de la recette n’existe plus. Rechargez la page.');
 if(p.xxl!==null&&p.status==='published'&&p.ingredients.length<2)fail(400,'Ajoutez les ingrédients de la pizza avant de la publier.');
 return {...p,description:p.description||describe(p.ingredients,await ingredientList(organizationId))};
}
async function products(request:Request,id:string|undefined,sub:string|undefined,method:string,body:()=>Promise<unknown>,organizationId=PILOT_ORGANIZATION_ID,actor='system'){
 const now=new Date().toISOString();
 if(id==='revisions'&&method==='GET'){
  const productId=new URL(request.url).searchParams.get('productId');
  const rows=await db().prepare(`SELECT id,product_id,product_version,action,snapshot,actor_id,changed_at FROM menu_product_revisions WHERE organization_id=?${productId?' AND product_id=?':''} ORDER BY changed_at DESC,id DESC LIMIT 500`).bind(...(productId?[organizationId,productId]:[organizationId])).all();
  return json({revisions:rows.results});
 }
 if(!id&&method==='POST'){
  const p=await checkProduct(productFields.parse(await body()),organizationId);
  const newId=await uniqueId('products',p.name,'article');
  const last=await db().prepare('SELECT COALESCE(MAX(sort),0) AS sort FROM products WHERE organization_id=?').bind(organizationId).first<{sort:number}>();
  const inserted={...p,id:newId,photo:'none',sort:(last?.sort||0)+1};
  const snapshot=toProduct({...inserted,available:inserted.available?1:0,offer:inserted.offer?1:0,allergens_checked:inserted.allergensChecked?1:0,spicy:inserted.spicy?1:0,options:JSON.stringify(inserted.options||[]),ingredients:JSON.stringify(inserted.ingredients||[]),allergens:JSON.stringify(inserted.allergens||[]),version:1,location_available:null,location_price:null,location_xxl:null});
  await db().batch([insertProduct(inserted,organizationId),db().prepare('INSERT INTO menu_product_revisions(id,organization_id,product_id,product_version,action,snapshot,actor_id,changed_at) VALUES(?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(),organizationId,newId,1,'created',JSON.stringify(snapshot),actor,now)]);
  return json({product:toProduct((await productRow(newId,organizationId))!)},201);
 }
 if(!id)fail(404,'Cette action est introuvable.');
 const row=await productRow(id,organizationId);if(!row)fail(404,'Cet article n’existe plus. Rechargez la carte.');const current=toProduct(row);
 if(sub==='photo')return await productPhoto(request,current,method,organizationId);
 if(sub==='restore'&&method==='POST'){
  const input=z.object({revisionId:clean.max(128),version:z.number().int().positive()}).strict().parse(await body());
  if((current.version||1)!==input.version)fail(409,'Cet article a changé sur un autre appareil. Rechargez son historique avant de restaurer.');
  const revision=await db().prepare('SELECT snapshot FROM menu_product_revisions WHERE organization_id=? AND product_id=? AND id=?').bind(organizationId,id,input.revisionId).first<{snapshot:string}>();
  if(!revision)fail(404,'Cette version du menu est introuvable.');
  let snapshot:unknown;try{snapshot=JSON.parse(revision.snapshot);}catch{fail(409,'Cette version historique est illisible.');}
  const restored=await checkProduct(productFields.parse(snapshot),organizationId);
  if(restored.status==='archived')fail(409,'Une version archivée ne peut pas être restaurée. Choisissez une version publiée ou brouillon.');
  const nextVersion=input.version+1;
  const restoredSnapshot={...restored,id,version:nextVersion};
  const result=await db().batch([
   db().prepare('UPDATE products SET name=?,category=?,description=?,tagline=?,price=?,xxl=?,ingredients=?,allergens=?,allergens_checked=?,options=?,spicy=?,offer=?,available=?,status=?,version=version+1,updated_at=? WHERE organization_id=? AND id=? AND version=?')
    .bind(restored.name,restored.category,restored.description,restored.tagline,restored.price,restored.xxl,JSON.stringify(restored.ingredients),JSON.stringify(restored.allergens),restored.allergensChecked?1:0,JSON.stringify(restored.options),restored.spicy?1:0,restored.offer?1:0,restored.available?1:0,restored.status,now,organizationId,id,input.version),
   db().prepare('INSERT INTO menu_product_revisions(id,organization_id,product_id,product_version,action,snapshot,actor_id,changed_at) SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM products WHERE organization_id=? AND id=? AND version=?)').bind(crypto.randomUUID(),organizationId,id,nextVersion,'updated',JSON.stringify(restoredSnapshot),actor,now,organizationId,id,nextVersion),
  ]);
  if(!result[0].meta.changes)fail(409,'Cet article a changé sur un autre appareil. Rechargez-le avant de restaurer.');
  return json({product:toProduct((await productRow(id,organizationId))!)});
 }
 if(method==='PUT'){
  const input=productFields.partial().extend({version:z.number().int().positive()}).parse(await body());
  const merged={name:current.name,category:current.category,description:current.description,tagline:current.tagline||'',price:current.price,xxl:current.xxl,ingredients:current.ingredients||[],allergens:current.allergens||[],allergensChecked:!!current.allergensChecked,options:current.options||[],spicy:!!current.spicy,offer:!!current.offer,available:current.available,status:current.status||'published',...input};
  if((current.xxl===null)!==(merged.xxl===null))fail(400,'Conservez les tailles proposées pour cet article.');
  const p=await checkProduct(merged,organizationId);
  const nextVersion=input.version+1;
  const snapshot={...p,id,version:nextVersion};
  const r=await db().batch([
   db().prepare('UPDATE products SET name=?,category=?,description=?,tagline=?,price=?,xxl=?,ingredients=?,allergens=?,allergens_checked=?,options=?,spicy=?,offer=?,available=?,status=?,version=version+1,updated_at=? WHERE organization_id=? AND id=? AND version=?')
    .bind(p.name,p.category,p.description,p.tagline,p.price,p.xxl,JSON.stringify(p.ingredients),JSON.stringify(p.allergens),p.allergensChecked?1:0,JSON.stringify(p.options),p.spicy?1:0,p.offer?1:0,p.available?1:0,p.status,now,organizationId,id,input.version),
   db().prepare('INSERT INTO menu_product_revisions(id,organization_id,product_id,product_version,action,snapshot,actor_id,changed_at) SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM products WHERE organization_id=? AND id=? AND version=?)').bind(crypto.randomUUID(),organizationId,id,nextVersion,p.status==='archived'?'archived':'updated',JSON.stringify(snapshot),actor,now,organizationId,id,nextVersion),
  ]);
  if(!r[0].meta.changes)fail(409,'Cet article a été modifié sur un autre appareil. Rechargez-le avant d’enregistrer.');
  return json({product:toProduct((await productRow(id,organizationId))!)});
 }
 if(method==='DELETE'){
  // A product already ordered stays in the database, hidden, so past orders and loyalty stay exact.
  const ordered=await db().prepare('SELECT 1 FROM orders WHERE organization_id=? AND instr(items,?) LIMIT 1').bind(organizationId,`"id":"${id}"`).first();
  if(ordered){const nextVersion=(current.version||1)+1;await db().batch([db().prepare("UPDATE products SET status='archived',version=version+1,updated_at=? WHERE organization_id=? AND id=?").bind(now,organizationId,id),db().prepare('INSERT INTO menu_product_revisions(id,organization_id,product_id,product_version,action,snapshot,actor_id,changed_at) VALUES(?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(),organizationId,id,nextVersion,'archived',JSON.stringify({...current,status:'archived',version:nextVersion}),actor,now)]);return json({archived:true});}
  await db().batch([db().prepare('INSERT INTO menu_product_revisions(id,organization_id,product_id,product_version,action,snapshot,actor_id,changed_at) VALUES(?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(),organizationId,id,current.version,'deleted',JSON.stringify(current),actor,now),db().prepare('DELETE FROM products WHERE organization_id=? AND id=?').bind(organizationId,id),db().prepare('DELETE FROM product_photos WHERE organization_id=? AND product_id=?').bind(organizationId,id)]);
  return json({archived:false});
 }
 fail(404,'Cette action est introuvable.');
}
const isWebp=(b:Uint8Array)=>b.length>12&&String.fromCharCode(...b.slice(0,4))==='RIFF'&&String.fromCharCode(...b.slice(8,12))==='WEBP';
const isPng=(b:Uint8Array)=>b.length>8&&b[0]===0x89&&String.fromCharCode(...b.slice(1,4))==='PNG';
async function productPhoto(request:Request,p:Product,method:string,organizationId=PILOT_ORGANIZATION_ID){
 const now=new Date().toISOString();const previous=(p.photo||'').split(':')[0];
 if(method==='DELETE'){await db().batch([db().prepare("UPDATE products SET photo='none',version=version+1,updated_at=? WHERE organization_id=? AND id=?").bind(now,organizationId,p.id),db().prepare('DELETE FROM product_photos WHERE organization_id=? AND product_id=?').bind(organizationId,p.id)]);return json({product:toProduct((await productRow(p.id,organizationId))!)});}
 if(method!=='POST')fail(404,'Cette action est introuvable.');
 const form=await request.formData().catch(()=>fail(400,'La photo n’a pas pu être lue. Réessayez.'));
 const files:{width:number;mime:string;data:ArrayBuffer}[]=[];
 for(const width of [320,640,1024]){
  const file=form.get(`w${width}`);if(!(file instanceof File))continue;
  if(file.size>MAX_PHOTO)fail(413,'La photo est trop lourde. Réessayez avec une photo plus petite.');
  const data=await file.arrayBuffer(),bytes=new Uint8Array(data);
  const mime=isWebp(bytes)?'image/webp':isPng(bytes)?'image/png':fail(400,'Format de photo non reconnu.');
  files.push({width,mime,data});
 }
 if(!files.some(f=>f.width===320)||!files.some(f=>f.width===640))fail(400,'La photo n’a pas été préparée correctement. Réessayez.');
 const version=crypto.randomUUID().replace(/-/g,'').slice(0,10);
 // Keeps the previous version too: a page opened a minute ago may still show it.
 await db().batch([
  ...files.map(f=>db().prepare('INSERT INTO product_photos(product_id,version,width,mime,data,created_at,organization_id) VALUES(?,?,?,?,?,?,?)').bind(p.id,version,f.width,f.mime,f.data,now,organizationId)),
  db().prepare('DELETE FROM product_photos WHERE organization_id=? AND product_id=? AND version NOT IN (?,?)').bind(organizationId,p.id,version,previous||'-'),
  db().prepare('UPDATE products SET photo=?,version=version+1,updated_at=? WHERE organization_id=? AND id=?').bind(`${version}:${files.map(f=>f.width).join(',')}`,now,organizationId,p.id),
 ]);
 return json({product:toProduct((await productRow(p.id,organizationId))!)});
}
async function photo(request:Request,id='',version='',width:number,organizationId=PILOT_ORGANIZATION_ID){
 const cache=(globalThis as unknown as {caches?:{default?:Cache}}).caches?.default;
 const hit=await cache?.match(request).catch(()=>undefined);if(hit)return hit;
 const row=/^[a-z0-9-]{1,80}$/.test(id)&&/^[a-f0-9]{10}$/.test(version)?await db().prepare('SELECT mime,data FROM product_photos WHERE organization_id=? AND product_id=? AND version=? AND width=?').bind(organizationId,id,version,width).first<{mime:string;data:ArrayBuffer}>():null;
 if(!row)return new Response('Photo introuvable',{status:404,headers:{'Cache-Control':'no-store'}});
 // Each upload gets a new version in its address, so a photo never changes once published.
 const response=new Response(new Uint8Array(row.data),{headers:{'Content-Type':row.mime,'Cache-Control':'public, max-age=31536000, immutable'}});
 await cache?.put(request,response.clone()).catch(()=>{});
 return response;
}
async function ingredients(kind:string,id:string|undefined,method:string,body:()=>Promise<unknown>,organizationId=PILOT_ORGANIZATION_ID){
 if(kind==='origins'&&method==='PUT'){
  const rows=z.array(z.object({id:clean.max(80),meat:ingredientFields.shape.meat,origin:clean.max(80)})).max(200).parse(await body());
  if(rows.length)await db().batch(rows.map(r=>db().prepare('UPDATE ingredients SET meat=?,origin=? WHERE organization_id=? AND id=?').bind(r.meat,r.origin,organizationId,r.id)));
  return json({ingredients:await ingredientList(organizationId)});
 }
 if(kind!=='ingredients')fail(404,'Cette action est introuvable.');
 if(!id&&method==='POST'){
  const i=ingredientFields.parse(await body());
  const same=(await ingredientList(organizationId)).find(x=>slugify(x.name)===slugify(i.name));if(same)fail(409,`« ${same.name} » existe déjà.`);
  const newId=await uniqueId('ingredients',i.name,'ingredient');const last=await db().prepare('SELECT COALESCE(MAX(sort),0) AS sort FROM ingredients WHERE organization_id=?').bind(organizationId).first<{sort:number}>();
  await db().prepare('INSERT INTO ingredients(id,name,allergens,meat,origin,extra,available,locked,sort,organization_id) VALUES(?,?,?,?,?,?,?,0,?,?)').bind(newId,i.name,JSON.stringify(i.allergens),i.meat,i.origin,i.extra?1:0,i.available?1:0,(last?.sort||0)+1,organizationId).run();
  const row=await db().prepare('SELECT * FROM ingredients WHERE organization_id=? AND id=?').bind(organizationId,newId).first<Parameters<typeof toIngredient>[0]>();
  return json({ingredient:toIngredient(row!)},201);
 }
 if(!id)fail(404,'Cette action est introuvable.');
 const current=(await ingredientList(organizationId)).find(i=>i.id===id);if(!current)fail(404,'Cet ingrédient n’existe plus.');
 if(method==='PUT'){
  const i={...current,...ingredientFields.partial().parse(await body())};
  await db().prepare('UPDATE ingredients SET name=?,allergens=?,meat=?,origin=?,extra=?,available=? WHERE organization_id=? AND id=?').bind(i.name,JSON.stringify(i.allergens),i.meat,i.origin,i.extra&&!current.locked?1:0,i.available?1:0,organizationId,id).run();
  return json({ingredients:await ingredientList(organizationId)});
 }
 if(method==='DELETE'){
  if(current.locked)fail(409,'La pâte fait partie de toutes les pizzas : modifiez ses allergènes, mais ne la supprimez pas.');
  const users=(await productList(true,organizationId)).filter(p=>p.status!=='archived'&&p.ingredients?.includes(id));
  if(users.length)fail(409,`${current.name} est utilisé dans : ${users.map(p=>p.name).join(', ')}. Retirez-le de ces recettes d’abord.`);
  await db().prepare('DELETE FROM ingredients WHERE organization_id=? AND id=?').bind(organizationId,id).run();
  return json({ingredients:await ingredientList(organizationId)});
 }
 fail(404,'Cette action est introuvable.');
}

// ── Promotional SMS ────────────────────────────────────────────────────
type CampaignRow={id:string;organization_id:string;message:string;status:string;total:number;sent:number;failed:number;simulated:number;created_at:string;finished_at:string};
const campaignRow=(organizationId:string,id:string)=>db().prepare('SELECT * FROM campaigns WHERE organization_id=? AND id=?').bind(organizationId,id).first<CampaignRow>();
type ClaimedCampaignRecipient={user_id:string;phone:string};
async function finalizeCampaign(organizationId:string,id:string,actor:string,now:string){
 // A cancelled campaign is immutable here: a late worker may record its recipient result,
 // but it must never reopen or rewrite the campaign after cancellation.
 await db().prepare(`UPDATE campaigns SET
   sent=(SELECT COUNT(*) FROM campaign_recipients r WHERE r.organization_id=campaigns.organization_id AND r.campaign_id=campaigns.id AND r.status IN ('sent','simulated')),
   failed=(SELECT COUNT(*) FROM campaign_recipients r WHERE r.organization_id=campaigns.organization_id AND r.campaign_id=campaigns.id AND r.status='failed'),
   status=CASE WHEN EXISTS(SELECT 1 FROM campaign_recipients r WHERE r.organization_id=campaigns.organization_id AND r.campaign_id=campaigns.id AND r.status IN ('pending','processing')) THEN 'sending' ELSE 'done' END,
   finished_at=CASE WHEN EXISTS(SELECT 1 FROM campaign_recipients r WHERE r.organization_id=campaigns.organization_id AND r.campaign_id=campaigns.id AND r.status IN ('pending','processing')) THEN '' ELSE ? END
   WHERE organization_id=? AND id=? AND status='sending' AND ${campaignOwnerGuardSql}`).bind(now,organizationId,id,organizationId,actor).run();
}
async function campaigns(url:URL,id:string|undefined,sub:string|undefined,method:string,body:()=>Promise<unknown>,actor:string,local:boolean,organizationId:string){
 await requireCampaignOwner(actor,organizationId);
 const mode=smsMode(local);
 if(!id&&method==='GET'){const r=await db().prepare('SELECT * FROM campaigns WHERE organization_id=? ORDER BY created_at DESC LIMIT 20').bind(organizationId).all<CampaignRow>();return json({campaigns:r.results,sms:mode});}
 if(!id&&method==='POST'){
  const{message}=z.object({message:clean.min(10,'Écrivez votre message (10 caractères minimum).').max(420,'Message trop long : 420 caractères maximum.')}).parse(await body());
  if(mode==='off')fail(503,'L’envoi de SMS n’est pas encore configuré (clé Brevo manquante).');
  const audience=await db().prepare('SELECT COUNT(*) AS n FROM customer_profiles WHERE organization_id=? AND marketing=1').bind(organizationId).first<{n:number}>();
  if(!audience?.n)fail(409,'Aucun client n’a encore accepté de recevoir vos SMS.');
  // The signed stop link is generated per recipient immediately before sending.
  const organization=await db().prepare('SELECT name FROM organizations WHERE id=? AND status=\'active\'').bind(organizationId).first<{name:string}>();
  if(!organization)fail(409,'Cette enseigne n’est pas active.');
  const content=`${organization.name} : ${message}`;
  const newId=crypto.randomUUID();const now=new Date().toISOString();
  // Recheck immediately before the write and repeat the owner predicate inside every
  // mutation. INSERT OR IGNORE turns the partial unique-index race into a clean 409.
  await requireCampaignOwner(actor,organizationId);
  const results=await db().batch([
   db().prepare(`INSERT OR IGNORE INTO campaigns(id,organization_id,message,status,total,sent,failed,simulated,created_by,created_at)
    SELECT ?,?,?,'sending',0,0,0,?,?,? WHERE ${campaignOwnerGuardSql}`).bind(newId,organizationId,content,mode==='demo'?1:0,actor,now,organizationId,actor),
   db().prepare(`INSERT INTO campaign_recipients(organization_id,campaign_id,user_id,phone)
    SELECT p.organization_id,?,p.user_id,u.phone FROM customer_profiles p JOIN users u ON u.id=p.user_id
    WHERE p.organization_id=? AND p.marketing=1
      AND EXISTS(SELECT 1 FROM campaigns c WHERE c.organization_id=p.organization_id AND c.id=? AND c.status='sending')
      AND ${campaignOwnerGuardSql}`).bind(newId,organizationId,newId,organizationId,actor),
   db().prepare(`UPDATE campaigns SET
    total=(SELECT COUNT(*) FROM campaign_recipients WHERE organization_id=? AND campaign_id=?),
    status=CASE WHEN EXISTS(SELECT 1 FROM campaign_recipients WHERE organization_id=? AND campaign_id=?) THEN 'sending' ELSE 'done' END,
    finished_at=CASE WHEN EXISTS(SELECT 1 FROM campaign_recipients WHERE organization_id=? AND campaign_id=?) THEN '' ELSE ? END
    WHERE organization_id=? AND id=? AND status='sending' AND ${campaignOwnerGuardSql}`).bind(organizationId,newId,organizationId,newId,organizationId,newId,now,organizationId,newId,organizationId,actor),
  ]);
  if(!results[0].meta.changes){await requireCampaignOwner(actor,organizationId);fail(409,'Un envoi est déjà en cours. Terminez-le avant d’en commencer un autre.');}
  return json({campaign:await campaignRow(organizationId,newId)},201);
 }
 if(!id)fail(404,'Cette action est introuvable.');
 const campaign=await campaignRow(organizationId,id);if(!campaign)fail(404,'Envoi introuvable.');
 if(sub==='send'&&method==='POST'){
  if(campaign.status!=='sending')return json({campaign});
  if(!campaign.simulated){
   if(mode!=='live')fail(503,'L’envoi de SMS n’est pas encore configuré (clé Brevo manquante).');
   const p=parisParts(Date.now());if(p.day===0||p.minute<480||p.minute>=1200)fail(409,'Les SMS promotionnels partent du lundi au samedi, entre 8 h et 20 h. L’envoi reprendra quand vous relancerez à ces horaires.');
  }
  const now=new Date().toISOString();const leaseToken=crypto.randomUUID();const leaseExpiresAt=new Date(Date.now()+5*60000).toISOString();
  await requireCampaignOwner(actor,organizationId);
  // Brevo's transactional SMS endpoint does not expose a documented idempotency key.
  // We therefore use at-most-once delivery: an expired/uncertain claim is failed and is
  // never retried automatically. This avoids duplicate promotions at the cost of a
  // possible missed SMS if the worker stops between the reservation and provider call.
  await db().prepare(`UPDATE campaign_recipients SET status='failed',lease_token=NULL,lease_expires_at=NULL,last_error='claim_expired_without_provider_receipt',sent_at=?
   WHERE organization_id=? AND campaign_id=? AND status='processing' AND lease_expires_at<?
     AND EXISTS(SELECT 1 FROM campaigns c WHERE c.organization_id=? AND c.id=? AND c.status='sending')
     AND ${campaignOwnerGuardSql}`).bind(now,organizationId,id,now,organizationId,id,organizationId,actor).run();
  // Consent is evaluated at claim time. Revoked recipients become terminally skipped.
  await db().prepare(`UPDATE campaign_recipients SET status='skipped',lease_token=NULL,lease_expires_at=NULL,last_error='consent_revoked',sent_at=?
   WHERE organization_id=? AND campaign_id=? AND status='pending'
     AND NOT EXISTS(SELECT 1 FROM customer_profiles p WHERE p.organization_id=campaign_recipients.organization_id AND p.user_id=campaign_recipients.user_id AND p.marketing=1)
     AND EXISTS(SELECT 1 FROM campaigns c WHERE c.organization_id=? AND c.id=? AND c.status='sending')
     AND ${campaignOwnerGuardSql}`).bind(now,organizationId,id,organizationId,id,organizationId,actor).run();
  // UPDATE ... RETURNING is the atomic reservation: concurrent send requests cannot
  // observe or dispatch the same pending recipient.
  const claimed=await db().prepare(`UPDATE campaign_recipients SET status='processing',attempts=attempts+1,lease_token=?,lease_expires_at=?,last_error=''
   WHERE rowid IN (
    SELECT r.rowid FROM campaign_recipients r JOIN customer_profiles p ON p.organization_id=r.organization_id AND p.user_id=r.user_id AND p.marketing=1
    WHERE r.organization_id=? AND r.campaign_id=? AND r.status='pending'
      AND EXISTS(SELECT 1 FROM campaigns c WHERE c.organization_id=r.organization_id AND c.id=r.campaign_id AND c.status='sending')
      AND ${campaignOwnerGuardSql}
    ORDER BY r.user_id LIMIT 5
   ) RETURNING user_id,phone`).bind(leaseToken,leaseExpiresAt,organizationId,id,organizationId,actor).all<ClaimedCampaignRecipient>();
  await requireCampaignOwner(actor,organizationId);
  for(const recipient of claimed.results){
   // Cancellation, consent withdrawal and owner revocation are checked again as near
   // as possible to the external call. A provider call itself cannot share a DB lock.
   const permitted=await db().prepare(`SELECT 1 FROM campaign_recipients r
    JOIN campaigns c ON c.organization_id=r.organization_id AND c.id=r.campaign_id AND c.status='sending'
    JOIN customer_profiles p ON p.organization_id=r.organization_id AND p.user_id=r.user_id AND p.marketing=1
    WHERE r.organization_id=? AND r.campaign_id=? AND r.user_id=? AND r.status='processing' AND r.lease_token=?
      AND ${campaignOwnerGuardSql}`).bind(organizationId,id,recipient.user_id,leaseToken,organizationId,actor).first();
   if(!permitted){
    await requireCampaignOwner(actor,organizationId);
    await db().prepare(`UPDATE campaign_recipients SET status='skipped',sent_at=?,lease_token=NULL,lease_expires_at=NULL,last_error='campaign_cancelled_or_consent_revoked'
     WHERE organization_id=? AND campaign_id=? AND user_id=? AND status='processing' AND lease_token=? AND ${campaignOwnerGuardSql}`).bind(now,organizationId,id,recipient.user_id,leaseToken,organizationId,actor).run();
    continue;
   }
   let status:'sent'|'simulated'|'failed'|'unknown';let lastError='';let providerMessageId='';
   if(campaign.simulated)status='simulated';
   else{
    const token=await marketingStopProof(organizationId,recipient.phone);const link=new URL('/api/marketing/stop',url.origin);link.searchParams.set('token',token);
    const content=`${campaign.message.replace(/\nSTOP SMS : [^\n]*$/,'')}\nSTOP SMS : ${link.toString()}`;
    const receipt=await sendSmsDetailed(recipient.phone,content,'marketing','promo');status=receipt.accepted?'sent':receipt.outcome==='unknown'?'unknown':'failed';lastError=receipt.accepted?'':receipt.outcome==='unknown'?'provider_receipt_unknown':'provider_rejected';providerMessageId=receipt.providerMessageId||'';
   }
   await db().prepare(`UPDATE campaign_recipients SET status=?,sent_at=?,lease_token=NULL,lease_expires_at=NULL,last_error=?,provider_message_id=?
    WHERE organization_id=? AND campaign_id=? AND user_id=? AND status='processing' AND lease_token=? AND ${campaignOwnerGuardSql}`).bind(status,now,lastError,providerMessageId,organizationId,id,recipient.user_id,leaseToken,organizationId,actor).run();
  }
  await finalizeCampaign(organizationId,id,actor,now);
  return json({campaign:await campaignRow(organizationId,id)});
 }
 if(sub==='cancel'&&method==='POST'){
  await requireCampaignOwner(actor,organizationId);const now=new Date().toISOString();
  const results=await db().batch([
   db().prepare(`UPDATE campaigns SET status='done',finished_at=? WHERE organization_id=? AND id=? AND status='sending' AND ${campaignOwnerGuardSql}`).bind(now,organizationId,id,organizationId,actor),
   db().prepare(`UPDATE campaign_recipients SET status='skipped',sent_at=?,last_error='campaign_cancelled' WHERE organization_id=? AND campaign_id=? AND status='pending' AND ${campaignOwnerGuardSql}`).bind(now,organizationId,id,organizationId,actor),
  ]);
  if(!results[0].meta.changes)await requireCampaignOwner(actor,organizationId);
  return json({campaign:await campaignRow(organizationId,id)});
 }
 fail(404,'Cette action est introuvable.');
}
export const GET=handler;export const POST=handler;export const PATCH=handler;export const PUT=handler;export const DELETE=handler;
