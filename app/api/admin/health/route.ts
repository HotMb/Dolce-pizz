import {NextResponse} from 'next/server';
import {z} from 'zod';
import {staffSessionUser} from '@/lib/auth';
import {db, ensureSeed} from '@/lib/server';

export const dynamic = 'force-dynamic';
const json = (body: unknown, status = 200) => NextResponse.json(body, {status, headers: {'Cache-Control': 'no-store'}});
const id = z.string().trim().min(1).max(128).regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/);
const querySchema = z.object({organizationId: id, locationId: id.optional()}).strict();
class HealthApiError extends Error { constructor(public status: number, message: string) { super(message); } }

type CheckStatus = 'ok' | 'attention' | 'blocked';
type HealthCheck = {id: string; status: CheckStatus; details: Record<string, number | string | boolean>};

/** Read-only launch checks. No customer, order or phone data is returned. */
export async function GET(request: Request) {
  try {
    const parsed = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams.entries()));
    const user = await staffSessionUser(request.headers.get('cookie'));
    if (!user) throw new HealthApiError(401, 'Connectez-vous pour consulter la santé de l’enseigne.');
    await ensureSeed();
    const owner = await db().prepare("SELECT 1 AS ok FROM organization_memberships WHERE organization_id=? AND principal_id=? AND role='owner' AND location_id IS NULL AND status='active' LIMIT 1").bind(parsed.organizationId, user.id).first<{ok: number}>();
    if (!owner) throw new HealthApiError(403, 'Seul le propriétaire de l’enseigne peut consulter cette supervision.');

    const locationFilter = parsed.locationId ? ' AND l.id=?' : '';
    const locationParams = parsed.locationId ? [parsed.organizationId, parsed.locationId] : [parsed.organizationId];
    const locations = await db().prepare(`SELECT l.id,l.status,CASE WHEN c.organization_id IS NULL THEN 0 ELSE 1 END AS configured
      FROM locations l LEFT JOIN location_config c ON c.organization_id=l.organization_id AND c.location_id=l.id
      WHERE l.organization_id=?${locationFilter} ORDER BY l.id`).bind(...locationParams).all<{id: string; status: string; configured: number}>();
    if (!locations.results.length) throw new HealthApiError(404, 'Établissement introuvable dans cette enseigne.');
    const cutoff = new Date(Date.now() - 5 * 60_000).toISOString();
    const [devices, notifications, prints] = await Promise.all([
      db().prepare(`SELECT COUNT(*) AS total,COALESCE(SUM(CASE WHEN d.status='active' THEN 1 ELSE 0 END),0) AS active,
        COALESCE(SUM(CASE WHEN d.status='active' AND (d.last_seen_at IS NULL OR d.last_seen_at<?) THEN 1 ELSE 0 END),0) AS stale
        FROM devices d WHERE d.organization_id=?${parsed.locationId ? ' AND d.location_id=?' : ''}`).bind(...(parsed.locationId ? [cutoff, parsed.organizationId, parsed.locationId] : [cutoff, parsed.organizationId])).first<{total: number;active: number;stale: number}>(),
      db().prepare(`SELECT COALESCE(SUM(CASE WHEN status IN ('pending','sending') THEN 1 ELSE 0 END),0) AS open,
        COALESCE(SUM(CASE WHEN status IN ('unknown','failed') THEN 1 ELSE 0 END),0) AS errors
        FROM notification_outbox WHERE organization_id=?${parsed.locationId ? ' AND location_id=?' : ''}`).bind(...(parsed.locationId ? [parsed.organizationId, parsed.locationId] : [parsed.organizationId])).first<{open: number;errors: number}>(),
      db().prepare(`SELECT COALESCE(SUM(CASE WHEN status IN ('pending','printing') THEN 1 ELSE 0 END),0) AS open,
        COALESCE(SUM(CASE WHEN status IN ('unknown','failed') THEN 1 ELSE 0 END),0) AS errors
        FROM print_outbox WHERE organization_id=?${parsed.locationId ? ' AND location_id=?' : ''}`).bind(...(parsed.locationId ? [parsed.organizationId, parsed.locationId] : [parsed.organizationId])).first<{open: number;errors: number}>(),
    ]);

    const checks: HealthCheck[] = [
      {id: 'locations', status: locations.results.every(row => row.status === 'active') ? 'ok' : 'blocked', details: {total: locations.results.length, active: locations.results.filter(row => row.status === 'active').length}},
      {id: 'location_configuration', status: locations.results.every(row => row.status === 'active' && row.configured === 1) ? 'ok' : 'attention', details: {configured: locations.results.filter(row => row.configured === 1).length, total: locations.results.length}},
      {id: 'devices', status: Number(devices?.stale || 0) === 0 ? 'ok' : 'attention', details: {total: Number(devices?.total || 0), active: Number(devices?.active || 0), stale: Number(devices?.stale || 0), staleAfterMinutes: 5}},
      {id: 'notifications', status: Number(notifications?.errors || 0) === 0 ? 'ok' : 'attention', details: {open: Number(notifications?.open || 0), errors: Number(notifications?.errors || 0)}},
      {id: 'printing', status: Number(prints?.errors || 0) === 0 ? 'ok' : 'attention', details: {open: Number(prints?.open || 0), errors: Number(prints?.errors || 0)}},
    ];
    const overall: CheckStatus = checks.some(check => check.status === 'blocked') ? 'blocked' : checks.some(check => check.status === 'attention') ? 'attention' : 'ok';
    return json({organizationId: parsed.organizationId, locationId: parsed.locationId || null, checkedAt: new Date().toISOString(), overall, checks});
  } catch (error) {
    if (error instanceof z.ZodError) return json({error: error.issues[0]?.message || 'Paramètres invalides.'}, 400);
    if (error instanceof HealthApiError) return json({error: error.message}, error.status);
    console.error('Admin health check failed', error instanceof Error ? error.message : 'unknown');
    return json({error: 'La supervision est momentanément indisponible.'}, 503);
  }
}
