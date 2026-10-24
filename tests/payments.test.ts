import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {registerHooks, stripTypeScriptTypes} from 'node:module';
import {DatabaseSync, type SQLInputValue} from 'node:sqlite';
import {test} from 'node:test';

const migrationDirectory = new URL('../drizzle/', import.meta.url);
const migrations = readdirSync(migrationDirectory).filter(name => name.endsWith('.sql')).sort();

function makeD1(database: DatabaseSync) {
  const prepare = (sql: string, values: SQLInputValue[] = []): D1PreparedStatement => {
    const query = database.prepare(sql);
    return {
      bind(...parameters: unknown[]) {return prepare(sql, parameters as SQLInputValue[]);},
      async first(column?: string) {
        const row = query.get(...values) as Record<string, unknown> | undefined;
        return column ? row?.[column] ?? null : row ?? null;
      },
      async all() {return {success: true, results: query.all(...values), meta: {changes: 0}};},
      async run() {const result = query.run(...values); return {success: true, results: [], meta: {changes: Number(result.changes)}};},
    } as unknown as D1PreparedStatement;
  };
  return {
    prepare,
    async batch(statements: D1PreparedStatement[]) {
      database.exec('BEGIN');
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        database.exec('COMMIT');
        return results;
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
    },
  } as unknown as D1Database;
}

const sha256 = async (value: string) => Array.from(
  new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))),
  byte => byte.toString(16).padStart(2, '0'),
).join('');

