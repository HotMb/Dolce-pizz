import {NextResponse} from 'next/server';
import {z} from 'zod';
import {staffSessionUser} from '@/lib/auth';
import {db,ensureSeed} from '@/lib/server';

export const dynamic='force-dynamic';
const json=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'no-store'}});
const id=z.string().trim().min(1).max(128).regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/);
const query=z.object({organizationId:id,locationId:id.optional()}).strict();
class AuditError extends Error{constructor(public status:number,message:string){super(message);}}

/** Owner-only operational audit. Principal ids are shown for accountability; no customer data is joined. */
export async function GET(request:Request){
 try{
  const parsed=query.parse(Object.fromEntries(new URL(request.url).searchParams.entries()));
  const user=await staffSessionUser(request.headers.get('cookie'));if(!user)throw new AuditError(401,'Connectez-vous pour consulter l’audit.');
  await ensureSeed();const owner=await db().prepare("SELECT 1 FROM organization_memberships WHERE organization_id=? AND principal_id=? AND role='owner' AND location_id IS NULL AND status='active'").bind(parsed.organizationId,user.id).first();if(!owner)throw new AuditError(403,'Seul le propriétaire peut consulter l’audit de l’enseigne.');
  const rows=await db().prepare(`SELECT id,location_id,membership_id,actor_principal_id,target_principal_id,role,action,created_at FROM staff_audit WHERE organization_id=?${parsed.locationId?' AND location_id=?':''} ORDER BY created_at DESC,id DESC LIMIT 200`).bind(...(parsed.locationId?[parsed.organizationId,parsed.locationId]:[parsed.organizationId])).all();
  return json({organizationId:parsed.organizationId,locationId:parsed.locationId||null,entries:rows.results});
 }catch(error){if(error instanceof z.ZodError)return json({error:error.issues[0]?.message||'Paramètres invalides.'},400);if(error instanceof AuditError)return json({error:error.message},error.status);console.error('Admin audit failed',error);return json({error:'L’audit est momentanément indisponible.'},503);}
}
