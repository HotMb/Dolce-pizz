import {NextResponse} from 'next/server';
import {z} from 'zod';
import {db} from '@/lib/server';
import {staffSessionUser} from '@/lib/auth';
import {loadStaffScope, readBoundedRequestText, type StaffScopeKey} from '@/lib/staff-access';

export const dynamic = 'force-dynamic';
const json = (body: unknown, status = 200) => NextResponse.json(body, {status, headers: {'Cache-Control': 'no-store'}});
class ApiError extends Error {constructor(public status: number, message: string) {super(message);}}
const command = z.object({organizationId: z.string().min(1).max(128), locationId: z.string().min(1).max(128), principalId: z.string().min(1).max(128)}).strict();

/** Revoke every active browser session of a scoped staff account. The current owner session is never revoked by this endpoint. */
export async function POST(request: Request) {
  try {
    const url = new URL(request.url);
    if (request.headers.get('origin') !== url.origin) throw new ApiError(403, 'Cette demande doit être envoyée depuis le site.');
    const actor = await staffSessionUser(request.headers.get('cookie'));
    if (!actor) throw new ApiError(401, 'Connectez-vous pour révoquer une session.');
    const raw = await readBoundedRequestText(request, 4000);
    let body: unknown;
    try {body = JSON.parse(raw);} catch {throw new ApiError(400, 'La demande est illisible.');}
    const input = command.parse(body);
    if (input.principalId === actor.id) throw new ApiError(400, 'Votre propre session ne peut pas être révoquée ici.');
    const scope: StaffScopeKey = {organizationId: input.organizationId, locationId: input.locationId};
    const access = await loadStaffScope(db(), actor.id, scope);
    if (!access?.roles.includes('owner')) throw new ApiError(403, 'Seul le propriétaire peut révoquer les sessions du personnel.');
    const target = await db().prepare(
      `SELECT id,principal_id AS principalId,role FROM organization_memberships
       WHERE organization_id=? AND principal_id=? AND status='active'
       AND ((location_id=? AND role<>'owner') OR (location_id IS NULL AND role='call_center'))
       ORDER BY CASE WHEN location_id=? THEN 0 ELSE 1 END LIMIT 1`,
    ).bind(input.organizationId, input.principalId, input.locationId, input.locationId).first<{id:string;principalId:string;role:string}>();
    if (!target) throw new ApiError(404, 'Ce compte n’a pas d’accès actif dans cet établissement.');
    const now = new Date().toISOString();
    const auditId = crypto.randomUUID();
    const results = await db().batch([
      db().prepare(`INSERT INTO staff_audit(id,organization_id,location_id,membership_id,actor_principal_id,target_principal_id,role,action,created_at)
        SELECT ?,?,?,?,?,?,?, 'revoke_sessions',? WHERE EXISTS(SELECT 1 FROM organization_memberships WHERE id=? AND organization_id=? AND status='active')`)
        .bind(auditId, input.organizationId, input.locationId, target.id, actor.id, target.principalId, target.role, now, target.id, input.organizationId),
      db().prepare('DELETE FROM sessions WHERE user_id=?').bind(target.principalId),
    ]);
    if (!results[0]?.meta.changes) throw new ApiError(409, 'L’accès a changé pendant la révocation.');
    return json({ok: true, principalId: target.principalId, revokedSessions: results[1]?.meta.changes || 0, auditedAt: now});
  } catch (error) {
    if (error instanceof z.ZodError) return json({error: error.issues[0]?.message || 'Vérifiez les informations.'}, 400);
    if (error instanceof ApiError) return json({error: error.message}, error.status);
    console.error('Staff session revoke error', error instanceof Error ? error.message : 'unknown');
    return json({error: 'La révocation de session est momentanément indisponible.'}, 503);
  }
}
