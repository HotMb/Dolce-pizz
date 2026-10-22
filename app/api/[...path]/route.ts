import {NextResponse} from 'next/server';
import {z} from 'zod';
import {db,ensureSeed,settings,productList,ingredientList,menu,balance,isAdmin,orderView,secret,marketingStopSecret,insertProduct,toProduct,toIngredient} from '@/lib/server';
import {sessionUser,sendCode,verifyCode,sessionCookie,endSession,normalizePhone,localPhone,AuthError,underLimit,smsMode,sendSms} from '@/lib/auth';
import {slots,allowedSlot,nextStatus,parisParts} from '@/lib/rules';
import {priceCart} from '@/lib/pricing';
import {categories,type Product} from '@/lib/catalog';
import {allergenIds,describe,slugify} from '@/lib/menu';
import {createMarketingStopProof,matchesMarketingStopProof} from '@/lib/marketing-stop';
export const dynamic='force-dynamic';
const json=(data:unknown,status=200,cookie?:string)=>{const r=NextResponse.json(data,{status,headers:{'Cache-Control':'no-store'}});if(cookie)r.headers.append('Set-Cookie',cookie);return r;};
class HttpError extends Error{constructor(public status:number,message:string){super(message);}}
function fail(status:number,message:string):never{throw new HttpError(status,message);}
const clean=z.string().trim();
const mobile=(raw:string)=>normalizePhone(raw)??fail(400,'Indiquez un numéro de mobile français (06 ou 07).');
const PILOT_ORGANIZATION_ID='dolce-pizza',PILOT_LOCATION_ID='ronchin';
const ids=z.array(clean.max(80)).max(20).optional();
const STOP_COOKIE='dolce_stop_proof';
async function marketingStopProof(phone:string){
 const key=marketingStopSecret();if(!key)fail(503,'La désinscription SMS n’est pas configurée. Réessayez plus tard.');
 // A 128-bit HMAC tag is opaque and sufficient for an unguessable, recipient-bound proof.
 return createMarketingStopProof(phone,key);
}
const stopProofCookie=(token:string,secure:boolean,maxAge=1800)=>`${STOP_COOKIE}=${token}; Path=/api/marketing/stop; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure?'; Secure':''}`;
const stopProofFromCookie=(header:string|null)=>header?.split(/;\s*/).find(v=>v.startsWith(`${STOP_COOKIE}=`))?.slice(STOP_COOKIE.length+1)||'';
const orderInput=z.object({key:z.string().uuid(),name:clean.min(2,'Indiquez votre nom.').max(80),note:clean.max(500).default(''),slot:z.string().datetime(),ticket:z.boolean(),items:z.array(z.object({id:clean.max(80),size:z.enum(['senior','xxl','unique']),quantity:z.number().int().min(1).max(20),option:clean.max(80).default(''),freeId:clean.max(80).optional(),freeOption:clean.max(80).default(''),removed:ids,added:ids,freeRemoved:ids,freeAdded:ids})).min(1).max(40)});
const settingsInput=z.object({enabled:z.boolean(),hoursConfirmed:z.boolean(),leadMinutes:z.number().int().min(15).max(180),cutoffMinutes:z.number().int().min(0).max(120),capacity:z.number().int().min(1).max(30),hours:z.array(z.object({open:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),close:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),closed:z.boolean()})).length(7),closures:z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).max(365),loyaltyEnabled:z.boolean(),pointsPerEuro:z.number().int().min(1).max(10),rewardPoints:z.number().int().min(10).max(10000),extraPrice:z.number().int().min(0,'Le prix d’un supplément ne peut pas être négatif.').max(1000,'Un supplément coûte 10 € au maximum.'),version:z.number().int().positive()});
const allergen=z.enum(allergenIds as [string,...string[]]);
const productFields=z.object({name:clean.min(2,'Indiquez le nom.').max(60,'60 caractères maximum pour le nom.'),category:z.enum(categories.map(c=>c.id) as [string,...string[]]),description:clean.max(300),tagline:clean.max(80),price:z.number().int().min(1,'Indiquez un prix.').max(10000),xxl:z.number().int().min(1).max(10000).nullable(),ingredients:z.array(clean.max(80)).max(20,'20 ingrédients maximum.'),allergens:z.array(allergen).max(14),allergensChecked:z.boolean(),options:z.array(clean.min(1).max(40)).max(8),spicy:z.boolean(),offer:z.boolean(),available:z.boolean(),status:z.enum(['published','draft','archived'])});
const ingredientFields=z.object({name:clean.min(2,'Indiquez le nom de l’ingrédient.').max(40),allergens:z.array(allergen).max(14),meat:z.enum(['','boeuf','porc','volaille','agneau']),origin:clean.max(80),extra:z.boolean(),available:z.boolean()});
const MAX_PHOTO=1900000;
async function handler(request:Request){
 try{
  const url=new URL(request.url);const path=url.pathname.slice(5).split('/'); const method=request.method;
  if(path[0]==='photos'&&method==='GET')return await photo(request,path[1],path[2],Number(path[3]));
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
   if(path[1]==='verify'){const input=z.object({phone:clean.max(30),code:clean.regex(/^\d{6}$/,'Saisissez les 6 chiffres reçus par SMS.')}).parse(await body());const{user:member,token}=await verifyCode(mobile(input.phone),input.code);return json({user:{name:member.name,phone:localPhone(member.phone)}},200,sessionCookie(token,secure));}
   if(path[1]==='logout'){await endSession(cookie);return json({ok:true},200,sessionCookie('',secure));}
  }
  if(path[0]==='catalog'&&method==='GET'){const m=await menu();return json(m);}
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
   if(!await underLimit(`stop:${ip}`,20))fail(429,'Trop de demandes. Réessayez dans une heure ou appelez la pizzeria.');
   const supplied=stopProofFromCookie(cookie);const key=marketingStopSecret();
   if(!await matchesMarketingStopProof(phone,key,supplied))fail(403,'Ouvrez le lien de désinscription reçu par SMS et saisissez le numéro associé.');
   await db().prepare("UPDATE users SET marketing=0,marketing_at=?,marketing_source='stop' WHERE phone=? AND marketing=1").bind(new Date().toISOString(),phone).run();
   return json({ok:true},200,stopProofCookie('',secure,0));
  }
  if(path[0]==='slots'&&method==='GET'){
   const s=await settings();const r=await db().prepare("SELECT slot,COUNT(*) AS n FROM orders WHERE organization_id=? AND location_id=? AND status NOT IN ('rejected','cancelled') AND slot>? GROUP BY slot").bind(PILOT_ORGANIZATION_ID,PILOT_LOCATION_ID,new Date().toISOString()).all<{slot:string;n:number}>();
   return json({slots:slots(s,Object.fromEntries(r.results.map(v=>[v.slot,v.n]))),settings:s});
  }
  if(path[0]==='me'&&method==='GET'){
   const s=await settings();const loyalty={enabled:s.loyaltyEnabled,pointsPerEuro:s.pointsPerEuro,rewardPoints:s.rewardPoints};
   if(!user)return json({user:null,admin:false,balance:0,orders:[],loyalty});
   const rows=await db().prepare('SELECT * FROM orders WHERE user_id=? ORDER BY created_at DESC LIMIT 100').bind(user.id).all();
   const consent=await db().prepare('SELECT marketing FROM users WHERE id=?').bind(user.id).first<{marketing:number}>();
   return json({user:{name:user.name,phone:localPhone(user.phone),marketing:!!consent?.marketing},admin:await isAdmin(user.id),balance:await balance(user.id),orders:rows.results.map(orderView),loyalty});
  }
  if(!user)fail(401,'Connectez-vous pour continuer.');
  const actor=user.id;
  if(path[0]==='me'&&method==='PATCH'){
   const input=z.object({name:clean.min(2,'Indiquez votre nom.').max(80).optional(),marketing:z.boolean().optional(),source:z.enum(['inscription','compte','commande']).default('compte')}).parse(await body());
   if(input.name!==undefined)await db().prepare('UPDATE users SET name=? WHERE id=?').bind(input.name,actor).run();
   // Consent to promotional SMS is recorded with its date and where it was given, and can be withdrawn at any time.
   if(input.marketing!==undefined)await db().prepare('UPDATE users SET marketing=?,marketing_at=?,marketing_source=? WHERE id=? AND marketing<>?').bind(input.marketing?1:0,new Date().toISOString(),input.marketing?input.source:'compte',actor,input.marketing?1:0).run();
   return json({ok:true});
  }
  if(path[0]==='orders'&&method==='POST'&&!path[1]){
   const input=orderInput.parse(await body());
   const previous=await db().prepare('SELECT * FROM orders WHERE user_id=? AND idempotency=?').bind(actor,input.key).first();
   if(previous)return json({order:orderView(previous)});
   // This public web flow is currently configured for the verified Ronchin pickup site.
   // Never create a new unscoped order or silently route to the unconfigured Tourcoing site.
   const organizationId=PILOT_ORGANIZATION_ID,locationId=PILOT_LOCATION_ID;
   const location=await db().prepare("SELECT id FROM locations WHERE id=? AND organization_id=? AND status='active'").bind(locationId,organizationId).first();
   if(!location)fail(503,'La prise de commande pour le retrait à Ronchin est momentanément indisponible.');
   const s=await settings();
   if(!s.hoursConfirmed)fail(409,'Les horaires de retrait doivent encore être confirmés par la pizzeria.');
   if(!allowedSlot(Date.parse(input.slot),s))fail(409,'Ce créneau n’est plus disponible. Choisissez un autre horaire.');
   const priced=priceCart(input.items,{products:await productList(),ingredients:await ingredientList(),extraPrice:s.extraPrice},input.ticket);
   if(priced.problem)fail(409,priced.problem);
   if(priced.count>30)fail(400,'Pour plus de 30 articles, appelez la pizzeria.');
   if(input.ticket&&!s.loyaltyEnabled)fail(409,'La fidélité n’est pas encore activée.');
   if(input.ticket&&priced.ticketLine<0)fail(409,'Le ticket pizza offerte s’utilise sur une pizza hors offre « 2e pizza offerte ».');
   const items=priced.lines.map((l,i)=>({id:l.id,name:l.name,size:l.size,option:l.option,quantity:l.quantity,unitPrice:l.unitPrice,total:l.total,...(l.without.length?{without:l.without}:{}),...(l.extra.length?{extra:l.extra}:{}),...(l.extras?{extrasPrice:l.extras}:{}),...(l.free?{free:l.free}:{}),...(i===priced.ticketLine?{ticket:true}:{})}));
   const redeemed=input.ticket?s.rewardPoints:0;const earned=s.loyaltyEnabled?Math.floor(priced.total/100)*s.pointsPerEuro:0;
   const id=crypto.randomUUID();const now=new Date().toISOString();
   const result=await db().batch([
    db().prepare("INSERT INTO orders(id,user_id,idempotency,name,phone,email,items,note,slot,subtotal,offer_discount,discount,total,redeemed,earned,status,organization_id,location_id,channel,fulfillment,payment_status,payment_method,created_at,updated_at,version) SELECT ?,?,?,?,?,'',?,?,?,?,?,?,?,?,?,'pending',?,?,?,'pickup','due_at_pickup',NULL,?,?,1 WHERE (SELECT version FROM config WHERE id=1)=? AND (SELECT COUNT(*) FROM orders WHERE organization_id=? AND location_id=? AND slot=? AND status NOT IN ('rejected','cancelled'))<? AND (SELECT COALESCE(SUM(delta),0) FROM ledger WHERE user_id=?)>=? AND (SELECT COUNT(*) FROM orders WHERE user_id=? AND status='pending')<5 ON CONFLICT(user_id,idempotency) DO NOTHING").bind(id,actor,input.key,input.name,localPhone(user.phone),JSON.stringify(items),input.note,input.slot,priced.subtotal,priced.offer,priced.ticketDiscount,priced.total,redeemed,earned,organizationId,locationId,'web',now,now,s.version,organizationId,locationId,input.slot,s.capacity,actor,redeemed,actor),
    db().prepare("INSERT OR IGNORE INTO ledger(id,user_id,order_id,delta,kind,created_at) SELECT ?,user_id,id,-redeemed,'redemption',? FROM orders WHERE id=? AND redeemed>0").bind(`${id}:redemption`,now,id),
    db().prepare("INSERT OR IGNORE INTO events(id,order_id,status,actor,note,created_at) SELECT ?,id,'pending',?,'Commande envoyée',? FROM orders WHERE id=?").bind(`${id}:1`,actor,now,id)
   ]);
   if(!result[0].meta.changes){const repeat=await db().prepare('SELECT * FROM orders WHERE user_id=? AND idempotency=?').bind(actor,input.key).first();if(repeat)return json({order:orderView(repeat)});fail(409,'Le créneau, votre solde ou la carte a changé. Actualisez les disponibilités et réessayez.');}
   return json({order:orderView(await db().prepare('SELECT * FROM orders WHERE id=?').bind(id).first())},201);
  }
  if(path[0]==='orders'&&path[1]&&method==='GET'){
   const order=await db().prepare('SELECT * FROM orders WHERE id=? AND user_id=?').bind(path[1],actor).first();if(!order)fail(404,'Commande introuvable.');
   const events=await db().prepare('SELECT status,note,created_at FROM events WHERE order_id=? ORDER BY created_at').bind(path[1]).all();return json({order:orderView(order),events:events.results});
  }
  if(path[0]==='admin'&&path[1]==='claim'&&method==='POST'){
   const input=z.object({code:z.string().min(20).max(200)}).parse(await body());const required=secret();
   const digest=async(s:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s))));const a=await digest(input.code),b=await digest(required);let difference=0;for(let i=0;i<a.length;i++)difference|=a[i]^b[i];
   if(!required||difference)fail(403,'Code d’installation incorrect.');
   const result=await db().prepare("INSERT INTO roles(user_id,role) SELECT ?,'admin' WHERE NOT EXISTS(SELECT 1 FROM roles WHERE role='admin')").bind(actor).run();
   if(!result.meta.changes&&!(await isAdmin(actor)))fail(403,'L’administration est déjà attribuée.');return json({ok:true});
  }
  if(path[0]==='orders'&&path[1]&&method==='PATCH')return await updateOrder(path[1],actor,await body(),false);
  if(path[0]!=='admin')fail(404,'Page introuvable.');
  if(!(await isAdmin(actor)))fail(403,'Cet espace est réservé à l’équipe de la pizzeria.');
  if(method==='GET'&&!path[1]){
   const orders=await db().prepare('SELECT * FROM orders WHERE organization_id=? AND location_id=? ORDER BY created_at DESC LIMIT 300').bind(PILOT_ORGANIZATION_ID,PILOT_LOCATION_ID).all();
   const stats=await db().prepare("SELECT COUNT(*) AS count,COALESCE(SUM(total),0) AS revenue FROM orders WHERE organization_id=? AND location_id=? AND status='completed'").bind(PILOT_ORGANIZATION_ID,PILOT_LOCATION_ID).first();
   const audience=await db().prepare('SELECT COUNT(*) AS customers,COALESCE(SUM(marketing),0) AS subscribers FROM users').first<{customers:number;subscribers:number}>();
   return json({orders:orders.results.map(orderView),settings:await settings(),products:await productList(true),ingredients:await ingredientList(),stats,audience,sms:smsMode(local)});
  }
  if(path[1]==='kitchen'&&method==='GET'){
   const orders=await db().prepare("SELECT * FROM orders WHERE organization_id=? AND location_id=? AND (status='preparing' OR (status='ready' AND updated_at>?)) ORDER BY slot LIMIT 100").bind(PILOT_ORGANIZATION_ID,PILOT_LOCATION_ID,new Date(Date.now()-2*3600000).toISOString()).all();
   return json({orders:orders.results.map(orderView)});
  }
  if(path[1]==='orders'&&path[2]&&method==='PATCH')return await updateOrder(path[2],actor,await body(),true);
  if(path[1]==='settings'&&method==='PUT'){
   const s=settingsInput.parse(await body());
   for(const h of s.hours){if(!h.closed&&h.close!=='00:00'&&h.open>=h.close)fail(400,'L’heure de fermeture doit suivre l’ouverture, ou être minuit.');}
   const result=await db().prepare('UPDATE config SET value=?,version=version+1 WHERE id=1 AND version=?').bind(JSON.stringify(s),s.version).run();
   if(!result.meta.changes)fail(409,'Les réglages ont changé. Rechargez-les avant d’enregistrer.');return json({settings:await settings()});
  }
  if(path[1]==='products')return await products(request,path[2],path[3],method,body);
  if(path[1]==='ingredients'||path[1]==='origins')return await ingredients(path[1],path[2],method,body);
  if(path[1]==='campaigns')return await campaigns(url,path[2],path[3],method,body,actor,local);
  fail(404,'Cette action est introuvable.');
 }catch(e){if(e instanceof z.ZodError)return json({error:e.issues[0]?.message||'Vérifiez les champs du formulaire.',fields:e.flatten().fieldErrors},400);if(e instanceof HttpError||e instanceof AuthError)return json({error:e.message},e.status);console.error('Dolce API error',e instanceof Error?e.message:'unknown');return json({error:'Le service est momentanément indisponible. Vos informations sont conservées ; réessayez.'},503);}
}
async function updateOrder(id:string,actor:string,data:unknown,admin:boolean){
 const input=z.object({status:z.enum(['confirmed','preparing','ready','completed','rejected','cancelled']),version:z.number().int().positive(),reason:z.string().trim().max(250).default('')}).parse(data);
 const order=admin
  ?await db().prepare('SELECT user_id,status,version FROM orders WHERE id=? AND organization_id=? AND location_id=?').bind(id,PILOT_ORGANIZATION_ID,PILOT_LOCATION_ID).first<{user_id:string;status:string;version:number}>()
  :await db().prepare('SELECT user_id,status,version FROM orders WHERE id=?').bind(id).first<{user_id:string;status:string;version:number}>();if(!order||(!admin&&order.user_id!==actor))fail(404,'Commande introuvable.');
 if(!admin&&(order.status!=='pending'||input.status!=='cancelled'))fail(409,'Cette commande a déjà été prise en charge. Appelez la pizzeria.');
 if(!nextStatus(order.status,input.status))fail(409,'Cette commande a changé d’état. Actualisez la liste.');
 if(admin&&['cancelled','rejected'].includes(input.status)&&input.reason.length<3)fail(400,'Indiquez le motif communiqué au client.');
 const now=new Date().toISOString();const next=input.version+1;
 const reason=input.reason||(!admin?'Annulée par le client':'');const note=reason||(input.status==='preparing'?(order.status==='pending'?'Validée et envoyée en cuisine':'Envoyée en cuisine'):'');
 const result=await db().batch([
  db().prepare('UPDATE orders SET status=?,reason=?,version=version+1,updated_at=? WHERE id=? AND version=? AND status=? AND (?=0 OR (organization_id=? AND location_id=?))').bind(input.status,reason,now,id,input.version,order.status,admin?1:0,PILOT_ORGANIZATION_ID,PILOT_LOCATION_ID),
  // Points are credited once, as soon as the team validates the order.
  db().prepare("INSERT OR IGNORE INTO ledger(id,user_id,order_id,delta,kind,created_at) SELECT ?,user_id,id,earned,'earned',? FROM orders WHERE id=? AND version=? AND status IN ('confirmed','preparing') AND earned>0").bind(`${id}:earned`,now,id,next),
  db().prepare("INSERT OR IGNORE INTO ledger(id,user_id,order_id,delta,kind,created_at) SELECT ?,user_id,id,redeemed,'refund',? FROM orders WHERE id=? AND status IN ('rejected','cancelled') AND version=? AND redeemed>0").bind(`${id}:refund`,now,id,next),
  // A validated order cancelled later loses its points, without pushing the balance below zero.
  db().prepare("INSERT OR IGNORE INTO ledger(id,user_id,order_id,delta,kind,created_at) SELECT ?,o.user_id,o.id,-MIN(o.earned,MAX((SELECT COALESCE(SUM(delta),0) FROM ledger WHERE user_id=o.user_id),0)),'reversal',? FROM orders o WHERE o.id=? AND o.version=? AND o.status='cancelled' AND EXISTS(SELECT 1 FROM ledger WHERE id=?)").bind(`${id}:reversal`,now,id,next,`${id}:earned`),
  db().prepare('INSERT OR IGNORE INTO events(id,order_id,status,actor,note,created_at) SELECT ?,id,status,?,?,? FROM orders WHERE id=? AND version=? AND status=?').bind(`${id}:${next}`,actor,note,now,id,next,input.status)
 ]);
 if(!result[0].meta.changes)fail(409,'Une autre action a modifié cette commande. Actualisez la liste.');
 const updated=admin
  ?await db().prepare('SELECT * FROM orders WHERE id=? AND organization_id=? AND location_id=?').bind(id,PILOT_ORGANIZATION_ID,PILOT_LOCATION_ID).first()
  :await db().prepare('SELECT * FROM orders WHERE id=?').bind(id).first();
 return json({order:orderView(updated)});
}

