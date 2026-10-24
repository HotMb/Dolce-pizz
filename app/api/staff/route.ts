import {NextResponse} from 'next/server';
import {z} from 'zod';
import {staffSessionUser} from '@/lib/auth';
import {db} from '@/lib/server';
import {
  assignableStaffRoles,
  listStaffScopes,
  loadStaffScope,
  readBoundedRequestText,
  staffCommandSchema,
  staffMembershipId,
  staffOwnerGuardSql,
  staffScopeSchema,
  type StaffMembership,
} from '@/lib/staff-access';

export const dynamic = 'force-dynamic';
const json = (body: unknown, status = 200) => NextResponse.json(body, {status, headers: {'Cache-Control': 'no-store'}});
class StaffApiError extends Error {
  constructor(public status: number, message: string) {super(message);}
}
const fail = (error: unknown) => {
  if (error instanceof RangeError) return json({error: 'La demande est trop volumineuse.'}, 413);
  if (error instanceof StaffApiError) return json({error: error.message}, error.status);
  if (error instanceof z.ZodError) return json({error: 'Vérifiez les informations et le rôle choisis.'}, 400);
  console.error('Staff API unavailable', error instanceof Error ? error.name : 'unknown');
  return json({error: 'La gestion des accès est momentanément indisponible.'}, 503);
};

export async function GET(request: Request) {
  try {
    const user = await staffSessionUser(request.headers.get('cookie'));
    if (!user) throw new StaffApiError(401, 'Connectez-vous pour consulter vos accès.');
    const query = new URL(request.url).searchParams;
    if ([...query.keys()].some(key => !['organizationId', 'locationId', 'members'].includes(key))
      || [...new Set(query.keys())].some(key => query.getAll(key).length !== 1)) {
      throw new StaffApiError(400, 'Les paramètres de consultation sont invalides.');
    }
    const scopes = await listStaffScopes(db(), user.id);
    const base = {account: {id: user.id, name: user.name}, scopes, roles: assignableStaffRoles};
    if (!query.size) return json(base);
    if (query.get('members') !== '1') throw new StaffApiError(400, 'Choisissez un établissement pour consulter ses accès.');
    const scope = staffScopeSchema.parse({organizationId: query.get('organizationId'), locationId: query.get('locationId')});
    const access = await loadStaffScope(db(), user.id, scope);
    if (!access?.canManageStaff) throw new StaffApiError(403, 'Seul le propriétaire peut consulter les accès de cet établissement.');
    const result = await db().prepare(
      `SELECT m.id,m.principal_id AS principalId,COALESCE(u.name,'') AS name,m.role,m.status,m.location_id AS locationId
       FROM organization_memberships m LEFT JOIN users u ON u.id=m.principal_id
       WHERE m.organization_id=? AND (m.location_id=? OR (m.location_id IS NULL AND m.role IN ('owner','call_center')))
       AND ${staffOwnerGuardSql}
       ORDER BY CASE WHEN m.location_id IS NULL THEN 0 ELSE 1 END,m.status,u.name,m.role,m.id LIMIT 501`,
    ).bind(scope.organizationId, scope.locationId, scope.locationId, scope.organizationId, user.id).all<{id: string; principalId: string; name: string; role: string; status: string; locationId: string | null}>();
    return json({...base, members: result.results.slice(0, 500), truncated: result.results.length > 500});
  } catch (error) {return fail(error);}
}

