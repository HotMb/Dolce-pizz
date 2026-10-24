import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {registerHooks, stripTypeScriptTypes} from 'node:module';
import {DatabaseSync, type SQLInputValue} from 'node:sqlite';
import {test} from 'node:test';
import {createTicketFromOrder} from '../lib/production-repository';

const migrationDirectory = new URL('../drizzle/', import.meta.url);
const migrations = readdirSync(migrationDirectory).filter(name => name.endsWith('.sql')).sort();

function migrate(database: DatabaseSync) {
  database.exec('PRAGMA foreign_keys=ON');
  for (const migration of migrations) database.exec(readFileSync(new URL(migration, migrationDirectory), 'utf8'));
}

function makeD1(database: DatabaseSync) {
  let beforeBatch: (() => void) | null = null;
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
  const d1 = {
    prepare,
    async batch(statements: D1PreparedStatement[]) {
      beforeBatch?.(); beforeBatch = null;
      database.exec('BEGIN');
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        database.exec('COMMIT'); return results;
      } catch (error) {database.exec('ROLLBACK'); throw error;}
    },
    setBeforeBatch(callback: () => void) {beforeBatch = callback;},
  };
  return d1 as unknown as D1Database & {setBeforeBatch(callback: () => void): void};
}

const sha256 = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), byte => byte.toString(16).padStart(2, '0')).join('');

