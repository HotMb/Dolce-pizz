import {NextResponse} from 'next/server';
import {z} from 'zod';
import {db,ensureSeed} from '@/lib/server';
import {sessionUser} from '@/lib/auth';
import {loadStaffScope,readBoundedRequestText} from '@/lib/staff-access';

export const dynamic='force-dynamic';
const json=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'no-store'}});
class ApiError extends Error{constructor(public status:number,message:string){super(message);}}
const inputSchema=z.object({organizationId:z.string().min(1).max(128),locationId:z.string().min(1).max(128),paymentId:z.string().min(1).max(128),amount:z.number().int().min(1).max(100000),reason:z.string().trim().min(10).max(500)}).strict();

export async function POST(request:Request){
 try{
  const origin=request.headers.get('origin'),url=new URL(request.url);if(!origin||origin!==url.origin)throw new ApiError(403,'Cette demande doit être envoyée depuis le site.');
  const user=await sessionUser(request.headers.get('cookie'));if(!user)throw new ApiError(401,'Connectez-vous avec un compte autorisé.');await ensureSeed();
  const raw=JSON.parse(await readBoundedRequestText(request,8000));const input=inputSchema.parse(raw);
  const access=await loadStaffScope(db(),user.id,{organizationId:input.organizationId,locationId:input.locationId});
  if(!access||!access.roles.some(role=>role==='owner'||role==='manager'))throw new ApiError(403,'Seul un propriétaire ou responsable peut enregistrer un remboursement.');
  const payment=await db().prepare(`SELECT p.id,p.order_id,p.amount,p.method,o.status,o.payment_status,o.paid_total,o.total
    FROM payments p JOIN orders o ON o.id=p.order_id AND o.organization_id=p.organization_id AND o.location_id=p.location_id
    WHERE p.id=? AND p.organization_id=? AND p.location_id=? AND p.status='captured' AND o.fulfillment='pickup'`).bind(input.paymentId,input.organizationId,input.locationId).first<{id:string;order_id:string;amount:number;method:string;status:string;payment_status:string;paid_total:number;total:number}>();
  if(!payment)throw new ApiError(404,'Paiement introuvable dans cet établissement.');
  const refunded=await db().prepare("SELECT COALESCE(SUM(amount),0) AS amount FROM payment_refunds WHERE payment_id=? AND organization_id=? AND location_id=? AND status IN ('recorded','pending_provider','completed')").bind(payment.id,input.organizationId,input.locationId).first<{amount:number}>();
  if(input.amount>payment.amount-(refunded?.amount||0))throw new ApiError(409,'Le montant dépasse le solde remboursable de ce reçu.');
  const id=crypto.randomUUID(),now=new Date().toISOString();
  const results=await db().batch([
   db().prepare(`INSERT INTO payment_refunds(id,organization_id,location_id,payment_id,order_id,amount,reason,status,provider_reference,actor_user_id,created_at)
     SELECT ?,?,?,?,?,? ,?,'recorded',NULL,?,? WHERE EXISTS(SELECT 1 FROM payments p WHERE p.id=? AND p.organization_id=? AND p.location_id=? AND p.status='captured')`).bind(id,input.organizationId,input.locationId,payment.id,payment.order_id,input.amount,input.reason,user.id,now,payment.id,input.organizationId,input.locationId),
   db().prepare(`UPDATE orders SET paid_total=MAX(0,paid_total-?),payment_status=CASE WHEN status='completed' AND paid_total-?<=0 THEN 'refunded' WHEN status='completed' THEN 'partially_refunded' WHEN paid_total-?<=0 THEN 'due_at_pickup' ELSE 'partially_paid' END,updated_at=?,version=version+1
     WHERE id=? AND organization_id=? AND location_id=? AND paid_total>=? AND EXISTS(SELECT 1 FROM payment_refunds r WHERE r.id=? AND r.organization_id=? AND r.location_id=? AND r.order_id=?)`).bind(input.amount,input.amount,input.amount,now,payment.order_id,input.organizationId,input.locationId,input.amount,id,input.organizationId,input.locationId,payment.order_id),
   db().prepare(`INSERT INTO events(id,order_id,status,actor,note,created_at) SELECT ?,id,status,?,? ,? FROM orders WHERE id=? AND organization_id=? AND location_id=?`).bind(`${id}:event`,user.id,`Remboursement manuel enregistré : ${input.amount} centimes`,now,payment.order_id,input.organizationId,input.locationId),
  ]);
  if(!results[0]?.meta.changes||!results[1]?.meta.changes)throw new ApiError(409,'La commande a changé. Actualisez avant de rembourser.');
  const updated=await db().prepare('SELECT status,payment_status,paid_total,total FROM orders WHERE id=? AND organization_id=? AND location_id=?').bind(payment.order_id,input.organizationId,input.locationId).first<{status:string;payment_status:string;paid_total:number;total:number}>();
  return json({refund:{id,orderId:payment.order_id,paymentId:payment.id,amount:input.amount,method:payment.method,status:'recorded',reason:input.reason},order:updated},201);
 }catch(error){if(error instanceof z.ZodError)return json({error:error.issues[0]?.message||'Vérifiez les informations.'},400);if(error instanceof ApiError)return json({error:error.message},error.status);return json({error:'Le remboursement n’a pas pu être enregistré.'},503);}
}