test('pickup payment captures exactly once and cannot bypass readiness or scope', async context => {
  const database = new DatabaseSync(':memory:');
  database.exec('PRAGMA foreign_keys=ON');
  for (const migration of migrations) database.exec(readFileSync(new URL(migration, migrationDirectory), 'utf8'));
  const binding = {DB: makeD1(database)};
  const globals = globalThis as unknown as {__dolcePaymentsEnvironment?: typeof binding};
  globals.__dolcePaymentsEnvironment = binding;
  const hook = registerHooks({
    resolve(specifier, resolverContext, nextResolve) {
      if (specifier === 'cloudflare:workers') return {url: 'data:text/javascript,export const env=globalThis.__dolcePaymentsEnvironment;', shortCircuit: true};
      if (specifier.startsWith('@/')) return nextResolve(new URL(`../${specifier.slice(2)}.ts`, import.meta.url).href, resolverContext);
      if (specifier === 'next/server' || specifier === 'next/headers') return nextResolve(`${specifier}.js`, resolverContext);
      return nextResolve(specifier, resolverContext);
    },
    load(url, loaderContext, nextLoad) {
      const loaded = nextLoad(url, loaderContext);
      if (url.startsWith(new URL('../', import.meta.url).href) && url.endsWith('.ts')) {
        const source = typeof loaded.source === 'string' ? loaded.source : new TextDecoder().decode(loaded.source as Uint8Array);
        return {format: 'module', source: stripTypeScriptTypes(source, {mode: 'transform', sourceUrl: url}), shortCircuit: true};
      }
      return loaded;
    },
  });
  context.after(() => {hook.deregister(); delete globals.__dolcePaymentsEnvironment; database.close();});
  const api = await import('../app/api/staff/payments/route');
  const refunds = await import('../app/api/staff/refunds/route');
  const sessionRevoke = await import('../app/api/staff/sessions/route');
  const calls = await import('../app/api/staff/calls/route');
  const health = await import('../app/api/admin/health/route');
  const shifts = await import('../app/api/staff/shifts/route');
  const routing = await import('../app/api/staff/routing/route');
  const locations = await import('../app/api/admin/locations/route');
  const devices = await import('../app/api/staff/devices/route');
  const heartbeat = await import('../app/api/device/heartbeat/route');
  const printJobs = await import('../app/api/internal/print-jobs/route');
  type Handler = (request: Request) => Promise<Response>;
  async function call<T = Record<string, unknown>>(handler: Handler, body: unknown, cookie = '') {
    const headers = new Headers({'content-type': 'application/json', origin: 'http://localhost'});
    if (cookie) headers.set('cookie', cookie);
    const response = await handler(new Request('http://localhost/api/staff/payments', {method: 'POST', headers, body: JSON.stringify(body)}));
    return {response, body: await response.json() as T};
  }
  async function shiftCall<T = Record<string, unknown>>(body: unknown, cookie = '') {
    const headers = new Headers({'content-type': 'application/json', origin: 'http://localhost'});
    if (cookie) headers.set('cookie', cookie);
    const response = await shifts.POST(new Request('http://localhost/api/staff/shifts', {method: 'POST', headers, body: JSON.stringify(body)}));
    return {response, body: await response.json() as T};
  }
  async function routingCall<T = Record<string, unknown>>(body: unknown, cookie = '') {
    const headers = new Headers({'content-type': 'application/json', origin: 'http://localhost'});
    if (cookie) headers.set('cookie', cookie);
    const response = await routing.POST(new Request('http://localhost/api/staff/routing', {method: 'POST', headers, body: JSON.stringify(body)}));
    return {response, body: await response.json() as T};
  }
  async function routingList<T = Record<string, unknown>>(postalCode: string, cookie = '') {
    const headers = new Headers({origin: 'http://localhost'});
    if (cookie) headers.set('cookie', cookie);
    const response = await routing.GET(new Request(`http://localhost/api/staff/routing?organizationId=dolce-pizza&postalCode=${postalCode}`, {headers}));
    return {response, body: await response.json() as T};
  }
  async function deviceCall<T = Record<string, unknown>>(body: unknown, cookie = '') {
    const headers = new Headers({'content-type': 'application/json', origin: 'http://localhost'});
    if (cookie) headers.set('cookie', cookie);
    const response = await devices.POST(new Request('http://localhost/api/staff/devices', {method: 'POST', headers, body: JSON.stringify(body)}));
    return {response, body: await response.json() as T};
  }
  async function list<T = Record<string, unknown>>(cookie = '') {
    const headers = new Headers({origin: 'http://localhost'});
    if (cookie) headers.set('cookie', cookie);
    const response = await api.GET(new Request('http://localhost/api/staff/payments?organizationId=dolce-pizza&locationId=ronchin', {headers}));
    return {response, body: await response.json() as T};
  }
  async function refundCall<T = Record<string, unknown>>(body: unknown, cookie = '') {
    const headers = new Headers({'content-type': 'application/json', origin: 'http://localhost'});
    if (cookie) headers.set('cookie', cookie);
    const response = await refunds.POST(new Request('http://localhost/api/staff/refunds', {method: 'POST', headers, body: JSON.stringify(body)}));
    return {response, body: await response.json() as T};
  }
  async function session(userId: string, token: string) {
    const now = new Date().toISOString();
    database.prepare('INSERT INTO users(id,phone,name,created_at) VALUES(?,?,?,?)').run(userId, `+336000000${userId === 'owner' ? '1' : '2'}`, userId, now);
    database.prepare('INSERT INTO sessions(id,user_id,expires_at,created_at) VALUES(?,?,?,?)').run(await sha256(token), userId, Date.now() + 3_600_000, now);
    return `dolce_session=${token}`;
  }
  const ownerCookie = await session('owner', 'a'.repeat(64));
  const staleStaffToken = 'c'.repeat(64);
  database.prepare('INSERT INTO sessions(id,user_id,expires_at,created_at) VALUES(?,?,?,?)').run(await sha256(staleStaffToken), 'owner', Date.now() + 3_600_000, new Date(Date.now() - 13 * 3_600_000).toISOString());
  const staleHealth = await health.GET(new Request('http://localhost/api/admin/health?organizationId=dolce-pizza&locationId=ronchin', {headers:new Headers({cookie:`dolce_session=${staleStaffToken}`})}));
  assert.equal(staleHealth.status, 401);
  const workerCookie = await session('worker', 'b'.repeat(64));
  const now = new Date().toISOString();
  database.prepare("INSERT INTO organization_memberships(id,organization_id,location_id,principal_id,role,status,created_at,updated_at) VALUES('owner-membership','dolce-pizza',NULL,'owner','owner','active',?,?),('worker-membership','dolce-pizza','ronchin','worker','pos','active',?,?)").run(now, now, now, now);
  database.prepare(`INSERT INTO orders(id,user_id,customer_user_id,idempotency,name,phone,email,items,note,slot,subtotal,offer_discount,discount,total,redeemed,earned,status,reason,organization_id,location_id,channel,fulfillment,payment_status,payment_method,notification_phone,notification_phone_basis,notification_phone_captured_at,created_at,updated_at,version)
    VALUES('ready-order','worker',NULL,'order-key','Client','','','[{"name":"Pizza","quantity":1,"unitPrice":1200,"total":1200}]','', '2026-10-24T18:00:00.000Z',1200,0,0,1200,0,0,'ready','', 'dolce-pizza','ronchin','counter','pickup','due_at_pickup',NULL,'','none',NULL,?,?,1)`).run(now, now);
  database.prepare("UPDATE orders SET service_mode='dine_in',table_label='T4' WHERE id='ready-order'").run();
  database.prepare(`INSERT INTO cash_shifts(id,organization_id,location_id,business_date,status,opening_float,opened_by,opened_at,version)
    VALUES('shift-1','dolce-pizza','ronchin','2026-10-24','open',1000,'owner',?,1)`).run(now);
  const base = {organizationId: 'dolce-pizza', locationId: 'ronchin', orderId: 'ready-order', idempotencyKey: crypto.randomUUID(), amount: 1200, method: 'cash' as const};
  assert.equal((await call(api.POST, base)).response.status, 401);
  const readyList = await list<{orders: {id: string; total: number; serviceMode: string; tableLabel: string}[]; shift: {id: string; cashSales: number; expectedCash: number}}>(workerCookie);
  assert.equal(readyList.response.status, 200);
  assert.deepEqual(readyList.body.orders.map(order => [order.id, order.total]), [['ready-order', 1200]]);
  assert.equal(readyList.body.orders[0].serviceMode, 'dine_in');
  assert.equal(readyList.body.orders[0].tableLabel, 'T4');
  const additionResponse = await api.GET(new Request('http://localhost/api/staff/payments?organizationId=dolce-pizza&locationId=ronchin&orderId=ready-order', {headers: new Headers({origin: 'http://localhost', cookie: workerCookie})}));
  assert.equal(additionResponse.status, 200);
  const addition = await additionResponse.json() as {addition: {id:string;total:number;remaining:number;serviceMode:string;tableLabel:string;items:Array<{lineIndex:number;remaining:number}>}};
  assert.equal(addition.addition.id, 'ready-order');
  assert.equal(addition.addition.total, 1200);
  assert.equal(addition.addition.remaining, 1200);
  assert.equal(addition.addition.serviceMode, 'dine_in');
  assert.equal(addition.addition.tableLabel, 'T4');
  assert.equal(addition.addition.items.length, 1);
  assert.equal(addition.addition.items[0].lineIndex, 0);
  assert.equal(addition.addition.items[0].remaining, 1200);
  assert.equal(readyList.body.shift.id, 'shift-1');
  assert.equal(readyList.body.shift.cashSales, 0);
  assert.equal(readyList.body.shift.expectedCash, 1000);
  assert.equal((await call(api.POST, {...base, amount: 1100, allocations:[{lineIndex:0,amount:1000}], idempotencyKey: crypto.randomUUID()}, ownerCookie)).response.status, 409);
  const partial = await call<{payment: {id: string; amount: number; method: string}; order: {status: string; paymentStatus: string; paidTotal:number; remaining:number}}>(api.POST, {...base, amount: 1100, allocations:[{lineIndex:0,amount:1100}], idempotencyKey: crypto.randomUUID()}, ownerCookie);
  assert.equal(partial.response.status, 201, JSON.stringify(partial.body));
  assert.equal(partial.body.order.status, 'ready');
  assert.equal(partial.body.order.paymentStatus, 'partially_paid');
  assert.equal(partial.body.order.paidTotal, 1100);
  assert.equal(partial.body.order.remaining, 100);
  const captured = await call<{payment: {id: string; amount: number; method: string}; order: {status: string; paymentStatus: string; paidTotal:number; remaining:number}}>(api.POST, {...base, amount: 100, allocations:[{lineIndex:0,amount:100}]}, workerCookie);
  assert.equal(captured.response.status, 201, JSON.stringify(captured.body));
  assert.deepEqual(captured.body.payment, {id: captured.body.payment.id, orderId: 'ready-order', amount: 100, method: 'cash', status: 'captured'});
  assert.deepEqual(captured.body.order, {id: 'ready-order', status: 'completed', paymentStatus: 'paid', paidTotal: 1200, remaining: 0});
  assert.equal(database.prepare('SELECT status,payment_status,payment_method,version FROM orders WHERE id=?').get('ready-order')?.status, 'completed');
  assert.equal(database.prepare('SELECT COUNT(*) AS n FROM payments WHERE order_id=?').get('ready-order')?.n, 2);
  assert.equal(database.prepare('SELECT COUNT(*) AS n FROM cash_shift_entries WHERE shift_id=?').get('shift-1')?.n, 2);
  const replay = await call(api.POST, {...base, amount: 100, allocations:[{lineIndex:0,amount:100}]}, workerCookie);
  assert.equal(replay.response.status, 200);
  assert.equal((replay.body as {payment: {id: string}}).payment.id, captured.body.payment.id);
  assert.throws(() => database.prepare('UPDATE payments SET amount=1 WHERE id=?').run(captured.body.payment.id));
  assert.throws(() => database.prepare('DELETE FROM payments WHERE id=?').run(captured.body.payment.id));
  const shiftScope = {organizationId: 'dolce-pizza', locationId: 'ronchin'};
  assert.equal((await shiftCall({...shiftScope, action: 'open', openingFloat: 500}, ownerCookie)).response.status, 409);
  assert.equal((await shiftCall({...shiftScope, action: 'close', countedCash: 2200}, workerCookie)).response.status, 403);
  assert.equal((await shiftCall({...shiftScope, action: 'close', countedCash: 2100}, ownerCookie)).response.status, 409);
  const closed = await shiftCall<{shift: {status: string; expectedCash: number}; variance: number}>({...shiftScope, action: 'close', countedCash: 2200, version: 1}, ownerCookie);
  assert.equal(closed.response.status, 200, JSON.stringify(closed.body));
  assert.equal(closed.body.shift.status, 'closed');
  assert.equal(closed.body.shift.expectedCash, 2200);
  assert.equal(closed.body.variance, 0);
  const refund = await refundCall<{refund:{id:string;amount:number;status:string};order:{payment_status:string;paid_total:number}}>({organizationId:'dolce-pizza',locationId:'ronchin',paymentId:captured.body.payment.id,amount:100,reason:'Client remboursé après correction'},ownerCookie);
  assert.equal(refund.response.status,201,JSON.stringify(refund.body));
  assert.equal(refund.body.refund.status,'recorded');
  assert.equal(refund.body.refund.amount,100);
  assert.equal(refund.body.order.payment_status,'partially_refunded');
  assert.equal(refund.body.order.paid_total,1100);
  const refundAdjustment = database.prepare('SELECT amount,method,shift_id FROM cash_shift_adjustments WHERE refund_id=?').get(refund.body.refund.id) as {amount:number;method:string;shift_id:string};
  assert.equal(refundAdjustment.amount, -100);
  assert.equal(refundAdjustment.method, 'cash');
  assert.equal(refundAdjustment.shift_id, 'shift-1');
  assert.equal((await refundCall({organizationId:'dolce-pizza',locationId:'ronchin',paymentId:captured.body.payment.id,amount:50,reason:'Tentative équipe'},workerCookie)).response.status,403);
  assert.equal((await refundCall({organizationId:'dolce-pizza',locationId:'ronchin',paymentId:captured.body.payment.id,amount:101,reason:'Dépassement solde remboursable'},ownerCookie)).response.status,409);
  assert.equal((await call(api.POST, {...base, idempotencyKey: crypto.randomUUID()}, workerCookie)).response.status, 409);
  assert.equal((await routingCall({organizationId: 'dolce-pizza', locationId: 'ronchin', postalCodes: ['59790']}, workerCookie)).response.status, 403);
  assert.equal((await routingCall({organizationId: 'dolce-pizza', locationId: 'ronchin', postalCodes: ['59790']}, ownerCookie)).response.status, 200);
  const addedLocation = await locations.POST(new Request('http://localhost/api/admin/locations', {method: 'POST', headers: new Headers({'content-type': 'application/json', origin: 'http://localhost', cookie: ownerCookie}), body: JSON.stringify({organizationId:'dolce-pizza',locationId:'tourcoing',locationCode:'tourcoing',locationName:'Dolce Pizz’ Tourcoing',addressLine1:'1 rue de test',postalCode:'59200',locality:'Tourcoing',phone:'03 20 00 00 00'})}));
  assert.equal(addedLocation.status, 201, await addedLocation.text());
  const locationList = await locations.GET(new Request('http://localhost/api/admin/locations?organizationId=dolce-pizza', {headers: new Headers({origin:'http://localhost', cookie: ownerCookie})}));
  assert.equal(locationList.status, 200);
  assert.deepEqual((await locationList.json() as {locations:Array<{id:string}>}).locations.map(location => location.id).sort(), ['ronchin', 'tourcoing']);
  const routingTourcoing = await routing.POST(new Request('http://localhost/api/staff/routing', {method:'POST', headers:new Headers({'content-type':'application/json',origin:'http://localhost',cookie:ownerCookie}), body:JSON.stringify({organizationId:'dolce-pizza',locationId:'tourcoing',postalCodes:['59200'],priority:2})}));
  assert.equal(routingTourcoing.status, 200);
  const routingTourcoingList = await routing.GET(new Request('http://localhost/api/staff/routing?organizationId=dolce-pizza&locationId=tourcoing', {headers:new Headers({origin:'http://localhost',cookie:ownerCookie})}));
  assert.equal(routingTourcoingList.status, 200);
  assert.deepEqual((await routingTourcoingList.json() as {postalCodes:string[]}).postalCodes, ['59200']);
  const routed = await routingList<{candidates: {locationId: string; name: string}[]}>('59790', ownerCookie);
  assert.equal(routed.response.status, 200);
  assert.deepEqual(routed.body.candidates.map(candidate => candidate.locationId), ['ronchin']);
  const deviceScope = {organizationId: 'dolce-pizza', locationId: 'ronchin'};
  assert.equal((await deviceCall({...deviceScope, action: 'enroll', label: 'Tablette Make Line', role: 'make_line'}, workerCookie)).response.status, 403);
  const enrolled = await deviceCall<{device: {id: string; role: string}; credential: string}>({...deviceScope, action: 'enroll', label: 'Tablette Make Line', role: 'make_line'}, ownerCookie);
  assert.equal(enrolled.response.status, 201, JSON.stringify(enrolled.body));
  assert.equal(enrolled.body.device.role, 'make_line');
  const heartbeatResponse = await heartbeat.POST(new Request('http://localhost/api/device/heartbeat', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({token: enrolled.body.credential, clientVersion: '1.0.0'})}));
  assert.equal(heartbeatResponse.status, 200);
  assert.equal((await heartbeatResponse.json() as {device: {id: string}}).device.id, enrolled.body.device.id);
  assert.equal((await deviceCall({...deviceScope, action: 'revoke', deviceId: enrolled.body.device.id}, ownerCookie)).response.status, 200);
  const revokedHeartbeat = await heartbeat.POST(new Request('http://localhost/api/device/heartbeat', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({token: enrolled.body.credential})}));
  assert.equal(revokedHeartbeat.status, 401);
  const printer = await deviceCall<{device: {id: string; role: string}; credential: string}>({...deviceScope, action: 'enroll', label: 'Relais imprimante', role: 'printer_gateway'}, ownerCookie);
  assert.equal(printer.response.status, 201, JSON.stringify(printer.body));
  const printNow = new Date().toISOString();
  database.prepare("INSERT INTO print_outbox(id,operation_id,organization_id,location_id,order_id,job_type,payload,status,attempts,available_at,created_at,updated_at) VALUES(?,?,?,?,?,'kitchen_ticket',?,'pending',0,?,?,?)").run('print-test','print-test-op','dolce-pizza','ronchin','ready-order','{}',printNow,printNow,printNow);
  const claimed = await printJobs.POST(new Request('http://localhost/api/internal/print-jobs', {method: 'POST', headers: {'content-type': 'application/json', authorization: `Bearer ${printer.body.credential}`}, body: JSON.stringify({action: 'claim', limit: 1})}));
  assert.equal(claimed.status, 200);
  const claimedBody = await claimed.json() as {jobs: {id: string; lease_token: string}[]};
  assert.equal(claimedBody.jobs.length, 1);
  assert.equal((claimedBody.jobs[0] as {ticket?: {orderId?: string}}).ticket?.orderId, 'ready-order');
  const completed = await printJobs.POST(new Request('http://localhost/api/internal/print-jobs', {method: 'POST', headers: {'content-type': 'application/json', authorization: `Bearer ${printer.body.credential}`}, body: JSON.stringify({action: 'complete', id: claimedBody.jobs[0].id, leaseToken: claimedBody.jobs[0].lease_token, providerJobId: 'local-1'})}));
  assert.equal(completed.status, 200);
  assert.equal(database.prepare('SELECT status,provider_job_id FROM print_outbox WHERE id=?').get('print-test')?.status, 'printed');
  const callLog = await calls.POST(new Request('http://localhost/api/staff/calls', {method:'POST', headers:new Headers({'content-type':'application/json',origin:'http://localhost',cookie:ownerCookie}), body:JSON.stringify({organizationId:'dolce-pizza',locationId:'ronchin',phone:'06 12 34 56 78',outcome:'callback_requested',note:'Rappeler pour confirmer le créneau'})}));
  assert.equal(callLog.status,201,await callLog.text());
  const callHistory = await calls.GET(new Request('http://localhost/api/staff/calls?organizationId=dolce-pizza&locationId=ronchin&phone=0612345678', {headers:new Headers({origin:'http://localhost',cookie:ownerCookie})}));
  assert.equal(callHistory.status,200);
  assert.equal((await callHistory.json() as {interactions:Array<{outcome:string}>}).interactions[0].outcome,'callback_requested');
  const healthResponse = await health.GET(new Request('http://localhost/api/admin/health?organizationId=dolce-pizza&locationId=ronchin', {headers:new Headers({origin:'http://localhost',cookie:ownerCookie})}));
  const healthText = await healthResponse.text();
  assert.equal(healthResponse.status,200,healthText);
  const healthBody = JSON.parse(healthText) as {overall:string;checks:Array<{id:string}>};
  assert.ok(['ok','attention'].includes(healthBody.overall));
  assert.deepEqual(healthBody.checks.map(check => check.id), ['locations','location_configuration','devices','notifications','printing']);
  const revokeResponse = await sessionRevoke.POST(new Request('http://localhost/api/staff/sessions', {method: 'POST', headers: new Headers({'content-type': 'application/json', origin: 'http://localhost', cookie: ownerCookie}), body: JSON.stringify({organizationId: 'dolce-pizza', locationId: 'ronchin', principalId: 'worker'})}));
  assert.equal(revokeResponse.status, 200);
  assert.equal((await api.GET(new Request('http://localhost/api/staff/payments?organizationId=dolce-pizza&locationId=ronchin', {headers: new Headers({origin: 'http://localhost', cookie: workerCookie})}))).status, 401);
});