export async function POST(request: Request) {
  try {
    const url = new URL(request.url);
    if (!request.headers.get('origin') || request.headers.get('origin') !== url.origin) {
      throw new StaffApiError(403, 'Cette demande doit être envoyée depuis le site.');
    }
    if (url.search || request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
      throw new StaffApiError(400, 'La demande doit contenir uniquement les informations de gestion des accès.');
    }
    if (Number(request.headers.get('content-length') || 0) > 4000) throw new StaffApiError(413, 'La demande est trop volumineuse.');
    const user = await staffSessionUser(request.headers.get('cookie'));
    if (!user) throw new StaffApiError(401, 'Connectez-vous pour gérer les accès.');
    const serialized = await readBoundedRequestText(request, 4000);
    let body: unknown;
    try {body = JSON.parse(serialized);} catch {throw new StaffApiError(400, 'La demande est illisible.');}
    const input = staffCommandSchema.parse(body);
    const access = await loadStaffScope(db(), user.id, input);
    if (!access?.canManageStaff) throw new StaffApiError(403, 'Seul le propriétaire peut modifier les accès de cet établissement.');
    const now = new Date().toISOString();
    const auditId = crypto.randomUUID();
    if (input.action === 'grant') {
      const target = await db().prepare('SELECT id FROM users WHERE id=?').bind(input.principalId).first<{id: string}>();
      if (!target) throw new StaffApiError(404, 'Ce compte est introuvable. La personne doit d’abord se connecter et communiquer son identifiant.');
      const existing = await db().prepare(
        'SELECT id FROM organization_memberships WHERE organization_id=? AND location_id=? AND principal_id=? AND role=?',
      ).bind(input.organizationId, input.locationId, input.principalId, input.role).first<{id: string}>();
      const membershipId = existing?.id || await staffMembershipId(input, input.principalId, input.role);
      const results = await db().batch([
        db().prepare(`INSERT INTO staff_audit(id,organization_id,location_id,membership_id,actor_principal_id,target_principal_id,role,action,created_at)
          SELECT ?,?,?,?,?,?,?,'grant',? WHERE ${staffOwnerGuardSql} AND EXISTS(SELECT 1 FROM users WHERE id=?)`)
          .bind(auditId, input.organizationId, input.locationId, membershipId, user.id, input.principalId, input.role, now,
            input.locationId, input.organizationId, user.id, input.principalId),
        db().prepare(`INSERT INTO organization_memberships(id,organization_id,location_id,principal_id,role,status,created_at,updated_at)
          SELECT ?,?,?,?,?,'active',?,? WHERE EXISTS(SELECT 1 FROM staff_audit WHERE id=?)
          ON CONFLICT(organization_id,principal_id,role,location_id) DO UPDATE SET status='active',updated_at=excluded.updated_at`)
          .bind(membershipId, input.organizationId, input.locationId, input.principalId, input.role, now, now, auditId),
      ]);
      if (!results[0].meta.changes) throw new StaffApiError(403, 'Votre autorisation a changé. Actualisez vos accès.');
      return json({ok: true, membershipId});
    }
    const target = await db().prepare(
      'SELECT id,organization_id,location_id,principal_id,role,status FROM organization_memberships WHERE id=? AND organization_id=? AND location_id=?',
    ).bind(input.membershipId, input.organizationId, input.locationId).first<StaffMembership>();
    if (!target || !assignableStaffRoles.some(role => role.id === target.role)) {
      throw new StaffApiError(404, 'Cet accès d’établissement est introuvable ou protégé.');
    }
    const results = await db().batch([
      db().prepare(`INSERT INTO staff_audit(id,organization_id,location_id,membership_id,actor_principal_id,target_principal_id,role,action,created_at)
        SELECT ?,?,?,?,?,?,?,'revoke',? WHERE ${staffOwnerGuardSql}
        AND EXISTS(SELECT 1 FROM organization_memberships WHERE id=? AND organization_id=? AND location_id=? AND role=?)`)
        .bind(auditId, input.organizationId, input.locationId, target.id, user.id, target.principal_id, target.role, now,
          input.locationId, input.organizationId, user.id, target.id, input.organizationId, input.locationId, target.role),
      db().prepare(`UPDATE organization_memberships SET status='revoked',updated_at=? WHERE id=? AND organization_id=? AND location_id=?
        AND role<>'owner' AND EXISTS(SELECT 1 FROM staff_audit WHERE id=?)`)
        .bind(now, target.id, input.organizationId, input.locationId, auditId),
    ]);
    if (!results[0].meta.changes) throw new StaffApiError(403, 'Votre autorisation a changé. Actualisez vos accès.');
    return json({ok: true, membershipId: target.id});
  } catch (error) {return fail(error);}
}
