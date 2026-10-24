import {NextResponse} from 'next/server';
import {z} from 'zod';
import {staffSessionUser} from '@/lib/auth';
import {db,ensureSeed} from '@/lib/server';

export const dynamic='force-dynamic';
const json=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'no-store'}});
const id=z.string().trim().min(1).max(128).regex(/^[a-zA-Z0-9][a-zA-Z0-9:_-]*$/);
const query=z.object({organizationId:id,locationId:id.optional()}).strict();
const mutation=z.object({organizationId:id,jobId:id}).strict();
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
  const recent=await db().prepare(`SELECT id,location_id,order_id,job_type,status,attempts,last_error,created_at,updated_at,printed_at FROM print_outbox WHERE organization_id=? AND status IN ('pending','printing','unknown','failed')${parsed.locationId?' AND location_id=?':''} ORDER BY updated_at DESC,id DESC LIMIT 100`).bind(...params).all();
  return json({counts:counts.results,recent:recent.results});
 }catch(error){if(error instanceof z.ZodError)return json({error:error.issues[0]?.message||'Paramètres invalides.'},400);if(error instanceof PrintingError)return json({error:error.message},error.status);console.error('Admin printing monitor failed',error);return json({error:'La supervision de l’impression est momentanément indisponible.'},503);}
}

/** Manual retry is restricted to failed jobs; unknown provider outcomes require reconciliation first. */
export async function POST(request:Request){
 try{
  const user=await staffSessionUser(request.headers.get('cookie'));if(!user)throw new PrintingError(401,'Connectez-vous pour relancer une impression.');
  const input=mutation.parse(await request.json());await ensureSeed();if(!await owner(user.id,input.organizationId))throw new PrintingError(403,'Seul le propriétaire peut relancer une impression.');
  const now=new Date().toISOString();const result=await db().prepare("UPDATE print_outbox SET status='pending',available_at=?,lease_token=NULL,lease_expires_at=NULL,last_error=NULL,updated_at=? WHERE id=? AND organization_id=? AND status='failed'").bind(now,now,input.jobId,input.organizationId).run();
  if(!result.meta.changes){const current=await db().prepare('SELECT status FROM print_outbox WHERE id=? AND organization_id=?').bind(input.jobId,input.organizationId).first<{status:string}>();if(!current)throw new PrintingError(404,'Job d’impression introuvable.');if(current.status==='unknown')throw new PrintingError(409,'Le résultat du relais est inconnu. Rapprochez ce ticket avant de le relancer.');throw new PrintingError(409,'Ce job n’est pas en échec ou a déjà été relancé.');}
  return json({ok:true,jobId:input.jobId});
 }catch(error){if(error instanceof z.ZodError)return json({error:error.issues[0]?.message||'Paramètres invalides.'},400);if(error instanceof PrintingError)return json({error:error.message},error.status);console.error('Admin printing retry failed',error);return json({error:'La relance d’impression est momentanément indisponible.'},503);}
}
