import assert from 'node:assert/strict';
import {test} from 'node:test';
import {DatabaseSync, type SQLInputValue} from 'node:sqlite';
import {
  createD1ReadyNotificationStore, dispatchAuthorization, dispatchReadyNotifications,
  handleReadyNotificationRequest, notificationPhone, readyDeliveryDecision, sendReadySms,
  type FinalOutcome, type ReadyDelivery, type ReadyNotificationStore,
} from '../lib/ready-notifications';

const timestamp = '2026-10-22T18:00:00.000Z';
const now = Date.parse(timestamp);
const secret = 'notification-test-secret-01234567890123456789';
const environment = {BREVO_API_KEY: 'test-only-not-a-real-key', NOTIFICATION_DISPATCH_SECRET: secret};
const source: ReadyDelivery = {
  id: 'notification-1', attempts: 1, organizationId: 'org-1', locationId: 'location-1', orderId: 'order-1',
  eventType: 'order_ready', notificationCreatedAt: timestamp, orderOrganizationId: 'org-1', orderLocationId: 'location-1', orderStatus: 'ready',
  fulfillment: 'pickup', channel: 'web', phone: '+33612345678', notificationPhone: '+33612345678',
  notificationPhoneBasis: 'account_otp', notificationPhoneCapturedAt: '2026-10-22T17:30:00.000Z',
  accountPhone: '+33612345678', organizationStatus: 'active', locationStatus: 'active', countryCode: 'FR',
  locationName: 'Pizzeria de test', addressLine1: '1 rue du Test', postalCode: '59000', locality: 'Lille',
  ticketStatus: 'ready', ticketNumber: 12, ticketOrganizationId: 'org-1', ticketLocationId: 'location-1',
};

class MemoryStore implements ReadyNotificationStore {
  row = {...source};
  status = 'pending';
  lease: string | null = null;
  leaseUntil = now + 120_000;
  available = now;
  attempts = 0;
  finishes: FinalOutcome[] = [];
  loads = 0;
  afterClaim?: () => void;
  async recoverExpired(at: string) {
    if (this.status !== 'sending' || this.leaseUntil > Date.parse(at)) return 0;
    this.status = 'unknown'; this.lease = null; return 1;
  }
  async listDue(at: string) { return this.status === 'pending' && this.available <= Date.parse(at) && this.attempts < 5 ? [this.row.id] : []; }
  async claim(_id: string, token: string, at: string, expiresAt: string) {
    if (this.status !== 'pending' || this.available > Date.parse(at) || this.attempts >= 5) return false;
    this.status = 'sending'; this.lease = token; this.leaseUntil = Date.parse(expiresAt); this.attempts++;
    this.afterClaim?.(); return true;
  }
  async delivery(_id: string, token: string | null, at: string) {
    this.loads++;
    if (token && (this.status !== 'sending' || this.lease !== token || this.leaseUntil <= Date.parse(at))) return null;
    return {...this.row, attempts: this.attempts};
  }
  async finish(_id: string, token: string, outcome: FinalOutcome) {
    if (this.status !== 'sending' || token !== this.lease) return false;
    this.status = outcome.status; this.available = Date.parse(outcome.availableAt); this.lease = null;
    this.finishes.push(outcome); return true;
  }
}

test('pickup eligibility validates tenant, lifecycle, station, channel and order-specific contact evidence', () => {
  const result = readyDeliveryDecision(source, now);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.recipient, '+33612345678');
    assert.match(result.content, /commande n°12/);
    assert.match(result.content, /1 rue du Test, 59000 Lille/);
  }
  for (const changes of [
    {orderOrganizationId: 'other'}, {ticketLocationId: 'other'}, {orderStatus: 'cancelled'},
    {orderStatus: 'completed'}, {ticketStatus: 'in_progress'}, {organizationStatus: 'suspended'},
    {locationStatus: 'unconfigured'}, {countryCode: 'BE'}, {channel: 'uber'}, {channel: 'uber_eats'},
    {fulfillment: 'delivery'}, {notificationPhone: ''}, {notificationPhone: '+33712345678'},
    {notificationPhoneBasis: 'none'}, {notificationPhoneCapturedAt: null},
    {notificationPhoneCapturedAt: '2027-01-01T00:00:00Z'}, {accountPhone: '+33712345678'},
    {notificationPhoneCapturedAt: '1'}, {notificationCreatedAt: '2026-10-22T15:59:59.999Z'},
    {notificationCreatedAt: '2026-10-22T18:00:00.001Z'}, {notificationCreatedAt: '1'},
    {postalCode: null}, {addressLine1: null}, {locationName: 'Pizzeria\nInjection'}, {ticketNumber: 0},
  ]) assert.equal(readyDeliveryDecision({...source, ...changes}, now).ok, false, JSON.stringify(changes));
  assert.equal(readyDeliveryDecision({...source, notificationPhoneBasis: 'staff_confirmed', accountPhone: null}, now).ok, true);
  assert.equal(readyDeliveryDecision({...source, notificationCreatedAt: '2026-10-22T16:00:00.000Z'}, now).ok, true);
  assert.equal(notificationPhone('06 12 34 56 78'), '+33612345678');
  for (const phone of ['+441234567890', '0812345678', '0320400901', '', '+336123456789']) assert.equal(notificationPhone(phone), null);
});

