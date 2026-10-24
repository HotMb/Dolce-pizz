import {z} from 'zod';
import type {ProductionStation} from './production-flow';

export const staffStations = ['make_line', 'oven', 'expeditor'] as const;
export const staffRoles = ['owner', 'manager', 'call_center', 'pos', ...staffStations, 'viewer'] as const;
export type StaffRole = typeof staffRoles[number];
export const assignableStaffRoles = [
  {id: 'manager', label: 'Responsable d’établissement'},
  {id: 'call_center', label: 'Centre d’appels'},
  {id: 'pos', label: 'Comptoir'},
  {id: 'make_line', label: 'Préparation'},
  {id: 'oven', label: 'Four'},
  {id: 'expeditor', label: 'Expédition'},
  {id: 'viewer', label: 'Lecture seule'},
] as const;

export const scopeIdSchema = z.string().min(1).max(128).regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/);
export const staffScopeSchema = z.object({organizationId: scopeIdSchema, locationId: scopeIdSchema}).strict();
const principalIdSchema = z.string().min(1).max(128).regex(/^[a-zA-Z0-9][a-zA-Z0-9:_-]*$/);
export const staffCommandSchema = z.discriminatedUnion('action', [
  z.object({action: z.literal('grant'), ...staffScopeSchema.shape, principalId: principalIdSchema,
    role: z.enum(['manager', 'call_center', 'pos', 'make_line', 'oven', 'expeditor', 'viewer'])}).strict(),
  z.object({action: z.literal('revoke'), ...staffScopeSchema.shape,
    membershipId: z.string().min(1).max(256).regex(/^[a-zA-Z0-9][a-zA-Z0-9:_-]*$/)}).strict(),
]);
export type StaffScopeKey = z.infer<typeof staffScopeSchema>;
export type StaffMembership = {
  id: string;
  organization_id: string;
  location_id: string | null;
  principal_id: string;
  role: string;
  status: string;
};
export type StaffSite = {
  organizationId: string;
  organizationName: string;
  organizationStatus: string;
  locationId: string;
  locationName: string;
  locationStatus: string;
};
export type StaffScope = StaffScopeKey & {
  organizationName: string;
  locationName: string;
  roles: StaffRole[];
  stations: ProductionStation[];
  writeStations: ProductionStation[];
  canMarkReady: boolean;
  canManageStaff: boolean;
};

/** Explicit principal and active scopes only. Invalid organization-wide station/manager grants grant nothing. */
export function resolveStaffScope(principalId: string, site: StaffSite, memberships: StaffMembership[]): StaffScope | null {
  if (!principalId || site.organizationStatus !== 'active' || site.locationStatus !== 'active') return null;
  const roles = staffRoles.filter(role => memberships.some(member => member.principal_id === principalId
    && member.organization_id === site.organizationId && member.status === 'active' && member.role === role
    && (role === 'owner' ? member.location_id === null
      : member.location_id === site.locationId || (role === 'call_center' && member.location_id === null))));
  if (!roles.length) return null;
  const allWrites = roles.includes('owner') || roles.includes('manager');
  const allReads = allWrites || roles.some(role => ['call_center', 'pos', 'viewer'].includes(role));
  const writeStations = staffStations.filter(station => allWrites || roles.includes(station));
  const stations = staffStations.filter(station => allReads || writeStations.includes(station));
  return {organizationId: site.organizationId, organizationName: site.organizationName,
    locationId: site.locationId, locationName: site.locationName, roles, stations, writeStations,
    canMarkReady: writeStations.includes('oven') || writeStations.includes('expeditor'), canManageStaff: roles.includes('owner')};
}

export function canOperateStation(scope: StaffScope | null, station: ProductionStation, action: 'read' | 'start' | 'complete' | 'ready'): boolean {
  if (!scope) return false;
  return action === 'read' ? scope.stations.includes(station)
    : action === 'ready' ? (station === 'oven' || station === 'expeditor') && scope.canMarkReady
      : scope.writeStations.includes(station);
}

