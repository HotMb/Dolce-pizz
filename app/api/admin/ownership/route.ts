import {NextResponse} from 'next/server';
import {z} from 'zod';
import {staffSessionUser} from '@/lib/auth';
import {db,ensureSeed} from '@/lib/server';

export const dynamic='force-dynamic';
const json=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'no-store'}});
const input=z.object({organizationId:z.string().trim().min(1).max(128),targetPrincipalId:z.string().trim().min(1).max(128),confirmation:z.literal('TRANSFERER LA PROPRIETE')}).strict();
class OwnershipError extends Error{constructor(public status:number,message:string){super(message);}}

/** Transfer an organisation owner in one transaction. The outgoing owner loses the org-wide owner membership. */
export async function POST(request:Request){
 try{
  const url=new URL(request.url);if(request.headers.get('origin')!==url.origin)throw new OwnershipError(403,'Cette demande doit être envoyée depuis le site.');
  const user=await staffSessionUser(request.headers.get('cookie'));if(!user)throw new OwnershipError(401,'Connectez-vous pour transférer la propriété.');
  const body=input.parse(await request.json());await ensureSeed();if(body.targetPrincipalId===user.id)throw new OwnershipError(400,'Choisissez un autre compte pour le transfert.');
  const organization=await db().prepare("SELECT id FROM organizations WHERE id=? AND status='active'").bind(body.organizationId).first();if(!organization)throw new OwnershipError(404,'Cette enseigne est introuvable ou inactive.');
  const current=await db().prepare("SELECT id FROM organization_memberships WHERE organization_id=? AND principal_id=? AND role='owner' AND location_id IS NULL AND status='active'").bind(body.organizationId,user.id).first<{id:string}>();if(!current)throw new OwnershipError(403,'Seul le propriétaire actuel peut transférer cette enseigne.');
  const target=await db().prepare('SELECT id FROM users WHERE id=?').bind(body.targetPrincipalId).first<{id:string}>();if(!target)throw new OwnershipError(404,'Le compte cible doit d’abord se connecter à la plateforme.');
  const auditLocation=await db().prepare('SELECT id FROM locations WHERE organization_id=? ORDER BY id LIMIT 1').bind(body.organizationId).first<{id:string}>();if(!auditLocation)throw new OwnershipError(409,'Cette enseigne ne possède aucun établissement pour journaliser le transfert.');
  const now=new Date().toISOString();const targetMembership=crypto.randomUUID();const outgoingAudit=crypto.randomUUID();const incomingAudit=crypto.randomUUID();
  const result=await db().batch([
   db().prepare(`INSERT INTO organization_memberships(id,organization_id,location_id,principal_id,role,status,created_at,updated_at) VALUES(?,?,NULL,?,'owner','active',?,?) ON CONFLICT(organization_id,principal_id,role,location_id) DO UPDATE SET status='active',updated_at=excluded.updated_at`).bind(targetMembership,body.organizationId,body.targetPrincipalId,now,now),
   db().prepare(`INSERT INTO staff_audit(id,organization_id,location_id,membership_id,actor_principal_id,target_principal_id,role,action,created_at) VALUES(?,?,?,?,?,?,?,?,?)`).bind(incomingAudit,body.organizationId,auditLocation.id,targetMembership,user.id,body.targetPrincipalId,'owner','transfer_in',now),
   db().prepare(`INSERT INTO staff_audit(id,organization_id,location_id,membership_id,actor_principal_id,target_principal_id,role,action,created_at) VALUES(?,?,?,?,?,?,?,?,?)`).bind(outgoingAudit,body.organizationId,auditLocation.id,current.id,user.id,body.targetPrincipalId,'owner','transfer_out',now),
   db().prepare("UPDATE organization_memberships SET status='revoked',updated_at=? WHERE id=? AND organization_id=? AND principal_id=? AND role='owner' AND location_id IS NULL AND status='active'").bind(now,current.id,body.organizationId,user.id),
  ]);
  if(!result[3]?.meta.changes)throw new OwnershipError(409,'Le propriétaire a changé pendant le transfert. Rechargez la page.');
  return json({ok:true,organizationId:body.organizationId,ownerPrincipalId:body.targetPrincipalId});
 }catch(error){if(error instanceof z.ZodError)return json({error:error.issues[0]?.message||'Confirmez le transfert avec la phrase exacte.'},400);if(error instanceof OwnershipError)return json({error:error.message},error.status);console.error('Ownership transfer failed',error);return json({error:'Le transfert de propriété est momentanément indisponible.'},503);}
}