test('provider uses fixed endpoint, no redirects, transactional template and accepted message receipt', async () => {
  let calls = 0;
  const outcome = await sendReadySms({recipient: '+33612345678', content: 'Test'}, environment, async (url, init) => {
    calls++;
    assert.equal(url, 'https://api.brevo.com/v3/transactionalSMS/send');
    assert.equal(init.redirect, 'error');
    assert.equal(init.method, 'POST');
    assert.ok(init.signal);
    assert.deepEqual(JSON.parse(String(init.body)), {sender: 'DolcePizz', recipient: '33612345678', content: 'Test',
      type: 'transactional', tag: 'order_ready', unicodeEnabled: true});
    return Response.json({messageId: 1511882900100020}, {status: 201});
  });
  assert.equal(calls, 1);
  assert.deepEqual(outcome, {status: 'sent', providerMessageId: '1511882900100020'});
});

test('only explicit rate rejection retries; server/network/malformed acceptance results remain unknown', async () => {
  for (const status of [408, 425, 500, 502, 503]) {
    assert.equal((await sendReadySms({recipient: source.phone, content: 'Test'}, environment,
      async () => new Response('', {status}))).status, 'unknown');
  }
  for (const status of [400, 401, 402, 403, 422]) {
    assert.equal((await sendReadySms({recipient: source.phone, content: 'Test'}, environment,
      async () => new Response('', {status}))).status, 'failed');
  }
  assert.equal((await sendReadySms({recipient: source.phone, content: 'Test'}, environment,
    async () => {throw new Error('network message containing phone must never be logged');})).status, 'unknown');
  assert.equal((await sendReadySms({recipient: source.phone, content: 'Test'}, environment,
    async () => Response.json({messageId: 9_999_999_999_999_999}, {status: 201}))).status, 'unknown');
  assert.equal((await sendReadySms({recipient: source.phone, content: 'Test'}, environment,
    async () => Response.json({}, {status: 201}))).status, 'unknown');
  assert.equal((await sendReadySms({recipient: source.phone, content: 'Test'}, environment,
    async () => new Response('', {status: 429}))).status, 'retry');
});

test('concurrent drains claim a notification once and repeated drains never resend accepted SMS', async () => {
  const store = new MemoryStore(); let calls = 0;
  const options = {store, environment, now: () => now, transport: async () => {calls++; return Response.json({messageId: 'receipt-1'}, {status: 201});}};
  await Promise.all([dispatchReadyNotifications(options), dispatchReadyNotifications(options)]);
  await dispatchReadyNotifications(options);
  assert.equal(calls, 1); assert.equal(store.status, 'sent'); assert.equal(store.attempts, 1);
  assert.equal(store.finishes[0].providerMessageId, 'receipt-1');
});

test('post-claim re-read suppresses a cancelled order or changed contact and marketing consent is not queried', async () => {
  for (const changes of [{orderStatus: 'cancelled'}, {notificationPhone: '+33712345678'}, {channel: 'uber'}]) {
    const store = new MemoryStore(); let calls = 0;
    store.afterClaim = () => {Object.assign(store.row, changes);};
    const result = await dispatchReadyNotifications({store, environment, now: () => now,
      transport: async () => {calls++; return Response.json({messageId: 'never'});}});
    assert.equal(calls, 0); assert.equal(result.skipped, 1); assert.equal(store.status, 'skipped');
    assert.equal(store.loads, 1);
  }
});

