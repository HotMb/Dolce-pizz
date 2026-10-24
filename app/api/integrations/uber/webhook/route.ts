import {env} from 'cloudflare:workers';
import {NextResponse} from 'next/server';
import {z} from 'zod';
import {db} from '@/lib/server';

export const dynamic='force-dynamic';
const json=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'no-store'}});
class WebhookError extends Error{constructor(public status:number,message:string){super(message);}}
const event=z.object({eventId:z.string().trim().min(8).max(160),eventType:z.enum(['order.created','order.cancelled']),storeId:z.string().trim().min(1).max(160),orderId:z.string().trim().min(1).max(160),customerName:z.string().trim().max(120).default('Commande Uber Eats'),totalCents:z.number().int().nonnegative().max(1000000),note:z.string().trim().max(500).default(''),items:z.array(z.object({sku:z.string().trim().min(1).max(120),name:z.string().trim().min(1).max(120),quantity:z.number().int().min(1).max(50),priceCents:z.number().int().nonnegative().max(100000),modifiers:z.array(z.string().trim().max(100)).max(30).default([])}).strict()).max(100).default([])}).strict();
type UberEvent=z.infer<typeof event>;
const vars=()=>env as unknown as Record<string,string|undefined>;
const hex=(value:Uint8Array)=>Array.from(value,v=>v.toString(16).padStart(2,'0')).join('');
const hmac=async(secret:string,payload:string)=>hex(new Uint8Array(await crypto.subtle.sign('HMAC',await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']),new TextEncoder().encode(payload))));
const equal=(a:string,b:string)=>{if(!/^[a-f0-9]{64}$/.test(a)||a.length!==b.length)return false;let difference=0;for(let i=0;i<a.length;i++)difference|=a.charCodeAt(i)^b.charCodeAt(i);return difference===0;};
const kind=(category:string)=>category==='pizzas'?'pizza':category==='boissons'?'drink':category==='desserts'?'dessert':category==='salades'?'prepared_food':'other';

/** Accept only signed, replay-safe Uber Eats events and expose them to the POS/KDS. */
export async function POST(request:Request){
 try{
  const secret=vars().UBER_EATS_WEBHOOK_SECRET||process.env.UBER_EATS_WEBHOOK_SECRET||'';if(!secret)throw new WebhookError(503,'Le connecteur Uber Eats n’est pas configuré.');
  const raw=await request.text();if(raw.length>120000)throw new WebhookError(413,'La demande est trop volumineuse.');
  const signature=(request.headers.get('x-uber-signature')||'').replace(/^sha256=/,'').toLowerCase();if(!equal(signature,await hmac(secret,raw)))throw new WebhookError(401,'Signature Uber Eats invalide.');
  let input:UberEvent;try{input=event.parse(JSON.parse(raw));}catch(error){if(error instanceof z.ZodError)throw new WebhookError(400,error.issues[0]?.message||'Événement Uber Eats invalide.');throw new WebhookError(400,'Événement Uber Eats illisible.');}
  if(input.eventType==='order.created'&&!input.items.length)throw new WebhookError(400,'Une commande Uber Eats doit contenir un article.');
  const integration=await db().prepare("SELECT organization_id,location_id FROM delivery_integrations WHERE provider='uber_eats' AND external_store_id=? AND status='active'").bind(input.storeId).first<{organization_id:string;location_id:string}>();if(!integration)throw new WebhookError(404,'Le magasin Uber Eats n’est pas relié à un établissement.');
  const now=new Date().toISOString(),payloadHash=hex(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(raw))));
  const inbox=await db().prepare('INSERT OR IGNORE INTO delivery_inbox(provider,event_id,external_order_id,organization_id,location_id,event_type,payload_hash,payload,status,received_at) VALUES(\'uber_eats\',?,?,?,?,?,?,?,\'pending\',?)').bind(input.eventId,input.orderId,integration.organization_id,integration.location_id,input.eventType,payloadHash,raw,now).run();
  if(!inbox.meta.changes)return json({accepted:true,duplicate:true});
  if(input.eventType==='order.cancelled'){
   await db().batch([
    db().prepare("UPDATE orders SET status='cancelled',reason='Annulée par Uber Eats',updated_at=?,version=version+1 WHERE organization_id=? AND location_id=? AND external_provider='uber_eats' AND external_order_id=? AND status NOT IN ('completed','cancelled','rejected')").bind(now,integration.organization_id,integration.location_id,input.orderId),
    db().prepare("UPDATE delivery_inbox SET status='processed',processed_at=? WHERE provider='uber_eats' AND event_id=? AND status='pending'").bind(now,input.eventId),
   ]);
   return json({accepted:true});
  }
  const lines=[] as Record<string,unknown>[];
  for(const line of input.items){
   const product=await db().prepare('SELECT id,name,category,allergens,allergens_checked FROM products WHERE organization_id=? AND id=?').bind(integration.organization_id,line.sku).first<{id:string;name:string;category:string;allergens:string;allergens_checked:number}>();
   let allergens:string[]=[];try{const parsed=JSON.parse(product?.allergens||'[]');if(Array.isArray(parsed))allergens=parsed.filter((value):value is string=>typeof value==='string');}catch{/* invalid legacy snapshots stay blocked */}
   const routeKnown=!!product&&!!product.allergens_checked;
   lines.push({id:product?.id||`uber:${input.orderId}:${line.sku}`,name:product?.name||line.name,size:'unique',option:line.modifiers.join(', '),quantity:line.quantity,unitPrice:line.priceCents,total:line.priceCents*line.quantity,without:[],extra:line.modifiers,kind:product?kind(product.category):'other',routeKnown,allergens,allergensKnown:routeKnown});
  }
  const orderId=crypto.randomUUID();
  await db().batch([
   db().prepare("INSERT INTO orders(id,user_id,idempotency,name,phone,email,items,note,slot,subtotal,offer_discount,discount,total,redeemed,earned,status,organization_id,location_id,channel,fulfillment,payment_status,payment_method,notification_phone,notification_phone_basis,notification_phone_captured_at,external_provider,external_order_id,created_at,updated_at,version) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'delivery','paid','uber_eats','', 'none',NULL,?,?,?, ?,1)").bind(orderId,`external:uber_eats:${input.orderId}`,`uber_eats:${input.orderId}`,input.customerName,'','',JSON.stringify(lines),input.note,now,input.totalCents,0,0,input.totalCents,0,0,'pending',integration.organization_id,integration.location_id,'uber_eats','uber_eats',input.orderId,now,now),
   db().prepare("INSERT INTO events(id,order_id,status,actor,note,created_at) VALUES(?,?, 'pending','uber_eats','Commande reçue par Uber Eats',?)").bind(`${orderId}:1`,orderId,now),
   db().prepare("UPDATE delivery_inbox SET status='processed',processed_at=? WHERE provider='uber_eats' AND event_id=? AND status='pending'").bind(now,input.eventId),
  ]);
  return json({accepted:true,orderId},202);
 }catch(error){if(error instanceof z.ZodError)return json({error:error.issues[0]?.message||'Événement invalide.'},400);if(error instanceof WebhookError)return json({error:error.message},error.status);console.error('Uber Eats webhook error',error instanceof Error?error.message:'unknown');return json({error:'Le webhook Uber Eats sera rejoué.'},503);}
}
