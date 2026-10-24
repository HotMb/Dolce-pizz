import {NextResponse} from 'next/server';
import {staffSessionUser} from '@/lib/auth';
import {db,ensureSeed} from '@/lib/server';
import {z} from 'zod';

export const dynamic='force-dynamic';
const json=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'no-store'}});
const querySchema=z.object({organizationId:z.string().min(1).max(128)}).strict();
const mutationSchema=z.object({organizationId:z.string().min(1).max(128),notificationId:z.string().trim().min(1).max(128).regex(/^[a-zA-Z0-9:_-]+$/),resolution:z.enum(['accepted','retry'])}).strict();
class NotificationApiError extends Error{constructor(public status:number,message:string){super(message);}}

export async function GET(request:Request){
 try{
  const user=await staffSessionUser(request.headers.get('cookie'));if(!user)throw new NotificationApiError(401,'Connectez-vous pour consulter la supervision SMS.');
  const query=querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams.entries()));if(!query.success)throw new NotificationApiError(400,'Choisissez une enseigne valide.');
  await ensureSeed();
  const owner=await db().prepare("SELECT 1 AS ok FROM organization_memberships WHERE organization_id=? AND principal_id=? AND role='owner' AND status='active' AND location_id IS NULL LIMIT 1").bind(query.data.organizationId,user.id).first<{ok:number}>();
  if(!owner)throw new NotificationApiError(403,'Seul le propriétaire de l’enseigne peut consulter cette supervision.');
  const counts=await db().prepare("SELECT status,COUNT(*) AS count,MIN(created_at) AS oldest FROM notification_outbox WHERE organization_id=? AND event_type='order_ready' GROUP BY status").bind(query.data.organizationId).all<{status:string;count:number;oldest:string|null}>();
  const recent=await db().prepare("SELECT id,status,attempts,last_error_code,created_at,updated_at,sent_at FROM notification_outbox WHERE organization_id=? AND event_type='order_ready' AND status IN ('unknown','failed','pending','sending') ORDER BY updated_at DESC,id DESC LIMIT 50").bind(query.data.organizationId).all<{id:string;status:string;attempts:number;last_error_code:string|null;created_at:string;updated_at:string;sent_at:string|null}>();
  return json({organizationId:query.data.organizationId,counts:counts.results.map(row=>({status:row.status,count:Number(row.count)||0,oldest:row.oldest})),recent:recent.results});
 }catch(error){if(error instanceof NotificationApiError)return json({error:error.message},error.status);console.error('Notification supervision failed',error);return json({error:'La supervision SMS est momentanément indisponible.'},503);}
}

/** Owner-only manual reconciliation. It never sends SMS itself. */
export async function POST(request:Request){
 try{
  const user=await staffSessionUser(request.headers.get('cookie'));if(!user)throw new NotificationApiError(401,'Connectez-vous pour rapprocher une notification SMS.');
  const input=mutationSchema.parse(await request.json());await ensureSeed();
  const membership=await db().prepare("SELECT id,role FROM organization_memberships WHERE organization_id=? AND principal_id=? AND role='owner' AND status='active' AND location_id IS NULL LIMIT 1").bind(input.organizationId,user.id).first<{id:string;role:string}>();
  if(!membership)throw new NotificationApiError(403,'Seul le propriétaire de l’enseigne peut rapprocher une notification.');
  const notification=await db().prepare("SELECT id,location_id,status FROM notification_outbox WHERE id=? AND organization_id=? AND event_type='order_ready' LIMIT 1").bind(input.notificationId,input.organizationId).first<{id:string;location_id:string;status:string}>();
  if(!notification)throw new NotificationApiError(404,'Notification introuvable dans cette enseigne.');
  if(notification.status!=='unknown')throw new NotificationApiError(409,'Cette notification n’est plus à rapprocher.');
  const now=new Date().toISOString();
  const status=input.resolution==='accepted'?'sent':'pending';
  const code=input.resolution==='accepted'?'manual_reconciled_accepted':'manual_reconciled_retry';
  const providerRef=input.resolution==='accepted'?`manual:${user.id}:${Date.now()}`:null;
  const statements=[db().prepare(`UPDATE notification_outbox SET status=?,last_error_code=?,provider_message_id=?,available_at=?,sent_at=?,lease_token=NULL,lease_expires_at=NULL,updated_at=? WHERE id=? AND organization_id=? AND status='unknown'`).bind(status,code,providerRef,now,input.resolution==='accepted'?now:null,now,input.notificationId,input.organizationId),db().prepare("INSERT INTO staff_audit(id,organization_id,location_id,membership_id,actor_principal_id,target_principal_id,role,action,created_at) VALUES(?,?,?,?,?,?,?,?,?)").bind(`notification-reconcile:${input.notificationId}:${Date.now()}`,input.organizationId,notification.location_id,membership.id,user.id,input.notificationId,membership.role,`notification_reconciled:${input.resolution}`,now)];
  const results=await db().batch(statements);if(!results[0]?.meta.changes)throw new NotificationApiError(409,'Cette notification a déjà été rapprochée.');
  return json({ok:true,notificationId:input.notificationId,resolution:input.resolution,status});
 }catch(error){if(error instanceof z.ZodError)return json({error:error.issues[0]?.message||'Demande de rapprochement invalide.'},400);if(error instanceof NotificationApiError)return json({error:error.message},error.status);console.error('Notification reconciliation failed',error);return json({error:'Le rapprochement SMS est momentanément indisponible.'},503);}
}