// ── Menu administration ────────────────────────────────────────────────
const productRow=(id:string)=>db().prepare('SELECT * FROM products WHERE id=?').bind(id).first<Parameters<typeof toProduct>[0]>();
async function uniqueId(table:'products'|'ingredients',name:string,fallback:string){
 const base=slugify(name)||fallback;for(let n=1;n<100;n++){const id=n===1?base:`${base}-${n}`;if(!await db().prepare(`SELECT 1 FROM ${table} WHERE id=?`).bind(id).first())return id;}
 return `${base}-${crypto.randomUUID().slice(0,6)}`;
}
async function checkProduct(p:z.infer<typeof productFields>){
 const known=new Set((await ingredientList()).map(i=>i.id));
 if(p.xxl!==null&&p.xxl<=p.price)fail(400,'Le prix XXL doit être supérieur au prix Senior.');
 if(p.offer&&p.xxl===null)fail(400,'L’offre « 2e pizza offerte » concerne uniquement les pizzas Senior et XXL.');
 if(new Set(p.ingredients).size!==p.ingredients.length)fail(400,'Un ingrédient apparaît deux fois dans la recette.');
 const unknown=p.ingredients.find(id=>!known.has(id));if(unknown)fail(400,'Un ingrédient de la recette n’existe plus. Rechargez la page.');
 if(p.xxl!==null&&p.status==='published'&&p.ingredients.length<2)fail(400,'Ajoutez les ingrédients de la pizza avant de la publier.');
 return {...p,description:p.description||describe(p.ingredients,await ingredientList())};
}
async function products(request:Request,id:string|undefined,sub:string|undefined,method:string,body:()=>Promise<unknown>){
 const now=new Date().toISOString();
 if(!id&&method==='POST'){
  const p=await checkProduct(productFields.parse(await body()));
  const newId=await uniqueId('products',p.name,'article');
  const last=await db().prepare('SELECT COALESCE(MAX(sort),0) AS sort FROM products').first<{sort:number}>();
  await insertProduct({...p,id:newId,photo:'none',sort:(last?.sort||0)+1}).run();
  return json({product:toProduct((await productRow(newId))!)},201);
 }
 if(!id)fail(404,'Cette action est introuvable.');
 const row=await productRow(id);if(!row)fail(404,'Cet article n’existe plus. Rechargez la carte.');const current=toProduct(row);
 if(sub==='photo')return await productPhoto(request,current,method);
 if(method==='PUT'){
  const input=productFields.partial().extend({version:z.number().int().positive()}).parse(await body());
  const merged={name:current.name,category:current.category,description:current.description,tagline:current.tagline||'',price:current.price,xxl:current.xxl,ingredients:current.ingredients||[],allergens:current.allergens||[],allergensChecked:!!current.allergensChecked,options:current.options||[],spicy:!!current.spicy,offer:!!current.offer,available:current.available,status:current.status||'published',...input};
  if((current.xxl===null)!==(merged.xxl===null))fail(400,'Conservez les tailles proposées pour cet article.');
  const p=await checkProduct(merged);
  const r=await db().prepare('UPDATE products SET name=?,category=?,description=?,tagline=?,price=?,xxl=?,ingredients=?,allergens=?,allergens_checked=?,options=?,spicy=?,offer=?,available=?,status=?,version=version+1,updated_at=? WHERE id=? AND version=?')
   .bind(p.name,p.category,p.description,p.tagline,p.price,p.xxl,JSON.stringify(p.ingredients),JSON.stringify(p.allergens),p.allergensChecked?1:0,JSON.stringify(p.options),p.spicy?1:0,p.offer?1:0,p.available?1:0,p.status,now,id,input.version).run();
  if(!r.meta.changes)fail(409,'Cet article a été modifié sur un autre appareil. Rechargez-le avant d’enregistrer.');
  return json({product:toProduct((await productRow(id))!)});
 }
 if(method==='DELETE'){
  // A product already ordered stays in the database, hidden, so past orders and loyalty stay exact.
  const ordered=await db().prepare('SELECT 1 FROM orders WHERE instr(items,?) LIMIT 1').bind(`"id":"${id}"`).first();
  if(ordered){await db().prepare("UPDATE products SET status='archived',version=version+1,updated_at=? WHERE id=?").bind(now,id).run();return json({archived:true});}
  await db().batch([db().prepare('DELETE FROM products WHERE id=?').bind(id),db().prepare('DELETE FROM product_photos WHERE product_id=?').bind(id)]);
  return json({archived:false});
 }
 fail(404,'Cette action est introuvable.');
}
const isWebp=(b:Uint8Array)=>b.length>12&&String.fromCharCode(...b.slice(0,4))==='RIFF'&&String.fromCharCode(...b.slice(8,12))==='WEBP';
const isPng=(b:Uint8Array)=>b.length>8&&b[0]===0x89&&String.fromCharCode(...b.slice(1,4))==='PNG';
async function productPhoto(request:Request,p:Product,method:string){
 const now=new Date().toISOString();const previous=(p.photo||'').split(':')[0];
 if(method==='DELETE'){await db().batch([db().prepare("UPDATE products SET photo='none',version=version+1,updated_at=? WHERE id=?").bind(now,p.id),db().prepare('DELETE FROM product_photos WHERE product_id=?').bind(p.id)]);return json({product:toProduct((await productRow(p.id))!)});}
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
  ...files.map(f=>db().prepare('INSERT INTO product_photos(product_id,version,width,mime,data,created_at) VALUES(?,?,?,?,?,?)').bind(p.id,version,f.width,f.mime,f.data,now)),
  db().prepare('DELETE FROM product_photos WHERE product_id=? AND version NOT IN (?,?)').bind(p.id,version,previous||'-'),
  db().prepare('UPDATE products SET photo=?,version=version+1,updated_at=? WHERE id=?').bind(`${version}:${files.map(f=>f.width).join(',')}`,now,p.id),
 ]);
 return json({product:toProduct((await productRow(p.id))!)});
}
async function photo(request:Request,id='',version='',width:number){
 const cache=(globalThis as unknown as {caches?:{default?:Cache}}).caches?.default;
 const hit=await cache?.match(request).catch(()=>undefined);if(hit)return hit;
 const row=/^[a-z0-9-]{1,80}$/.test(id)&&/^[a-f0-9]{10}$/.test(version)?await db().prepare('SELECT mime,data FROM product_photos WHERE product_id=? AND version=? AND width=?').bind(id,version,width).first<{mime:string;data:ArrayBuffer}>():null;
 if(!row)return new Response('Photo introuvable',{status:404,headers:{'Cache-Control':'no-store'}});
 // Each upload gets a new version in its address, so a photo never changes once published.
 const response=new Response(new Uint8Array(row.data),{headers:{'Content-Type':row.mime,'Cache-Control':'public, max-age=31536000, immutable'}});
 await cache?.put(request,response.clone()).catch(()=>{});
 return response;
}
async function ingredients(kind:string,id:string|undefined,method:string,body:()=>Promise<unknown>){
 if(kind==='origins'&&method==='PUT'){
  const rows=z.array(z.object({id:clean.max(80),meat:ingredientFields.shape.meat,origin:clean.max(80)})).max(200).parse(await body());
  if(rows.length)await db().batch(rows.map(r=>db().prepare('UPDATE ingredients SET meat=?,origin=? WHERE id=?').bind(r.meat,r.origin,r.id)));
  return json({ingredients:await ingredientList()});
 }
 if(kind!=='ingredients')fail(404,'Cette action est introuvable.');
 if(!id&&method==='POST'){
  const i=ingredientFields.parse(await body());
  const same=(await ingredientList()).find(x=>slugify(x.name)===slugify(i.name));if(same)fail(409,`« ${same.name} » existe déjà.`);
  const newId=await uniqueId('ingredients',i.name,'ingredient');const last=await db().prepare('SELECT COALESCE(MAX(sort),0) AS sort FROM ingredients').first<{sort:number}>();
  await db().prepare('INSERT INTO ingredients(id,name,allergens,meat,origin,extra,available,locked,sort) VALUES(?,?,?,?,?,?,?,0,?)').bind(newId,i.name,JSON.stringify(i.allergens),i.meat,i.origin,i.extra?1:0,i.available?1:0,(last?.sort||0)+1).run();
  const row=await db().prepare('SELECT * FROM ingredients WHERE id=?').bind(newId).first<Parameters<typeof toIngredient>[0]>();
  return json({ingredient:toIngredient(row!)},201);
 }
 if(!id)fail(404,'Cette action est introuvable.');
 const current=(await ingredientList()).find(i=>i.id===id);if(!current)fail(404,'Cet ingrédient n’existe plus.');
 if(method==='PUT'){
  const i={...current,...ingredientFields.partial().parse(await body())};
  await db().prepare('UPDATE ingredients SET name=?,allergens=?,meat=?,origin=?,extra=?,available=? WHERE id=?').bind(i.name,JSON.stringify(i.allergens),i.meat,i.origin,i.extra&&!current.locked?1:0,i.available?1:0,id).run();
  return json({ingredients:await ingredientList()});
 }
 if(method==='DELETE'){
  if(current.locked)fail(409,'La pâte fait partie de toutes les pizzas : modifiez ses allergènes, mais ne la supprimez pas.');
  const users=(await productList(true)).filter(p=>p.status!=='archived'&&p.ingredients?.includes(id));
  if(users.length)fail(409,`${current.name} est utilisé dans : ${users.map(p=>p.name).join(', ')}. Retirez-le de ces recettes d’abord.`);
  await db().prepare('DELETE FROM ingredients WHERE id=?').bind(id).run();
  return json({ingredients:await ingredientList()});
 }
 fail(404,'Cette action est introuvable.');
}

