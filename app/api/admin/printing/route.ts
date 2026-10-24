import {NextResponse} from 'next/server';
import {z} from 'zod';
import {staffSessionUser} from '@/lib/auth';
import {db,ensureSeed} from '@/lib/server';

export const dynamic='force-dynamic';
const json=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'no-store'}});
const id=z.string().trim().min(1).max(128).regex(/^[a-zA-Z0-9][a-zA-Z0-9:_-]*$/);
const query=z.object({organizationId:id,locationId:id.optional()}).strict();
const mutation=z.object({organizationId:id,jobId:id,action:z.enum(['retry','reprint','reconcile_printed','reconcile_failed']).default('retry')}).strict();
class PrintingError extends Error{constructor(public status:number,message:string){super(message);}}
async function owner(userId:string,organizationId:string){return !!await db().prepare("SELECT 1 FROM organization_memberships WHERE organization_id=? AND principal_id=? AND role='owner' AND location_id IS NULL AND status='active'").bind(organizationId,userId).first();}

/** Owner-only print queue monitor. It never returns ticket payloads or customer data. */
export async function GET(request:Request){
 try{
  const parsed=query.parse(Object.fromEntries(new URL(request.url).searchParams.entries()));
  const user=await staffSessionUser(request.headers.get('cookie'));if(!user)throw new PrintingError(401,'Connectez-vous pour consulter la file d’impression.');
  await ensureSeed();if(!await owner(user.id,parsed.organizationId))throw new PrintingError(403,'Seul le propriétaire peut superviser l’impression.');
  const scope=parsed.locationId?' AND location_id=?':'';const params=parsed.locationId?[parsed.organizationId,parsed.locationId]:[parsed.organizationId];
  const counts=await db().prepare(`SELECT status,COUNT(*) AS count FROM print_outbox WHERE organization_id=?${scope} GROUP BY status ORDER BY status`).bind(...params).all<{status:string;count:number}>();
  const recent=await db().prepare(`SELECT p.id,p.location_id,p.order_id,p.job_type,p.status,p.attempts,p.last_error,p.created_at,p.updated_at,p.printed_at,COALESCE((SELECT e.actor FROM events e WHERE e.id=p.id||':audit' LIMIT 1),(SELECT e.actor FROM events e WHERE e.id LIKE p.id||':reconcile:%' LIMIT 1)) AS audit_actor FROM print_outbox p WHERE p.organization_id=? AND p.status IN ('pending','printing','unknown','failed','printed')${parsed.locationId?' AND p.location_id=?':''} ORDER BY p.updated_at DESC,p.id DESC LIMIT 100`).bind(...params).all();
  return json({counts:counts.results,recent:recent.results});
 }catch(error){if(error instanceof z.ZodError)return json({error:error.issues[0]?.message||'Paramètres invalides.'},400);if(error instanceof PrintingError)return json({error:error.message},error.status);console.error('Admin printing monitor failed',error);return json({error:'La supervision de l’impression est momentanément indisponible.'},503);}
}