export async function listStaffScopes(database: D1Database, principalId: string): Promise<StaffScope[]> {
  const result = await database.prepare(
    `SELECT l.organization_id AS organizationId,o.name AS organizationName,o.status AS organizationStatus,
      l.id AS locationId,l.name AS locationName,l.status AS locationStatus,
      m.id,m.location_id,m.principal_id,m.role,m.status,m.organization_id
     FROM organization_memberships m JOIN organizations o ON o.id=m.organization_id
     JOIN locations l ON l.organization_id=m.organization_id AND (m.location_id IS NULL OR m.location_id=l.id)
     WHERE m.principal_id=? AND m.status='active' AND o.status='active' AND l.status='active'
     ORDER BY o.name,l.name,m.role`,
  ).bind(principalId).all<StaffSite & StaffMembership>();
  const sites = new Map<string, {site: StaffSite; memberships: StaffMembership[]}>();
  for (const row of result.results) {
    const key = JSON.stringify([row.organizationId, row.locationId]);
    const group = sites.get(key) || {site: row, memberships: []};
    group.memberships.push(row);
    sites.set(key, group);
  }
  return Array.from(sites.values()).map(group => resolveStaffScope(principalId, group.site, group.memberships))
    .filter((scope): scope is StaffScope => !!scope);
}

export async function loadStaffScope(database: D1Database, principalId: string, scope: StaffScopeKey): Promise<StaffScope | null> {
  const site = await database.prepare(
    `SELECT l.organization_id AS organizationId,o.name AS organizationName,o.status AS organizationStatus,
      l.id AS locationId,l.name AS locationName,l.status AS locationStatus
     FROM locations l JOIN organizations o ON o.id=l.organization_id WHERE l.organization_id=? AND l.id=?`,
  ).bind(scope.organizationId, scope.locationId).first<StaffSite>();
  if (!site || site.organizationStatus !== 'active' || site.locationStatus !== 'active') return null;
  const members = await database.prepare(
    "SELECT id,organization_id,location_id,principal_id,role,status FROM organization_memberships WHERE organization_id=? AND principal_id=? AND status='active' AND (location_id=? OR location_id IS NULL)",
  ).bind(scope.organizationId, principalId, scope.locationId).all<StaffMembership>();
  return resolveStaffScope(principalId, site, members.results);
}

/** Stable hash avoids delimiter collisions, nullable uniqueness gaps, and duplicate grants on retries. */
export async function staffMembershipId(scope: StaffScopeKey, principalId: string, role: StaffRole): Promise<string> {
  const data = new TextEncoder().encode(JSON.stringify([scope.organizationId, scope.locationId, principalId, role]));
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  return `staff:${Array.from(digest, value => value.toString(16).padStart(2, '0')).join('')}`;
}

/** Used in the mutation statement so an already revoked grant cannot authorize a queued write. */
export const productionWriteGuardSql = `EXISTS(
 SELECT 1 FROM organization_memberships sm
 JOIN organizations so ON so.id=sm.organization_id AND so.status='active'
 JOIN locations sl ON sl.organization_id=sm.organization_id AND sl.id=? AND sl.status='active'
 WHERE sm.organization_id=? AND sm.principal_id=? AND sm.status='active'
 AND ((sm.role='owner' AND sm.location_id IS NULL)
   OR (sm.location_id=sl.id AND (sm.role='manager' OR sm.role=?)))
)`;

export const staffOwnerGuardSql = `EXISTS(
 SELECT 1 FROM organization_memberships sm
 JOIN organizations so ON so.id=sm.organization_id AND so.status='active'
 JOIN locations sl ON sl.organization_id=sm.organization_id AND sl.id=? AND sl.status='active'
 WHERE sm.organization_id=? AND sm.principal_id=? AND sm.status='active'
 AND sm.role='owner' AND sm.location_id IS NULL
)`;

/** Enforce the byte limit while streaming, including requests without Content-Length. */
export async function readBoundedRequestText(request: Request, maxBytes: number): Promise<string> {
  const reader = request.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new RangeError('Request body limit exceeded');
      }
      chunks.push(chunk.value);
    }
  } finally {reader.releaseLock();}
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {bytes.set(chunk, offset); offset += chunk.byteLength;}
  return new TextDecoder().decode(bytes);
}
