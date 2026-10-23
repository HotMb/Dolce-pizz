import assert from 'node:assert/strict';
import {test} from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {
  canOperateStation,
  resolveStaffScope,
  staffCommandSchema,
  staffMembershipId,
  productionWriteGuardSql,
  staffOwnerGuardSql,
  readBoundedRequestText,
  type StaffMembership,
  type StaffSite,
} from '../lib/staff-access';

const site: StaffSite = {organizationId: 'dolce-pizza', organizationName: 'Dolce Pizz’', organizationStatus: 'active',
  locationId: 'ronchin', locationName: 'Ronchin', locationStatus: 'active'};
const member = (role: string, changes: Partial<StaffMembership> = {}): StaffMembership => ({id: `membership-${role}`,
  organization_id: site.organizationId, location_id: site.locationId, principal_id: 'employee-1', role, status: 'active', ...changes});

test('a station operator can advance only that station and cannot mark a whole order ready', () => {
  const scope = resolveStaffScope('employee-1', site, [member('make_line')]);
  assert.equal(canOperateStation(scope, 'make_line', 'complete'), true);
  assert.equal(canOperateStation(scope, 'oven', 'read'), false);
  assert.equal(canOperateStation(scope, 'oven', 'start'), false);
  assert.equal(canOperateStation(scope, 'expeditor', 'ready'), false);
  const expeditor = resolveStaffScope('employee-1', site, [member('expeditor')]);
  assert.equal(canOperateStation(expeditor, 'expeditor', 'ready'), true);
  assert.equal(canOperateStation(expeditor, 'make_line', 'ready'), false);
});

test('a membership never crosses organization, branch, or authenticated principal', () => {
  for (const grant of [member('manager', {organization_id: 'other-brand'}),
    member('manager', {location_id: 'tourcoing'}), member('manager', {principal_id: 'someone-else'})]) {
    assert.equal(resolveStaffScope('employee-1', site, [grant]), null);
  }
  assert.equal(resolveStaffScope('employee-1', site, []), null);
});

test('revoked membership and inactive or unconfigured sites and organizations grant no access', () => {
  assert.equal(resolveStaffScope('employee-1', site, [member('manager', {status: 'revoked'})]), null);
  assert.equal(resolveStaffScope('employee-1', {...site, locationStatus: 'unconfigured'}, [member('manager')]), null);
  assert.equal(resolveStaffScope('employee-1', {...site, locationStatus: 'suspended'}, [member('manager')]), null);
  assert.equal(resolveStaffScope('employee-1', {...site, organizationStatus: 'suspended'}, [member('owner', {location_id: null})]), null);
});

test('owner is organization-wide while invalid organization-wide manager or station grants do not authorize', () => {
  const owner = resolveStaffScope('employee-1', site, [member('owner', {location_id: null})]);
  assert.equal(owner?.canManageStaff, true);
  assert.deepEqual(owner?.writeStations, ['make_line', 'oven', 'expeditor']);
  assert.equal(resolveStaffScope('employee-1', site, [member('owner')]), null);
  assert.equal(resolveStaffScope('employee-1', site, [member('manager', {location_id: null})]), null);
  assert.equal(resolveStaffScope('employee-1', site, [member('oven', {location_id: null})]), null);
  const manager = resolveStaffScope('employee-1', site, [member('manager')]);
  assert.equal(manager?.canManageStaff, false);
  assert.equal(manager?.canMarkReady, true);
});

test('call center, POS, and viewer may read KDS without production or staff management writes', () => {
  for (const grant of [member('call_center'), member('call_center', {location_id: null}), member('pos'), member('viewer')]) {
    const scope = resolveStaffScope('employee-1', site, [grant]);
    assert.deepEqual(scope?.stations, ['make_line', 'oven', 'expeditor']);
    assert.deepEqual(scope?.writeStations, []);
    assert.equal(scope?.canManageStaff, false);
    assert.equal(canOperateStation(scope, 'expeditor', 'ready'), false);
  }
});

test('grant parser rejects owner escalation, organization-wide and extra phone or scope fields', () => {
  const base = {action: 'grant', organizationId: site.organizationId, locationId: site.locationId, principalId: 'employee-1', role: 'oven'};
  assert.equal(staffCommandSchema.safeParse(base).success, true);
  assert.equal(staffCommandSchema.safeParse({...base, role: 'owner'}).success, false);
  assert.equal(staffCommandSchema.safeParse({...base, locationId: null}).success, false);
  assert.equal(staffCommandSchema.safeParse({...base, phone: '+33601020304'}).success, false);
  assert.equal(staffCommandSchema.safeParse({...base, organizationId: 'other/scope'}).success, false);
  assert.equal(staffCommandSchema.safeParse({...base, principalId: ''}).success, false);
});