test('dry run reads without mutation or provider credentials; live mode fails closed before claiming', async () => {
  const store = new MemoryStore();
  const result = await dispatchReadyNotifications({store, environment: {}, dryRun: true, now: () => now,
    transport: async () => {throw new Error('must not call provider');}});
  assert.equal(result.eligible, 1); assert.equal(result.sent, 0); assert.equal(store.status, 'pending'); assert.equal(store.attempts, 0);
  await assert.rejects(dispatchReadyNotifications({store, environment: {}, now: () => now}), /provider_unconfigured/);
  assert.equal(store.status, 'pending'); assert.equal(store.attempts, 0);
});

test('429 retries back off and stop after five attempts; ambiguous and stale leases never retry', async () => {
  const store = new MemoryStore(); let clock = now; let calls = 0;
  const options = {store, environment, now: () => clock,
    transport: async () => {calls++; return new Response('', {status: 429});}};
  for (let attempt = 1; attempt <= 5; attempt++) {
    await dispatchReadyNotifications(options);
    assert.equal(store.attempts, attempt);
    if (attempt < 5) {
      assert.equal(store.status, 'pending');
      assert.equal(store.available - clock, 60_000 * 2 ** (attempt - 1));
      await dispatchReadyNotifications(options); assert.equal(calls, attempt);
      clock = store.available;
    }
  }
  assert.equal(store.status, 'failed'); assert.equal(store.finishes.at(-1)?.errorCode, 'retry_exhausted');
  await dispatchReadyNotifications(options); assert.equal(calls, 5);
  const ambiguous = new MemoryStore();
  await dispatchReadyNotifications({store: ambiguous, environment, now: () => now, transport: async () => {throw new Error('timeout');}});
  assert.equal(ambiguous.status, 'unknown');
  await dispatchReadyNotifications({store: ambiguous, environment, now: () => now, transport: async () => {throw new Error('must not resend');}});
  assert.equal(ambiguous.attempts, 1);
  const stale = new MemoryStore(); stale.status = 'sending'; stale.lease = 'crashed-worker'; stale.leaseUntil = now - 1;
  const recovery = await dispatchReadyNotifications({store: stale, environment, now: () => now,
    transport: async () => {throw new Error('must not resend');}});
  assert.equal(recovery.recovered, 1); assert.equal(stale.status, 'unknown'); assert.equal(stale.attempts, 0);
});

test('dispatch endpoint requires POST bearer secret and rejects scope/content/recipient and URL parameters', async () => {
  assert.equal(await dispatchAuthorization(`Bearer ${secret}`, secret), true);
  for (const value of [null, `Basic ${secret}`, `Bearer ${secret}x`, 'Bearer short']) {
    assert.equal(await dispatchAuthorization(value, secret), false);
  }
  assert.equal(await dispatchAuthorization('Bearer short', 'short'), false);
  const store = new MemoryStore(); const dependencies = {environment, store: () => store, now: () => now};
  const request = (body: string, auth = true, suffix = '') => new Request(`https://example.test/api/internal/notifications${suffix}`,
    {method: 'POST', headers: {'content-type': 'application/json', ...(auth ? {authorization: `Bearer ${secret}`} : {cookie: 'dolce_session=admin'})}, body});
  assert.equal((await handleReadyNotificationRequest(new Request('https://example.test/api/internal/notifications'), dependencies)).status, 405);
  assert.equal((await handleReadyNotificationRequest(request('{}', false), dependencies)).status, 401);
  assert.equal((await handleReadyNotificationRequest(request('{}', true, '?secret=never'), dependencies)).status, 400);
  for (const body of ['{"recipient":"+33612345678"}', '{"content":"promo"}', '{"organizationId":"other"}', '{"limit":1000}', '{"dryRun":"true"}', '[]']) {
    assert.equal((await handleReadyNotificationRequest(request(body), dependencies)).status, 400, body);
  }
  assert.equal((await handleReadyNotificationRequest(request(' '.repeat(129)), dependencies)).status, 413);
  const result = await handleReadyNotificationRequest(request('{"dryRun":true}'), dependencies);
  assert.equal(result.status, 200);
  const text = await result.text();
  assert.equal(text.includes(source.phone), false); assert.equal(text.includes(source.orderId), false);
  assert.equal(text.includes(source.addressLine1!), false); assert.equal(store.status, 'pending');
});

