import {NextResponse} from 'next/server';
import {staffSessionUser} from '@/lib/auth';
import {db,ensureSeed} from '@/lib/server';
import {z} from 'zod';

export const dynamic='force-dynamic';
const json=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'no-store'}});
const querySchema=z.object({organizationId:z.string().min(1).max(128)}).strict();
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