test('membership retry IDs remain deterministic and distinct across tenant, site, role, and principal', async () => {
  const scope = {organizationId: site.organizationId, locationId: site.locationId};
  const first = await staffMembershipId(scope, 'employee-1', 'oven');
  assert.equal(await staffMembershipId(scope, 'employee-1', 'oven'), first);
  const others = await Promise.all([
    staffMembershipId({...scope, organizationId: 'other'}, 'employee-1', 'oven'),
    staffMembershipId({...scope, locationId: 'tourcoing'}, 'employee-1', 'oven'),
    staffMembershipId(scope, 'employee-2', 'oven'),
    staffMembershipId(scope, 'employee-1', 'expeditor'),
  ]);
  assert.equal(others.includes(first), false);
  assert.equal(new Set(others).size, 4);
});

function policyDatabase() {
  const database = new DatabaseSync(':memory:');
  database.exec(`CREATE TABLE organizations(id TEXT PRIMARY KEY,status TEXT);
    CREATE TABLE locations(id TEXT PRIMARY KEY,organization_id TEXT,status TEXT);
    CREATE TABLE organization_memberships(id TEXT PRIMARY KEY,organization_id TEXT,location_id TEXT,principal_id TEXT,role TEXT,status TEXT);
    CREATE TABLE ticket(value INTEGER); INSERT INTO ticket VALUES(0);
    INSERT INTO organizations VALUES('dolce-pizza','active'),('other-brand','active');
    INSERT INTO locations VALUES('ronchin','dolce-pizza','active'),('tourcoing','dolce-pizza','active'),('other-site','other-brand','active');
    INSERT INTO organization_memberships VALUES('oven','dolce-pizza','ronchin','employee-1','oven','active'),
      ('owner','dolce-pizza',NULL,'owner-1','owner','active');`);
  return database;
}

test('production SQL rechecks a revoked or suspended scope at write time and denies a forged site or station', () => {
  const database = policyDatabase();
  try {
    const update = database.prepare(`UPDATE ticket SET value=value+1 WHERE ${productionWriteGuardSql}`);
    const run = (location = 'ronchin', organization = 'dolce-pizza', station = 'oven') =>
      Number(update.run(location, organization, 'employee-1', station).changes);
    assert.equal(run(), 1);
    assert.equal(run('tourcoing'), 0);
    assert.equal(run('other-site', 'other-brand'), 0);
    assert.equal(run('ronchin', 'dolce-pizza', 'expeditor'), 0);
    database.exec("UPDATE organization_memberships SET status='revoked' WHERE id='oven'");
    assert.equal(run(), 0);
    database.exec("UPDATE organization_memberships SET status='active' WHERE id='oven'; UPDATE locations SET status='suspended' WHERE id='ronchin'");
    assert.equal(run(), 0);
    database.exec("UPDATE locations SET status='active'; UPDATE organizations SET status='suspended' WHERE id='dolce-pizza'");
    assert.equal(run(), 0);
    assert.equal((database.prepare('SELECT value FROM ticket').get() as {value: number}).value, 1);
  } finally {database.close();}
});

test('staff management SQL accepts only current organization owners and preserves organization boundaries', () => {
  const database = policyDatabase();
  try {
    const update = database.prepare(`UPDATE ticket SET value=value+1 WHERE ${staffOwnerGuardSql}`);
    assert.equal(Number(update.run('ronchin', 'dolce-pizza', 'employee-1').changes), 0);
    assert.equal(Number(update.run('ronchin', 'dolce-pizza', 'owner-1').changes), 1);
    assert.equal(Number(update.run('other-site', 'other-brand', 'owner-1').changes), 0);
    database.exec("UPDATE organization_memberships SET status='revoked' WHERE id='owner'");
    assert.equal(Number(update.run('ronchin', 'dolce-pizza', 'owner-1').changes), 0);
  } finally {database.close();}
});

test('JSON body limits count UTF-8 bytes without requiring a Content-Length header', async () => {
  const request = new Request('https://example.test/api/staff', {method: 'POST', body: 'é'.repeat(2001)});
  assert.equal(request.headers.get('content-length'), null);
  await assert.rejects(readBoundedRequestText(request, 4000), RangeError);
  assert.equal(await readBoundedRequestText(new Request('https://example.test', {method: 'POST', body: 'é'.repeat(2000)}), 4000), 'é'.repeat(2000));
});
