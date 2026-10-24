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
  type Handler = (request: Request) => Promise<Response>;
  async function call<T = Record<string, unknown>>(handler: Handler, body: unknown, cookie = '') {
    const headers = new Headers({'content-type': 'application/json', origin: 'http://localhost'});
    if (cookie) headers.set('cookie', cookie);
    const response = await handler(new Request('http://localhost/api/staff/payments', {method: 'POST', headers, body: JSON.stringify(body)}));
    return {response, body: await response.json() as T};
  }
  async function list<T = Record<string, unknown>>(cookie = '') {
    const headers = new Headers({origin: 'http://localhost'});
    if (cookie) headers.set('cookie', cookie);
    const response = await api.GET(new Request('http://localhost/api/staff/payments?organizationId=dolce-pizza&locationId=ronchin', {headers}));
    return {response, body: await response.json() as T};
  }
  async function session(userId: string, token: string) {
    const now = new Date().toISOString();
    database.prepare('INSERT INTO users(id,phone,name,created_at) VALUES(?,?,?,?)').run(userId, `+336000000${userId === 'owner' ? '1' : '2'}`, userId, now);
    database.prepare('INSERT INTO sessions(id,user_id,expires_at,created_at) VALUES(?,?,?,?)').run(await sha256(token), userId, Date.now() + 3_600_000, now);
    return `dolce_session=${token}`;
  }
  const ownerCookie = await session('owner', 'a'.repeat(64));
  const workerCookie = await session('worker', 'b'.repeat(64));
  const now = new Date().toISOString();
  database.prepare("INSERT INTO organization_memberships(id,organization_id,location_id,principal_id,role,status,created_at,updated_at) VALUES('owner-membership','dolce-pizza',NULL,'owner','owner','active',?,?),('worker-membership','dolce-pizza','ronchin','worker','pos','active',?,?)").run(now, now, now, now);
  database.prepare(`INSERT INTO orders(id,user_id,customer_user_id,idempotency,name,phone,email,items,note,slot,subtotal,offer_discount,discount,total,redeemed,earned,status,reason,organization_id,location_id,channel,fulfillment,payment_status,payment_method,notification_phone,notification_phone_basis,notification_phone_captured_at,created_at,updated_at,version)
    VALUES('ready-order','worker',NULL,'order-key','Client','','','[]','', '2026-10-24T18:00:00.000Z',1200,0,0,1200,0,0,'ready','', 'dolce-pizza','ronchin','counter','pickup','due_at_pickup',NULL,'','none',NULL,?,?,1)`).run(now, now);
  const base = {organizationId: 'dolce-pizza', locationId: 'ronchin', orderId: 'ready-order', idempotencyKey: crypto.randomUUID(), amount: 1200, method: 'cash' as const};
  assert.equal((await call(api.POST, base)).response.status, 401);
  const readyList = await list<{orders: {id: string; total: number}[]}>(workerCookie);
  assert.equal(readyList.response.status, 200);
  assert.deepEqual(readyList.body.orders.map(order => [order.id, order.total]), [['ready-order', 1200]]);
  assert.equal((await call(api.POST, {...base, amount: 1100}, ownerCookie)).response.status, 409);
  const captured = await call<{payment: {id: string; amount: number; method: string}; order: {status: string; paymentStatus: string}}>(api.POST, base, workerCookie);
  assert.equal(captured.response.status, 201, JSON.stringify(captured.body));
  assert.deepEqual(captured.body.payment, {id: captured.body.payment.id, orderId: 'ready-order', amount: 1200, method: 'cash', status: 'captured'});
  assert.deepEqual(captured.body.order, {id: 'ready-order', status: 'completed', paymentStatus: 'paid'});
  assert.equal(database.prepare('SELECT status,payment_status,payment_method,version FROM orders WHERE id=?').get('ready-order')?.status, 'completed');
  assert.equal(database.prepare('SELECT COUNT(*) AS n FROM payments WHERE order_id=?').get('ready-order')?.n, 1);
  const replay = await call(api.POST, base, workerCookie);
  assert.equal(replay.response.status, 200);
  assert.equal((replay.body as {payment: {id: string}}).payment.id, captured.body.payment.id);
  assert.throws(() => database.prepare('UPDATE payments SET amount=1 WHERE id=?').run(captured.body.payment.id));
  assert.throws(() => database.prepare('DELETE FROM payments WHERE id=?').run(captured.body.payment.id));
});