test('D1 adapter SQL atomically claims, scopes joins, persists receipts and quarantines expired leases', async (context) => {
  const sqlite = new DatabaseSync(':memory:'); context.after(() => sqlite.close());
  sqlite.exec(`CREATE TABLE notification_outbox(id TEXT PRIMARY KEY,organization_id TEXT,location_id TEXT,order_id TEXT,event_type TEXT,status TEXT,attempts INTEGER,available_at TEXT,created_at TEXT,updated_at TEXT,sent_at TEXT,lease_token TEXT,lease_expires_at TEXT,last_error_code TEXT,provider_message_id TEXT);
    CREATE TABLE orders(id TEXT PRIMARY KEY,organization_id TEXT,location_id TEXT,status TEXT,fulfillment TEXT,channel TEXT,phone TEXT,notification_phone TEXT,notification_phone_basis TEXT,notification_phone_captured_at TEXT,user_id TEXT);
    CREATE TABLE users(id TEXT PRIMARY KEY,phone TEXT); CREATE TABLE organizations(id TEXT PRIMARY KEY,status TEXT);
    CREATE TABLE locations(id TEXT PRIMARY KEY,organization_id TEXT,status TEXT,country_code TEXT,name TEXT,address_line1 TEXT,postal_code TEXT,locality TEXT);
    CREATE TABLE production_tickets(order_id TEXT PRIMARY KEY,organization_id TEXT,location_id TEXT,status TEXT,ticket_number INTEGER);`);
  sqlite.prepare("INSERT INTO notification_outbox VALUES('notification-1','org-1','location-1','order-1','order_ready','pending',0,?,?,NULL,NULL,NULL,NULL,NULL,NULL)").run(timestamp, timestamp);
  sqlite.prepare("INSERT INTO orders VALUES('order-1','org-1','location-1','ready','pickup','web',?,?,'account_otp',?,'user-1')").run(source.phone, source.phone, timestamp);
  sqlite.prepare("INSERT INTO users VALUES('user-1',?)").run(source.phone);
  sqlite.exec("INSERT INTO organizations VALUES('org-1','active'); INSERT INTO locations VALUES('location-1','org-1','active','FR','Pizzeria de test','1 rue du Test','59000','Lille'); INSERT INTO production_tickets VALUES('order-1','org-1','location-1','ready',12);");
  const database = {prepare(sql: string) {
    const statement = sqlite.prepare(sql); let values: SQLInputValue[] = [];
    const adapter = {
      bind(...parameters: unknown[]) {values = parameters as SQLInputValue[]; return adapter;},
      async first<T>() {return (statement.get(...values) || null) as T | null;},
      async all<T>() {return {results: statement.all(...values) as T[]};},
      async run() {const result = statement.run(...values); return {meta: {changes: Number(result.changes)}};},
    };
    return adapter as unknown as D1PreparedStatement;
  }};
  const store = createD1ReadyNotificationStore(database as Pick<D1Database, 'prepare'>);
  assert.deepEqual(await store.listDue(timestamp, 100), ['notification-1']);
  const claims = await Promise.all([store.claim('notification-1', 'winner', timestamp, '2026-10-22T18:02:00.000Z'),
    store.claim('notification-1', 'loser', timestamp, '2026-10-22T18:02:00.000Z')]);
  assert.deepEqual(claims, [true, false]);
  assert.equal(await store.delivery('notification-1', 'loser', timestamp), null);
  const delivery = await store.delivery('notification-1', 'winner', timestamp);
  assert.equal(delivery && readyDeliveryDecision(delivery, now).ok, true);
  sqlite.exec("UPDATE production_tickets SET organization_id='other'");
  const crossScope = await store.delivery('notification-1', 'winner', timestamp);
  assert.equal(crossScope && readyDeliveryDecision(crossScope, now).ok, false);
  const outcome: FinalOutcome = {status: 'sent', providerMessageId: 'receipt-1', errorCode: null, availableAt: timestamp, at: timestamp};
  assert.equal(await store.finish('notification-1', 'loser', outcome), false);
  assert.equal(await store.finish('notification-1', 'winner', outcome), true);
  assert.equal(sqlite.prepare('SELECT provider_message_id FROM notification_outbox').get()?.provider_message_id, 'receipt-1');
  sqlite.exec("UPDATE notification_outbox SET status='sending',lease_token='stale',lease_expires_at='2026-10-22T17:00:00.000Z'");
  assert.equal(await store.recoverExpired(timestamp), 1);
  assert.equal(sqlite.prepare('SELECT status FROM notification_outbox').get()?.status, 'unknown');
  assert.deepEqual(await store.listDue(timestamp, 100), []);
});