// ── Promotional SMS ────────────────────────────────────────────────────
type CampaignRow={id:string;message:string;status:string;total:number;sent:number;failed:number;simulated:number;created_at:string;finished_at:string};
const campaignRow=(id:string)=>db().prepare('SELECT * FROM campaigns WHERE id=?').bind(id).first<CampaignRow>();
async function campaigns(url:URL,id:string|undefined,sub:string|undefined,method:string,body:()=>Promise<unknown>,actor:string,local:boolean){
 const mode=smsMode(local);
 if(!id&&method==='GET'){const r=await db().prepare('SELECT * FROM campaigns ORDER BY created_at DESC LIMIT 20').all<CampaignRow>();return json({campaigns:r.results,sms:mode});}
 if(!id&&method==='POST'){
  const{message}=z.object({message:clean.min(10,'Écrivez votre message (10 caractères minimum).').max(420,'Message trop long : 420 caractères maximum.')}).parse(await body());
  if(mode==='off')fail(503,'L’envoi de SMS n’est pas encore configuré (clé Brevo manquante).');
  if(await db().prepare("SELECT 1 FROM campaigns WHERE status='sending'").first())fail(409,'Un envoi est déjà en cours. Terminez-le avant d’en commencer un autre.');
  const audience=await db().prepare('SELECT COUNT(*) AS n FROM users WHERE marketing=1').first<{n:number}>();
  if(!audience?.n)fail(409,'Aucun client n’a encore accepté de recevoir vos SMS.');
  // The signed stop link is generated per recipient immediately before sending.
  const content=`Dolce Pizz' : ${message}`;
  const newId=crypto.randomUUID();const now=new Date().toISOString();
  await db().batch([
   db().prepare("INSERT INTO campaigns(id,message,status,total,sent,failed,simulated,created_by,created_at) VALUES(?,?,'sending',0,0,0,?,?,?)").bind(newId,content,mode==='demo'?1:0,actor,now),
   db().prepare('INSERT INTO campaign_recipients(campaign_id,user_id,phone) SELECT ?,id,phone FROM users WHERE marketing=1').bind(newId),
   db().prepare('UPDATE campaigns SET total=(SELECT COUNT(*) FROM campaign_recipients WHERE campaign_id=?) WHERE id=?').bind(newId,newId),
  ]);
  return json({campaign:await campaignRow(newId)},201);
 }
 if(!id)fail(404,'Cette action est introuvable.');
 const campaign=await campaignRow(id);if(!campaign)fail(404,'Envoi introuvable.');
 if(sub==='send'&&method==='POST'){
  if(campaign.status!=='sending')return json({campaign});
  if(!campaign.simulated){
   if(mode!=='live')fail(503,'L’envoi de SMS n’est pas encore configuré (clé Brevo manquante).');
   const p=parisParts(Date.now());if(p.day===0||p.minute<480||p.minute>=1200)fail(409,'Les SMS promotionnels partent du lundi au samedi, entre 8 h et 20 h. L’envoi reprendra quand vous relancerez à ces horaires.');
  }
  // Small batches: each request stays well under the platform's limit on outgoing calls; the admin page loops.
  const batch=await db().prepare("SELECT r.user_id,r.phone,u.marketing FROM campaign_recipients r LEFT JOIN users u ON u.id=r.user_id WHERE r.campaign_id=? AND r.status='pending' LIMIT 20").bind(id).all<{user_id:string;phone:string;marketing:number|null}>();
  const now=new Date().toISOString();const updates:D1PreparedStatement[]=[];
  for(const r of batch.results){
   let status:string;
   if(!r.marketing)status='skipped';
   else if(campaign.simulated)status='simulated';
   else{
    const token=await marketingStopProof(r.phone);const link=new URL('/api/marketing/stop',url.origin);link.searchParams.set('token',token);
    const content=`${campaign.message.replace(/\nSTOP SMS : [^\n]*$/,'')}\nSTOP SMS : ${link.toString()}`;
    status=await sendSms(r.phone,content,'marketing','promo')?'sent':'failed';
   }
   updates.push(db().prepare('UPDATE campaign_recipients SET status=?,sent_at=? WHERE campaign_id=? AND user_id=?').bind(status,now,id,r.user_id));
  }
  updates.push(db().prepare("UPDATE campaigns SET sent=(SELECT COUNT(*) FROM campaign_recipients WHERE campaign_id=?1 AND status IN ('sent','simulated')),failed=(SELECT COUNT(*) FROM campaign_recipients WHERE campaign_id=?1 AND status='failed'),status=CASE WHEN EXISTS(SELECT 1 FROM campaign_recipients WHERE campaign_id=?1 AND status='pending') THEN 'sending' ELSE 'done' END,finished_at=CASE WHEN EXISTS(SELECT 1 FROM campaign_recipients WHERE campaign_id=?1 AND status='pending') THEN '' ELSE ?2 END WHERE id=?1").bind(id,now));
  await db().batch(updates);
  return json({campaign:await campaignRow(id)});
 }
 if(sub==='cancel'&&method==='POST'){await db().prepare("UPDATE campaigns SET status='done',finished_at=? WHERE id=? AND status='sending'").bind(new Date().toISOString(),id).run();return json({campaign:await campaignRow(id)});}
 fail(404,'Cette action est introuvable.');
}
export const GET=handler;export const POST=handler;export const PATCH=handler;export const PUT=handler;export const DELETE=handler;
