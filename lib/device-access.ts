import type {D1Database} from '@cloudflare/workers-types';
import type {StaffScope} from './staff-access';

export type ProductionDeviceSession = {deviceId: string; principalId: string; scope: StaffScope};

/** Authenticate an enrolled production tablet without ever accepting its token as a query parameter. */
export async function productionDeviceSession(database: D1Database, request: Request): Promise<ProductionDeviceSession | null> {
  const token = request.headers.get('authorization')?.match(/^Bearer ([0-9a-f]{64})$/)?.[1];
  if (!token) return null;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  const row = await database.prepare(`SELECT c.device_id,c.created_by,d.organization_id,d.location_id,d.role,
      o.name AS organization_name,o.status AS organization_status,l.name AS location_name,l.status AS location_status
    FROM device_credentials c
    JOIN devices d ON d.id=c.device_id AND d.organization_id=c.organization_id AND d.location_id=c.location_id
    JOIN organizations o ON o.id=d.organization_id
    JOIN locations l ON l.organization_id=d.organization_id AND l.id=d.location_id
    WHERE c.token_hash=? AND c.revoked_at IS NULL AND c.expires_at>? AND d.status='active'
      AND d.role IN ('make_line','oven','expeditor') AND o.status='active' AND l.status='active'`)
    .bind(hash, Date.now()).first<{device_id:string;created_by:string;organization_id:string;location_id:string;role:'make_line'|'oven'|'expeditor';organization_name:string;organization_status:string;location_name:string;location_status:string}>();
  if (!row) return null;
  const now = new Date().toISOString();
  await database.batch([
    database.prepare('UPDATE device_credentials SET last_seen_at=? WHERE token_hash=? AND revoked_at IS NULL').bind(now, hash),
    database.prepare('UPDATE devices SET last_seen_at=? WHERE id=? AND organization_id=? AND location_id=? AND status=\'active\'').bind(now, row.device_id, row.organization_id, row.location_id),
  ]);
  const station = row.role;
  return {deviceId: row.device_id, principalId: row.created_by, scope: {
    organizationId: row.organization_id, organizationName: row.organization_name,
    locationId: row.location_id, locationName: row.location_name,
    roles: [station], stations: [station], writeStations: [station], canMarkReady: station === 'expeditor', canManageStaff: false,
  }};
}
