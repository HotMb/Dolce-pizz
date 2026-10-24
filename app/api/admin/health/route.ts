import {NextResponse} from 'next/server';
import {z} from 'zod';
import {staffSessionUser} from '@/lib/auth';
import {db, ensureSeed} from '@/lib/server';
import {paymentTerminalStatus} from '@/lib/payment-terminal';
import {env} from 'cloudflare:workers';

export const dynamic = 'force-dynamic';
const json = (body: unknown, status = 200) => NextResponse.json(body, {status, headers: {'Cache-Control': 'no-store'}});
const id = z.string().trim().min(1).max(128).regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/);
const querySchema = z.object({organizationId: id, locationId: id.optional()}).strict();
class HealthApiError extends Error { constructor(public status: number, message: string) { super(message); } }

type CheckStatus = 'ok' | 'attention' | 'blocked';
type HealthCheck = {id: string; status: CheckStatus; details: Record<string, number | string | boolean>};
type ReadinessDecision = 'go' | 'go_limited' | 'no_go';

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
    const nowMs = Date.now();
    const expiryWarningMs = nowMs + 7 * 24 * 60 * 60 * 1000;
    const [devices, notifications, prints, delivery] = await Promise.all([
      db().prepare(`SELECT COUNT(*) AS total,COALESCE(SUM(CASE WHEN d.status='active' THEN 1 ELSE 0 END),0) AS active,
        COALESCE(SUM(CASE WHEN d.status='active' AND d.role IN ('make_line','oven','expeditor') THEN 1 ELSE 0 END),0) AS kds,
        COALESCE(SUM(CASE WHEN d.status='active' AND d.role='pos' THEN 1 ELSE 0 END),0) AS pos,
        COALESCE(SUM(CASE WHEN d.status='active' AND d.role='kiosk' THEN 1 ELSE 0 END),0) AS kiosks,
        COALESCE(SUM(CASE WHEN d.status='active' AND d.role='printer_gateway' THEN 1 ELSE 0 END),0) AS printerGateways,
        COALESCE(SUM(CASE WHEN d.status='active' AND (d.last_seen_at IS NULL OR d.last_seen_at<?) THEN 1 ELSE 0 END),0) AS stale,
        COALESCE(SUM(CASE WHEN d.status='active' AND NOT EXISTS(SELECT 1 FROM device_credentials c WHERE c.organization_id=d.organization_id AND c.location_id=d.location_id AND c.device_id=d.id AND c.revoked_at IS NULL AND c.expires_at>?) THEN 1 ELSE 0 END),0) AS expired,
        COALESCE(SUM(CASE WHEN d.status='active' AND EXISTS(SELECT 1 FROM device_credentials c WHERE c.organization_id=d.organization_id AND c.location_id=d.location_id AND c.device_id=d.id AND c.revoked_at IS NULL AND c.expires_at>? AND c.expires_at<=?) THEN 1 ELSE 0 END),0) AS expiringSoon
        FROM devices d WHERE d.organization_id=?${parsed.locationId ? ' AND d.location_id=?' : ''}`).bind(...(parsed.locationId ? [cutoff, nowMs, nowMs, expiryWarningMs, parsed.organizationId, parsed.locationId] : [cutoff, nowMs, nowMs, expiryWarningMs, parsed.organizationId])).first<{total: number;active: number;kds: number;pos: number;kiosks: number;printerGateways: number;stale: number;expired: number;expiringSoon: number}>(),
      db().prepare(`SELECT COALESCE(SUM(CASE WHEN status IN ('pending','sending') THEN 1 ELSE 0 END),0) AS open,
        COALESCE(SUM(CASE WHEN status IN ('unknown','failed') THEN 1 ELSE 0 END),0) AS errors
        FROM notification_outbox WHERE organization_id=?${parsed.locationId ? ' AND location_id=?' : ''}`).bind(...(parsed.locationId ? [parsed.organizationId, parsed.locationId] : [parsed.organizationId])).first<{open: number;errors: number}>(),
      db().prepare(`SELECT COALESCE(SUM(CASE WHEN status IN ('pending','printing') THEN 1 ELSE 0 END),0) AS open,
        COALESCE(SUM(CASE WHEN status IN ('unknown','failed') THEN 1 ELSE 0 END),0) AS errors
        FROM print_outbox WHERE organization_id=?${parsed.locationId ? ' AND location_id=?' : ''}`).bind(...(parsed.locationId ? [parsed.organizationId, parsed.locationId] : [parsed.organizationId])).first<{open: number;errors: number}>(),
      db().prepare(`SELECT COALESCE(SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END),0) AS open,
        COALESCE(SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END),0) AS errors
        FROM delivery_inbox WHERE organization_id=?${parsed.locationId ? ' AND location_id=?' : ''}`).bind(...(parsed.locationId ? [parsed.organizationId, parsed.locationId] : [parsed.organizationId])).first<{open: number;errors: number}>(),
    ]);

    const checks: HealthCheck[] = [
      {id: 'locations', status: locations.results.every(row => row.status === 'active') ? 'ok' : 'blocked', details: {total: locations.results.length, active: locations.results.filter(row => row.status === 'active').length}},
      {id: 'location_configuration', status: locations.results.every(row => row.status === 'active' && row.configured === 1) ? 'ok' : 'attention', details: {configured: locations.results.filter(row => row.configured === 1).length, total: locations.results.length}},
      {id: 'devices', status: Number(devices?.stale || 0) === 0 && Number(devices?.expired || 0) === 0 && Number(devices?.expiringSoon || 0) === 0 ? 'ok' : 'attention', details: {total: Number(devices?.total || 0), active: Number(devices?.active || 0), kds: Number(devices?.kds || 0), pos: Number(devices?.pos || 0), kiosks: Number(devices?.kiosks || 0), printerGateways: Number(devices?.printerGateways || 0), stale: Number(devices?.stale || 0), expired: Number(devices?.expired || 0), expiringSoon: Number(devices?.expiringSoon || 0), expiryWarningDays: 7, staleAfterMinutes: 5}},
      {id: 'notifications', status: Number(notifications?.errors || 0) === 0 ? 'ok' : 'attention', details: {open: Number(notifications?.open || 0), errors: Number(notifications?.errors || 0)}},
      {id: 'sms_provider', status: String((env as unknown as Record<string, string | undefined>).BREVO_API_KEY || '').trim().length >= 20 && String((env as unknown as Record<string, string | undefined>).NOTIFICATION_DISPATCH_SECRET || '').trim().length >= 32 ? 'ok' : 'attention', details: {providerConfigured: String((env as unknown as Record<string, string | undefined>).BREVO_API_KEY || '').trim().length >= 20, schedulerConfigured: String((env as unknown as Record<string, string | undefined>).NOTIFICATION_DISPATCH_SECRET || '').trim().length >= 32}},
      {id: 'printing', status: Number(prints?.errors || 0) === 0 ? 'ok' : 'attention', details: {open: Number(prints?.open || 0), errors: Number(prints?.errors || 0)}},
      {id: 'delivery_integrations', status: Number(delivery?.errors || 0) === 0 ? 'ok' : 'attention', details: {open: Number(delivery?.open || 0), errors: Number(delivery?.errors || 0)}},
      {id: 'payment_terminal', status: paymentTerminalStatus().configured ? 'ok' : 'attention', details: {configured: paymentTerminalStatus().configured, provider: paymentTerminalStatus().provider}},
    ];
    const overall: CheckStatus = checks.some(check => check.status === 'blocked') ? 'blocked' : checks.some(check => check.status === 'attention') ? 'attention' : 'ok';
    const decisionReasons = checks.filter(check => check.status !== 'ok').map(check => check.id);
    const decision: ReadinessDecision = checks.some(check => check.status === 'blocked') ? 'no_go' : decisionReasons.length ? 'go_limited' : 'go';
    return json({organizationId: parsed.organizationId, locationId: parsed.locationId || null, checkedAt: new Date().toISOString(), overall, decision, decisionReasons, checks});
  } catch (error) {
    if (error instanceof z.ZodError) return json({error: error.issues[0]?.message || 'Paramètres invalides.'}, 400);
    if (error instanceof HealthApiError) return json({error: error.message}, error.status);
    console.error('Admin health check failed', error instanceof Error ? error.message : 'unknown');
    return json({error: 'La supervision est momentanément indisponible.'}, 503);
  }
}