/** Retry failed jobs, or create an auditable new job for a previously printed ticket. */
export async function POST(request:Request){
 try{
  const user=await staffSessionUser(request.headers.get('cookie'));if(!user)throw new PrintingError(401,'Connectez-vous pour relancer une impression.');
  const input=mutation.parse(await request.json());await ensureSeed();if(!await owner(user.id,input.organizationId))throw new PrintingError(403,'Seul le propriétaire peut relancer une impression.');
  const now=new Date().toISOString();
  if(input.action==='reprint'){
   const source=await db().prepare('SELECT id,organization_id,location_id,order_id,job_type,payload,status FROM print_outbox WHERE id=? AND organization_id=?').bind(input.jobId,input.organizationId).first<{id:string;organization_id:string;location_id:string;order_id:string;job_type:'kitchen_ticket'|'customer_receipt';payload:string;status:string}>();
   if(!source)throw new PrintingError(404,'Job d’impression introuvable.');
   if(source.status!=='printed')throw new PrintingError(409,'Seul un ticket déjà imprimé peut être réimprimé.');
   const id=`${source.id}:reprint:${crypto.randomUUID()}`;const operationId=`${source.id}:reprint:${crypto.randomUUID()}`;
   const result=await db().batch([
    db().prepare("INSERT INTO print_outbox(id,operation_id,organization_id,location_id,order_id,job_type,payload,status,attempts,available_at,created_at,updated_at) SELECT ?,?,?,?,?,?,?,'pending',0,?,?,? WHERE EXISTS(SELECT 1 FROM orders WHERE id=? AND organization_id=? AND location_id=?)").bind(id,operationId,source.organization_id,source.location_id,source.order_id,source.job_type,source.payload,now,now,now,source.order_id,source.organization_id,source.location_id),
    db().prepare('INSERT INTO events(id,order_id,status,actor,note,created_at) SELECT ?,id,status,?,?,? FROM orders WHERE id=? AND organization_id=? AND location_id=?').bind(`${id}:audit`,user.id,`Réimpression du ticket ${source.id.slice(0,24)}`,now,source.order_id,source.organization_id,source.location_id),
   ]);
   if(!result[0]?.meta.changes)throw new PrintingError(409,'La commande n’est plus disponible pour une réimpression.');
   return json({ok:true,jobId:id,sourceJobId:source.id},201);
  }
  if(input.action==='reconcile_printed'||input.action==='reconcile_failed'){
   const source=await db().prepare('SELECT id,order_id,status FROM print_outbox WHERE id=? AND organization_id=?').bind(input.jobId,input.organizationId).first<{id:string;order_id:string;status:string}>();
   if(!source)throw new PrintingError(404,'Job d’impression introuvable.');
   if(source.status!=='unknown')throw new PrintingError(409,'Seul un résultat inconnu peut être rapproché.');
   const printed=input.action==='reconcile_printed';
   const eventId=`${source.id}:reconcile:${crypto.randomUUID()}`;
   const result=await db().batch([
    db().prepare(`UPDATE print_outbox SET status=?,printed_at=?,provider_job_id=?,last_error=?,lease_token=NULL,lease_expires_at=NULL,updated_at=? WHERE id=? AND organization_id=? AND status='unknown'`).bind(printed?'printed':'failed',printed?now:null,printed?`manual:${user.id}`:null,printed?null:'manual_reconciliation',now,source.id,input.organizationId),
    db().prepare('INSERT INTO events(id,order_id,status,actor,note,created_at) SELECT ?,id,status,?,?,? FROM orders WHERE id=? AND organization_id=? AND location_id=(SELECT location_id FROM print_outbox WHERE id=? AND organization_id=?)').bind(eventId, user.id, printed?'Résultat impression rapproché comme imprimé':'Résultat impression rapproché comme échec',now,source.order_id, input.organizationId, source.id, input.organizationId),
   ]);
   if(!result[0]?.meta.changes)throw new PrintingError(409,'Le job a déjà été rapproché.');
   return json({ok:true,jobId:source.id,status:printed?'printed':'failed'});
  }
  const result=await db().prepare("UPDATE print_outbox SET status='pending',available_at=?,lease_token=NULL,lease_expires_at=NULL,last_error=NULL,updated_at=? WHERE id=? AND organization_id=? AND status='failed'").bind(now,now,input.jobId,input.organizationId).run();
  if(!result.meta.changes){const current=await db().prepare('SELECT status FROM print_outbox WHERE id=? AND organization_id=?').bind(input.jobId,input.organizationId).first<{status:string}>();if(!current)throw new PrintingError(404,'Job d’impression introuvable.');if(current.status==='unknown')throw new PrintingError(409,'Le résultat du relais est inconnu. Rapprochez ce ticket avant de le relancer.');throw new PrintingError(409,'Ce job n’est pas en échec ou a déjà été relancé.');}
  return json({ok:true,jobId:input.jobId});
 }catch(error){if(error instanceof z.ZodError)return json({error:error.issues[0]?.message||'Paramètres invalides.'},400);if(error instanceof PrintingError)return json({error:error.message},error.status);console.error('Admin printing retry failed',error);return json({error:'La relance d’impression est momentanément indisponible.'},503);}
}