test('staff order API enforces channel scopes, prices server-side, stores pickup only and captures SMS opt-in', async context => {
  const database = new DatabaseSync(':memory:');
  migrate(database);
  const binding = {DB: makeD1(database)};
  const globals = globalThis as unknown as {__dolceStaffOrdersEnvironment?: typeof binding};
  globals.__dolceStaffOrdersEnvironment = binding;
  const hook = registerHooks({
    resolve(specifier, resolverContext, nextResolve) {
      if (specifier === 'cloudflare:workers') return {url: 'data:text/javascript,export const env=globalThis.__dolceStaffOrdersEnvironment;', shortCircuit: true};
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
  context.after(() => {hook.deregister(); delete globals.__dolceStaffOrdersEnvironment; database.close();});
  const api = await import('../app/api/staff/orders/route');
  const customerLookupApi = await import('../app/api/staff/customers/route');
  const notificationAdminApi = await import('../app/api/admin/notifications/route');
  const catalogApi = await import('../app/api/staff/catalog/route');
  const customerApi = await import('../app/api/[...path]/route');
  type Handler = (request: Request) => Promise<Response>;
  async function call<T = Record<string, unknown>>(handler: Handler, method: string, body?: unknown, options: {
    cookie?: string; origin?: string | null; query?: string; rawBody?: string; path?: string;
  } = {}) {
    const url = `http://localhost/api/${options.path || 'staff/orders'}${options.query ? `?${options.query}` : ''}`;
    const headers = new Headers({'content-type': 'application/json'});
    if (options.origin !== null) headers.set('origin', options.origin || 'http://localhost');
    if (options.cookie) headers.set('cookie', options.cookie);
    const request = new Request(url, {method, headers, ...((body !== undefined || options.rawBody !== undefined) ? {body: options.rawBody ?? JSON.stringify(body)} : {})});
    const response = await handler(request);
    return {response, body: await response.json() as T};
  }
  async function session(userId: string) {
    const token = (userId === 'owner' ? 'a' : userId === 'pos-worker' ? 'b' : userId === 'phone-worker' ? 'c' : 'd').repeat(64);
    database.prepare('INSERT INTO users(id,phone,name,created_at) VALUES(?,?,?,?)').run(userId, `+3360000000${userId === 'owner' ? '1' : userId === 'pos-worker' ? '2' : userId === 'phone-worker' ? '3' : '4'}`, `Account ${userId}`, '2026-10-01T00:00:00.000Z');
    database.prepare('INSERT INTO sessions(id,user_id,expires_at,created_at) VALUES(?,?,?,?)').run(await sha256(token), userId, Date.now() + 3_600_000, new Date().toISOString());
    return `dolce_session=${token}`;
  }
  const ownerCookie = await session('owner');
  const posCookie = await session('pos-worker');
  const callCenterCookie = await session('phone-worker');
  const noRoleCookie = await session('no-role');
  const now = new Date().toISOString();
  database.exec(`
    INSERT INTO organization_memberships(id,organization_id,location_id,principal_id,role,status,created_at,updated_at)
    VALUES('owner-membership','dolce-pizza',NULL,'owner','owner','active','${now}','${now}'),
      ('pos-membership','dolce-pizza','ronchin','pos-worker','pos','active','${now}','${now}'),
      ('phone-membership','dolce-pizza','ronchin','phone-worker','call_center','active','${now}','${now}');
    INSERT INTO locations(id,organization_id,code,name,status,address_line1,postal_code,locality,phone,country_code,timezone,created_at,updated_at)
      VALUES('second-site','dolce-pizza','second','Second site','active','2 rue Test','59000','Lille','+33320000000','FR','Europe/Paris','${now}','${now}');
  `);
  database.prepare("INSERT INTO users(id,phone,name,created_at) VALUES('known-customer','+33611111111','Compte client','2026-10-01T00:00:00.000Z')").run();
  database.prepare("INSERT INTO customer_profiles(organization_id,user_id,name,marketing,marketing_at,marketing_source,created_at,updated_at) VALUES('dolce-pizza','known-customer','Alice historique',0,'','','2026-10-01','2026-10-01')").run();

  assert.equal((await call(api.POST, 'POST', {}, {origin: 'http://elsewhere', cookie: ownerCookie})).response.status, 403);
  assert.equal((await call(api.POST, 'POST', {}, {cookie: ''})).response.status, 401);
  assert.equal((await call(api.GET, 'GET', undefined, {query: 'organizationId=dolce-pizza&locationId=ronchin', cookie: noRoleCookie})).response.status, 403);
  assert.equal((await call(api.GET, 'GET', undefined, {query: 'organizationId=dolce-pizza&locationId=ronchin', cookie: ownerCookie})).response.status, 200);
  const config = database.prepare('SELECT value FROM config WHERE id=1').get()!;
  const settings = {...JSON.parse(String(config.value)), hoursConfirmed: true, leadMinutes: 15, cutoffMinutes: 0, capacity: 30, hours: Array.from({length: 7}, () => ({open: '00:00', close: '00:00', closed: false}))};
  database.prepare('UPDATE config SET value=?,version=version+1 WHERE id=1').run(JSON.stringify(settings));
  const slots = await call<{slots: {iso: string; remaining: number}[]; location: {name: string; addressLine1: string; postalCode: string; locality: string; phone: string}}>(api.GET, 'GET', undefined, {query: 'organizationId=dolce-pizza&locationId=ronchin', cookie: ownerCookie, origin: null});
  assert.ok(slots.body.slots.length > 0);
  assert.deepEqual(slots.body.location, {name: 'Dolce Pizz’ — Ronchin', addressLine1: '191 avenue Jean-Jaurès', postalCode: '59790', locality: 'Ronchin', phone: '+33 3 20 40 09 01'});
  const secondSiteSlots = await call<{slots: {iso: string}[]}>(api.GET, 'GET', undefined, {query: 'organizationId=dolce-pizza&locationId=second-site', cookie: ownerCookie});
  assert.equal(secondSiteSlots.response.status, 200);assert.ok(secondSiteSlots.body.slots.length > 0);
  assert.equal((await call(api.GET, 'GET', undefined, {query: 'organizationId=dolce-pizza&locationId=ronchin', cookie: ownerCookie, origin: 'http://attacker.invalid'})).response.status, 403);
  const foundCustomer = await call<{customer:{name:string;phone:string;orderCount:number}|null}>(customerLookupApi.GET, 'GET', undefined, {path: 'staff/customers', query: 'organizationId=dolce-pizza&locationId=ronchin&phone=06%2011%2011%2011%2011', cookie: callCenterCookie});
  assert.equal(foundCustomer.response.status, 200);
  assert.deepEqual(foundCustomer.body.customer, {name: 'Alice historique', phone: '+33611111111', orderCount: 0, lastOrderAt: null});
  assert.equal((await call(customerLookupApi.GET, 'GET', undefined, {path: 'staff/customers', query: 'organizationId=dolce-pizza&locationId=ronchin&phone=06%2011%2011%2011%2011', cookie: noRoleCookie})).response.status, 403);
  const notificationStatus = await call<{counts:unknown[];recent:unknown[]}>(notificationAdminApi.GET, 'GET', undefined, {path: 'admin/notifications', query: 'organizationId=dolce-pizza', cookie: ownerCookie});
  assert.equal(notificationStatus.response.status, 200);
  assert.deepEqual(notificationStatus.body, {organizationId:'dolce-pizza',counts:[],recent:[]});
  assert.equal((await call(notificationAdminApi.GET, 'GET', undefined, {path: 'admin/notifications', query: 'organizationId=dolce-pizza', cookie: noRoleCookie})).response.status, 403);
  const product = database.prepare("SELECT id,price FROM products WHERE available=1 AND status='published' AND offer=0 AND xxl IS NOT NULL LIMIT 1").get() as {id: string; price: number};
  assert.ok(product);
  const scope = {organizationId: 'dolce-pizza', locationId: 'ronchin'};
  const base = {
    key: crypto.randomUUID(), ...scope, channel: 'counter', customerName: 'Alice Client', customerPhone: '06 12 34 56 78',
    readySmsConfirmed: true, postalCode: '59790', slot: slots.body.slots[0].iso, note: 'Sans champignons et appelez-moi au 06 12 34 56 78',
    items: [{id: product.id, size: 'senior', quantity: 1, option: ''}],
  };
  // The catalog itself is authoritative; adding a fake client price is rejected by the strict line schema.
  const forged = await call(api.POST, 'POST', {...base, items: [{...base.items[0], price: 1}]}, {cookie: posCookie});
  assert.equal(forged.response.status, 400);
  assert.equal((await call(api.POST, 'POST', {...base, paymentMethod: 'card'}, {cookie: posCookie})).response.status, 400);
  const offer = await call(api.POST, 'POST', {...base, key: crypto.randomUUID(), items: [{id: product.id, size: 'senior', quantity: 1, option: '', freeId: product.id}]}, {cookie: posCookie});
  assert.equal(offer.response.status, 409);
  assert.equal((await call(api.POST, 'POST', base, {cookie: posCookie})).response.status, 201);
  const created = await call<{order: {id: string; total: number; status: string; slot: string; locationId: string; channel: string}}>(api.POST, 'POST', base, {cookie: posCookie});
  assert.equal(created.response.status, 200);
  assert.deepEqual(Object.keys(created.body.order).sort(), ['channel', 'id', 'locationId', 'slot', 'status', 'total']);
  assert.equal(created.body.order.status, 'preparing');
  assert.equal(created.body.order.total, product.price);
  assert.equal(JSON.stringify(created.body).includes('Alice Client'), false);
  assert.equal(JSON.stringify(created.body).includes('06 12 34 56 78'), false);
  assert.equal(database.prepare('SELECT COUNT(*) AS n FROM orders WHERE user_id=? AND idempotency=?').get('pos-worker', base.key)?.n, 1);
  const stored = database.prepare('SELECT * FROM orders WHERE id=?').get(created.body.order.id) as Record<string, unknown>;
  assert.equal(stored.user_id, 'pos-worker');
  assert.equal(stored.fulfillment, 'pickup');
  assert.equal(stored.payment_status, 'due_at_pickup');
  assert.equal(stored.payment_method, null);
  assert.equal(stored.redeemed, 0);
  assert.equal(stored.earned, 0);
  assert.equal(stored.discount, 0);
  assert.equal(stored.offer_discount, 0);
  assert.equal(stored.subtotal, product.price);
  assert.equal(stored.total, product.price);
  assert.equal(stored.notification_phone, '+33612345678');
  assert.equal(stored.notification_phone_basis, 'staff_confirmed');
  assert.ok(stored.notification_phone_captured_at);

  // A staff member explicitly assigned to a second tenant sees that tenant's
  // menu/configuration, and can reuse the same idempotency key in its scope.
  database.exec("INSERT INTO organizations(id,name,slug,status,created_at,updated_at) VALUES('other-brand','Other','other','active','2026-10-22','2026-10-22'); INSERT INTO locations(id,organization_id,code,name,status,created_at,updated_at) VALUES('other-site','other-brand','other','Other site','active','2026-10-22','2026-10-22');");
  const otherConfig = database.prepare('SELECT value,version FROM config WHERE organization_id=?').get('dolce-pizza') as {value: string; version: number};
  database.prepare('INSERT INTO config(id,value,version,organization_id) VALUES(2,?,?,?)').run(otherConfig.value, otherConfig.version, 'other-brand');
  database.prepare("INSERT INTO products(id,name,category,description,price,xxl,available,options,offer,ingredients,allergens,allergens_checked,tagline,photo,status,spicy,sort,version,updated_at,organization_id) VALUES('other-dessert','Dessert autre','desserts','',2500,NULL,1,'[]',0,'[]','[]',1,'','none','published',0,0,1,?,'other-brand')").run(now);
  database.prepare("INSERT INTO products(id,name,category,description,price,xxl,available,options,offer,ingredients,allergens,allergens_checked,tagline,photo,status,spicy,sort,version,updated_at,organization_id) VALUES('other-draft','Brouillon privé','desserts','',9900,NULL,1,'[]',0,'[]','[]',1,'','none','draft',0,1,1,?,'other-brand')").run(now);
  const otherScope = {organizationId: 'other-brand', locationId: 'other-site'};
  assert.equal((await call(api.GET, 'GET', undefined, {query: 'organizationId=other-brand&locationId=other-site', cookie: posCookie})).response.status, 403);
  assert.equal((await call(catalogApi.GET, 'GET', undefined, {path: 'staff/catalog', query: 'organizationId=other-brand&locationId=other-site', cookie: posCookie})).response.status, 403);
  const wrongTenantProduct = await call(api.POST, 'POST', {...base, key: crypto.randomUUID(), items: [{id: 'other-dessert', size: 'unique', quantity: 1, option: ''}]}, {cookie: posCookie});
  assert.equal(wrongTenantProduct.response.status, 409);
  database.prepare("INSERT INTO organization_memberships(id,organization_id,location_id,principal_id,role,status,created_at,updated_at) VALUES('pos-other-membership',? ,? ,'pos-worker','pos','active',?,?)").run(otherScope.organizationId, otherScope.locationId, now, now);
  const scopedCatalog = await call<{products: {id: string}[];extraPrice: number}>(catalogApi.GET, 'GET', undefined, {path: 'staff/catalog', query: 'organizationId=other-brand&locationId=other-site', cookie: posCookie});
  assert.equal(scopedCatalog.response.status, 200);
  assert.deepEqual(scopedCatalog.body.products.map(item=>item.id), ['other-dessert']);
  assert.equal(scopedCatalog.body.extraPrice, 150);
  const sameKeyOtherTenant = await call<{order: {id: string; total: number; locationId: string}}>(api.POST, 'POST', {
    ...base, ...otherScope, items: [{id: 'other-dessert', size: 'unique', quantity: 1, option: ''}],
  }, {cookie: posCookie});
  assert.equal(sameKeyOtherTenant.response.status, 201, JSON.stringify(sameKeyOtherTenant.body));
  assert.equal(sameKeyOtherTenant.body.order.total, 2500);
  assert.equal(sameKeyOtherTenant.body.order.locationId, 'other-site');
  const ticket = createTicketFromOrder({id: String(stored.id), created_at: String(stored.created_at), slot: String(stored.slot), channel: String(stored.channel), fulfillment: String(stored.fulfillment), note: String(stored.note), items: String(stored.items)}).payload;
  const ticketJson = JSON.stringify(ticket);
  assert.equal(ticketJson.includes('Alice Client'), false);
  assert.equal(ticketJson.includes('+33612345678'), false);
  assert.equal(ticket.note.includes('[coordonnée masquée]'), true);

  // Staff order keys cannot be replayed through customer endpoints; employee identity is not the customer owner.
  const replayThroughWeb = await call(customerApi.POST, 'POST', {
    key: base.key, name: 'Client du web', note: '', slot: base.slot, ticket: false, items: base.items,
  }, {cookie: posCookie, path: 'orders'});
  assert.equal(replayThroughWeb.response.status, 409);
  database.prepare("UPDATE organization_memberships SET status='revoked' WHERE id='pos-membership'").run();
  const staffAccountOrders = await call<{orders: unknown[]}>(customerApi.GET, 'GET', undefined, {cookie: posCookie, path: 'me'});
  assert.equal(staffAccountOrders.response.status, 200);
  assert.deepEqual(staffAccountOrders.body.orders, []);
  assert.equal((await call(customerApi.GET, 'GET', undefined, {cookie: posCookie, path: `orders/${stored.id}`})).response.status, 404);
  assert.equal((await call(customerApi.PATCH, 'PATCH', {status: 'cancelled', version: 1}, {cookie: posCookie, path: `orders/${stored.id}`})).response.status, 404);
  database.prepare("UPDATE organization_memberships SET status='active' WHERE id='pos-membership'").run();

  database.prepare('UPDATE products SET offer=1 WHERE id=?').run(product.id);
  const eligibleOffer = {...base, key: crypto.randomUUID(), items: [{id: product.id, size: 'senior', quantity: 1, option: '', freeId: product.id}]};
  const offered = await call<{order: {id: string; total: number}}>(api.POST, 'POST', eligibleOffer, {cookie: posCookie});
  assert.equal(offered.response.status, 201);
  assert.equal(offered.body.order.total, product.price);
  const offerSnapshot = database.prepare('SELECT subtotal,offer_discount,discount,total,redeemed,earned FROM orders WHERE id=?').get(offered.body.order.id) as Record<string, number>;
  assert.equal(offerSnapshot.subtotal, product.price);
  assert.equal(offerSnapshot.offer_discount, product.price);
  assert.equal(offerSnapshot.discount, 0);
  assert.equal(offerSnapshot.total, product.price);
  assert.equal(offerSnapshot.redeemed, 0);
  assert.equal(offerSnapshot.earned, 0);
  const replayOffer = await call<{order: {id: string}}>(api.POST, 'POST', eligibleOffer, {cookie: posCookie});
  assert.equal(replayOffer.response.status, 200);
  assert.equal(replayOffer.body.order.id, offered.body.order.id);
  assert.equal(database.prepare('SELECT COUNT(*) AS n FROM orders WHERE user_id=? AND idempotency=?').get('pos-worker', eligibleOffer.key)?.n, 1);

  const noConsent = {...base, key: crypto.randomUUID(), channel: 'phone', customerPhone: '0612345678', readySmsConfirmed: false};
  assert.equal((await call(api.POST, 'POST', noConsent, {cookie: callCenterCookie})).response.status, 201);
  const unnotified = database.prepare('SELECT phone,notification_phone,notification_phone_basis,notification_phone_captured_at FROM orders WHERE idempotency=?').get(noConsent.key) as Record<string, unknown>;
  assert.equal(unnotified.phone, '');
  assert.equal(unnotified.notification_phone, '');
  assert.equal(unnotified.notification_phone_basis, 'none');
  assert.equal(unnotified.notification_phone_captured_at, null);
  const noNumber = {...base, key: crypto.randomUUID(), channel: 'phone', customerPhone: '', readySmsConfirmed: true};
  assert.equal((await call(api.POST, 'POST', noNumber, {cookie: callCenterCookie})).response.status, 201);
  const noNumberSnapshot = database.prepare('SELECT phone,notification_phone,notification_phone_basis,notification_phone_captured_at FROM orders WHERE idempotency=?').get(noNumber.key) as Record<string, unknown>;
  assert.equal(noNumberSnapshot.phone, '');
  assert.equal(noNumberSnapshot.notification_phone, '');
  assert.equal(noNumberSnapshot.notification_phone_basis, 'none');
  assert.equal(noNumberSnapshot.notification_phone_captured_at, null);
  assert.equal((await call(api.POST, 'POST', {...base, key: crypto.randomUUID(), channel: 'phone'}, {cookie: posCookie})).response.status, 403);
  assert.equal((await call(api.POST, 'POST', {...base, key: crypto.randomUUID(), channel: 'counter'}, {cookie: callCenterCookie})).response.status, 403);

  const raced = {...base, key: crypto.randomUUID()};
  binding.DB.setBeforeBatch(() => database.prepare("UPDATE organization_memberships SET status='revoked' WHERE id='pos-membership'").run());
  assert.equal((await call(api.POST, 'POST', raced, {cookie: posCookie})).response.status, 403);
  assert.equal(database.prepare('SELECT COUNT(*) AS n FROM orders WHERE user_id=? AND idempotency=?').get('pos-worker', raced.key)?.n, 0);
  database.prepare("UPDATE organization_memberships SET status='active' WHERE id='pos-membership'").run();

  database.prepare("UPDATE locations SET status='suspended' WHERE id='ronchin'").run();
  assert.equal((await call(api.GET, 'GET', undefined, {query: 'organizationId=dolce-pizza&locationId=ronchin', cookie: ownerCookie})).response.status, 403);
  database.prepare("UPDATE locations SET status='active' WHERE id='ronchin'").run();
  const capacitySettings = {...settings, capacity: 1};
  database.prepare('UPDATE config SET value=?,version=version+1 WHERE id=1').run(JSON.stringify(capacitySettings));
  const capacitySlot = slots.body.slots[10].iso;
  const equivalentSlot = capacitySlot.replace(/\.000Z$/, '.0009Z');
  const firstCapacityOrder = {...base, key: crypto.randomUUID(), slot: equivalentSlot};
  const firstCapacityResponse = await call<{order: {id: string; slot: string}}>(api.POST, 'POST', firstCapacityOrder, {cookie: posCookie});
  assert.equal(firstCapacityResponse.response.status, 201);
  assert.equal(firstCapacityResponse.body.order.slot, capacitySlot);
  assert.equal(database.prepare('SELECT slot FROM orders WHERE id=?').get(firstCapacityResponse.body.order.id)?.slot, capacitySlot);
  // Simulate a legacy row written before canonical formatting was enforced.
  database.prepare('UPDATE orders SET slot=? WHERE id=?').run(equivalentSlot, firstCapacityResponse.body.order.id);
  const recomputedSlots = await call<{slots: {iso: string; remaining: number}[]}>(api.GET, 'GET', undefined, {query: 'organizationId=dolce-pizza&locationId=ronchin', cookie: ownerCookie});
  assert.equal(recomputedSlots.body.slots.some(item => item.iso === capacitySlot), false);
  const secondCapacityOrder = {...base, key: crypto.randomUUID(), slot: capacitySlot};
  assert.equal((await call(api.POST, 'POST', secondCapacityOrder, {cookie: posCookie})).response.status, 409);
  assert.equal(database.prepare("SELECT COUNT(*) AS n FROM orders WHERE organization_id=? AND location_id=? AND substr(slot,1,16)||':00.000Z'=?").get('dolce-pizza', 'ronchin', capacitySlot)?.n, 1);
  database.prepare("UPDATE organizations SET status='suspended' WHERE id='dolce-pizza'").run();
  assert.equal((await call(api.POST, 'POST', {...base, key: crypto.randomUUID()}, {cookie: ownerCookie})).response.status, 403);
  assert.equal((await call(api.GET, 'GET', undefined, {query: 'organizationId=dolce-pizza&locationId=ronchin', cookie: ownerCookie})).response.status, 403);
  assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all(), []);
});
