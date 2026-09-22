import {NextResponse} from 'next/server';
import {z} from 'zod';
import {getChatGPTUser} from '@/app/chatgpt-auth';
import {db,ensureSeed,settings,productList,balance,isAdmin,orderView,secret} from '@/lib/server';
import {slots,allowedSlot,nextStatus} from '@/lib/rules';
export const dynamic='force-dynamic';
const json=(data:unknown,status=200)=>NextResponse.json(data,{status,headers:{'Cache-Control':'no-store'}});
class HttpError extends Error{constructor(public status:number,message:string){super(message);}}
const fail=(status:number,message:string):never=>{throw new HttpError(status,message);};
const clean=z.string().trim();
const orderInput=z.object({key:z.string().uuid(),name:clean.min(2,'Indiquez votre nom.').max(80),phone:clean.regex(/^(?:\+33|0)[1-9](?:[ .-]?\d{2}){4}$/,'Indiquez un numéro de téléphone français valide.'),note:clean.max(500).default(''),slot:z.string().datetime(),redeem:z.boolean(),items:z.array(z.object({id:clean.max(80),size:z.enum(['senior','xxl','unique']),quantity:z.number().int().min(1).max(20),option:clean.max(80).default('')})).min(1).max(40)});
const settingsInput=z.object({enabled:z.boolean(),hoursConfirmed:z.boolean(),leadMinutes:z.number().int().min(15).max(180),cutoffMinutes:z.number().int().min(0).max(120),capacity:z.number().int().min(1).max(30),hours:z.array(z.object({open:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),close:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),closed:z.boolean()})).length(7),closures:z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).max(365),loyaltyEnabled:z.boolean(),pointsPerEuro:z.number().int().min(1).max(10),rewardPoints:z.number().int().min(10).max(10000),rewardCents:z.number().int().min(100).max(3000),version:z.number().int().positive()});
async function handler(request:Request){
 try{
  const path=new URL(request.url).pathname.slice(5).split('/'); const method=request.method;
  if(method!=='GET'){
   const origin=request.headers.get('origin');if(!origin||origin!==new URL(request.url).origin)fail(403,'Cette demande doit être envoyée depuis le site.');
   if(Number(request.headers.get('content-length')||0)>35000)fail(413,'La demande est trop volumineuse.');
  }
  await ensureSeed();
  const user=await getChatGPTUser();
  const body=async()=>{const text=await request.text();if(text.length>35000)fail(413,'La demande est trop volumineuse.');try{return JSON.parse(text);}catch{fail(400,'Vérifiez les informations envoyées.');}};
  if(path[0]==='catalog'&&method==='GET')return json({products:await productList(),settings:await settings()});
  if(path[0]==='slots'&&method==='GET'){
   const s=await settings();const r=await db().prepare("SELECT slot,COUNT(*) AS n FROM orders WHERE status NOT IN ('rejected','cancelled') AND slot>? GROUP BY slot").bind(new Date().toISOString()).all<{slot:string;n:number}>();
   return json({slots:slots(s,Object.fromEntries(r.results.map(v=>[v.slot,v.n]))),settings:s});
  }
  if(path[0]==='me'&&method==='GET'){
   const s=await settings();const loyalty={enabled:s.loyaltyEnabled,pointsPerEuro:s.pointsPerEuro,rewardPoints:s.rewardPoints,rewardCents:s.rewardCents};
   if(!user)return json({user:null,admin:false,balance:0,orders:[],loyalty});
   const rows=await db().prepare('SELECT * FROM orders WHERE user_id=? ORDER BY created_at DESC LIMIT 100').bind(user.userId).all();
   return json({user:{name:user.displayName,email:user.email},admin:await isAdmin(user.userId),balance:await balance(user.userId),orders:rows.results.map(orderView),loyalty});
  }
  if(!user)fail(401,'Connectez-vous pour continuer.');
  const actor=user!.userId;
  if(path[0]==='orders'&&method==='POST'&&!path[1]){
   const input=orderInput.parse(await body());
   const previous=await db().prepare('SELECT * FROM orders WHERE user_id=? AND idempotency=?').bind(actor,input.key).first();
   if(previous)return json({order:orderView(previous)});
   const s=await settings();
   if(!s.hoursConfirmed)fail(409,'Les horaires de retrait doivent encore être confirmés par la pizzeria.');
   if(!allowedSlot(Date.parse(input.slot),s))fail(409,'Ce créneau n’est plus disponible. Choisissez un autre horaire.');
   const products=await productList();const items=input.items.map(line=>{
    const p=products.find(p=>p.id===line.id);if(!p||!p.available)fail(409,'Un article n’est plus disponible. Mettez votre panier à jour.');
    if((p.xxl===null&&line.size!=='unique')||(p.xxl!==null&&!['senior','xxl'].includes(line.size)))fail(400,'Choisissez une taille valide.');
    if(p.options.length&&!p.options.includes(line.option))fail(400,`Choisissez la garniture de ${p.name}.`);
    if(!p.options.length&&line.option)fail(400,'Cette option n’est pas proposée.');
    return {...line,name:p.name,unitPrice:line.size==='xxl'?p.xxl:p.price};
   });
   const quantity=items.reduce((n,i)=>n+i.quantity,0);if(quantity>30)fail(400,'Pour plus de 30 articles, appelez la pizzeria.');
   const subtotal=items.reduce((n,i)=>n+i.quantity*i.unitPrice,0);
   if(input.redeem&&!s.loyaltyEnabled)fail(409,'La fidélité n’est pas encore activée.');
   const redeemed=input.redeem?s.rewardPoints:0;const discount=input.redeem?Math.min(s.rewardCents,subtotal):0;const total=subtotal-discount;
   const earned=s.loyaltyEnabled?Math.floor(total/100)*s.pointsPerEuro:0;
   const id=crypto.randomUUID();const now=new Date().toISOString();
   const result=await db().batch([
    db().prepare("INSERT INTO orders(id,user_id,idempotency,name,phone,email,items,note,slot,subtotal,discount,total,redeemed,earned,status,created_at,updated_at,version) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,'pending',?,?,1 WHERE (SELECT version FROM config WHERE id=1)=? AND (SELECT COUNT(*) FROM orders WHERE slot=? AND status NOT IN ('rejected','cancelled'))<? AND (SELECT COALESCE(SUM(delta),0) FROM ledger WHERE user_id=?)>=? AND (SELECT COUNT(*) FROM orders WHERE user_id=? AND status='pending')<5 ON CONFLICT(user_id,idempotency) DO NOTHING").bind(id,actor,input.key,input.name,input.phone,user!.email,JSON.stringify(items),input.note,input.slot,subtotal,discount,total,redeemed,earned,now,now,s.version,input.slot,s.capacity,actor,redeemed,actor),
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
   const orders=await db().prepare('SELECT * FROM orders ORDER BY created_at DESC LIMIT 300').all();
   const stats=await db().prepare("SELECT COUNT(*) AS count,COALESCE(SUM(total),0) AS revenue FROM orders WHERE status='completed'").first();
   return json({orders:orders.results.map(orderView),settings:await settings(),products:await productList(),stats});
  }
  if(path[1]==='orders'&&path[2]&&method==='PATCH')return await updateOrder(path[2],actor,await body(),true);
  if(path[1]==='settings'&&method==='PUT'){
   const s=settingsInput.parse(await body());
   for(const h of s.hours){if(!h.closed&&h.close!=='00:00'&&h.open>=h.close)fail(400,'L’heure de fermeture doit suivre l’ouverture, ou être minuit.');}
   const result=await db().prepare('UPDATE config SET value=?,version=version+1 WHERE id=1 AND version=?').bind(JSON.stringify(s),s.version).run();
   if(!result.meta.changes)fail(409,'Les réglages ont changé. Rechargez-les avant d’enregistrer.');return json({settings:await settings()});
  }
  if(path[1]==='products'&&path[2]&&method==='PUT'){
   const p=z.object({name:clean.min(2).max(80),description:clean.min(3).max(500),price:z.number().int().min(1).max(10000),xxl:z.number().int().min(1).max(10000).nullable(),available:z.boolean(),version:z.number().int().positive()}).parse(await body());
   const existing=await db().prepare('SELECT id,xxl FROM products WHERE id=?').bind(path[2]).first<{id:string;xxl:number|null}>();if(!existing)fail(404,'Article introuvable.');const existingXxl=existing!.xxl;if((existingXxl===null)!==(p.xxl===null))fail(400,'Conservez les tailles proposées pour cet article.');
   const result=await db().batch([db().prepare('UPDATE products SET name=?,description=?,price=?,xxl=?,available=? WHERE id=? AND (SELECT version FROM config WHERE id=1)=?').bind(p.name,p.description,p.price,p.xxl,p.available?1:0,path[2],p.version),db().prepare('UPDATE config SET version=version+1 WHERE id=1 AND version=?').bind(p.version)]);
   if(!result[0].meta.changes)fail(409,'La carte a changé. Actualisez avant de modifier cet article.');return json({ok:true});
  }
  fail(404,'Cette action est introuvable.');
 }catch(e){if(e instanceof z.ZodError)return json({error:e.issues[0]?.message||'Vérifiez les champs du formulaire.',fields:e.flatten().fieldErrors},400);if(e instanceof HttpError)return json({error:e.message},e.status);console.error('Dolce API error',e instanceof Error?e.message:'unknown');return json({error:'Le service est momentanément indisponible. Vos informations sont conservées ; réessayez.'},503);}
}
async function updateOrder(id:string,actor:string,data:unknown,admin:boolean){
 const input=z.object({status:z.enum(['confirmed','preparing','ready','completed','rejected','cancelled']),version:z.number().int().positive(),reason:z.string().trim().max(250).default('')}).parse(data);
 const order=await db().prepare('SELECT user_id,status,version FROM orders WHERE id=?').bind(id).first<{user_id:string;status:string;version:number}>();if(!order||(!admin&&order.user_id!==actor))fail(404,'Commande introuvable.');
 if(!admin&&(order.status!=='pending'||input.status!=='cancelled'))fail(409,'Cette commande a déjà été prise en charge. Appelez la pizzeria.');
 if(!nextStatus(order.status,input.status))fail(409,'Cette commande a changé d’état. Actualisez la liste.');
 if(admin&&['cancelled','rejected'].includes(input.status)&&input.reason.length<3)fail(400,'Indiquez le motif communiqué au client.');
 const now=new Date().toISOString();const reason=input.reason||(!admin?'Annulée par le client':'');
 const result=await db().batch([
  db().prepare('UPDATE orders SET status=?,reason=?,version=version+1,updated_at=? WHERE id=? AND version=? AND status=?').bind(input.status,reason,now,id,input.version,order.status),
  db().prepare("INSERT OR IGNORE INTO ledger(id,user_id,order_id,delta,kind,created_at) SELECT ?,user_id,id,earned,'earned',? FROM orders WHERE id=? AND status='completed' AND version=? AND earned>0").bind(`${id}:earned`,now,id,input.version+1),
  db().prepare("INSERT OR IGNORE INTO ledger(id,user_id,order_id,delta,kind,created_at) SELECT ?,user_id,id,redeemed,'refund',? FROM orders WHERE id=? AND status IN ('rejected','cancelled') AND version=? AND redeemed>0").bind(`${id}:refund`,now,id,input.version+1),
  db().prepare('INSERT OR IGNORE INTO events(id,order_id,status,actor,note,created_at) SELECT ?,id,status,?,?,? FROM orders WHERE id=? AND version=? AND status=?').bind(`${id}:${input.version+1}`,actor,reason,now,id,input.version+1,input.status)
 ]);
 if(!result[0].meta.changes)fail(409,'Une autre action a modifié cette commande. Actualisez la liste.');
 return json({order:orderView(await db().prepare('SELECT * FROM orders WHERE id=?').bind(id).first())});
}
export const GET=handler;export const POST=handler;export const PATCH=handler;export const PUT=handler;
