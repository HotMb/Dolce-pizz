/** Transactional pickup notifications. No customer/provider content is logged by this module. */
export const READY_NOTIFICATION_BATCH = 5;
export const READY_NOTIFICATION_MAX_ATTEMPTS = 5;
export const READY_NOTIFICATION_LEASE_MS = 120_000;
export const READY_NOTIFICATION_TTL_MS = 2 * 60 * 60_000;
const PROVIDER_URL = 'https://api.brevo.com/v3/transactionalSMS/send';
const PROVIDER_TIMEOUT_MS = 12_000;
const DIRECT_CHANNELS = new Set(['web', 'phone', 'pos', 'kiosk', 'counter']);

export type ReadyDelivery = {
  id: string;
  attempts: number;
  organizationId: string;
  locationId: string;
  orderId: string;
  eventType: string;
  notificationCreatedAt: string;
  orderOrganizationId: string | null;
  orderLocationId: string | null;
  orderStatus: string;
  fulfillment: string;
  channel: string;
  phone: string;
  notificationPhone: string;
  notificationPhoneBasis: string;
  notificationPhoneCapturedAt: string | null;
  accountPhone: string | null;
  organizationStatus: string;
  locationStatus: string;
  countryCode: string;
  locationName: string | null;
  addressLine1: string | null;
  postalCode: string | null;
  locality: string | null;
  ticketStatus: string | null;
  ticketNumber: number | null;
  ticketOrganizationId: string | null;
  ticketLocationId: string | null;
};

export type DeliveryDecision =
  | {ok: true; recipient: string; content: string}
  | {ok: false; code: string};

export type SendOutcome =
  | {status: 'sent'; providerMessageId: string}
  | {status: 'retry'; code: string; retryAfterMs: number}
  | {status: 'failed' | 'unknown'; code: string};

export type FinalOutcome = {
  status: 'sent' | 'pending' | 'failed' | 'unknown' | 'skipped';
  errorCode: string | null;
  providerMessageId: string | null;
  availableAt: string;
  at: string;
};

export interface ReadyNotificationStore {
  recoverExpired(now: string): Promise<number>;
  listDue(now: string, limit: number): Promise<string[]>;
  claim(id: string, token: string, now: string, expiresAt: string): Promise<boolean>;
  /** Re-read all order, ticket, tenant and contact evidence immediately before the provider call. */
  delivery(id: string, token: string | null, now: string): Promise<ReadyDelivery | null>;
  finish(id: string, token: string, outcome: FinalOutcome): Promise<boolean>;
}

export type ReadyNotificationEnvironment = {
  NOTIFICATION_DISPATCH_SECRET?: string;
  BREVO_API_KEY?: string;
  SMS_SENDER?: string;
};

export function notificationPhone(raw: string): string | null {
  const match = /^(?:\+33|0033|0)([67]\d{8})$/.exec(raw.replace(/[\s.\-()]/g, ''));
  return match ? `+33${match[1]}` : null;
}

const smsText = (value: string | null, max: number): string | null => {
  if (!value || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) return null;
  const text = value.trim().replace(/\s+/g, ' ');
  return text ? text : null;
};

export function readyDeliveryDecision(row: ReadyDelivery, now: number): DeliveryDecision {
  if (row.eventType !== 'order_ready') return {ok: false, code: 'unsupported_event'};
  const notificationAt = Date.parse(row.notificationCreatedAt);
  if (!Number.isFinite(notificationAt) || new Date(notificationAt).toISOString() !== row.notificationCreatedAt
    || notificationAt > now || now - notificationAt > READY_NOTIFICATION_TTL_MS) {
    return {ok: false, code: 'notification_expired'};
  }
  if (!row.organizationId || !row.locationId || row.orderOrganizationId !== row.organizationId
    || row.orderLocationId !== row.locationId || row.ticketOrganizationId !== row.organizationId
    || row.ticketLocationId !== row.locationId) return {ok: false, code: 'scope_mismatch'};
  if (row.orderStatus !== 'ready' || row.ticketStatus !== 'ready') return {ok: false, code: 'order_not_ready'};
  if (row.organizationStatus !== 'active' || row.locationStatus !== 'active' || row.countryCode !== 'FR') {
    return {ok: false, code: 'location_inactive'};
  }
  if (row.fulfillment !== 'pickup' || !DIRECT_CHANNELS.has(row.channel)) return {ok: false, code: 'external_channel'};
  const recipient = notificationPhone(row.notificationPhone);
  const capturedAt = Date.parse(row.notificationPhoneCapturedAt || '');
  if (!recipient || recipient !== notificationPhone(row.phone)
    || !['account_otp', 'staff_confirmed'].includes(row.notificationPhoneBasis)
    || !Number.isFinite(capturedAt) || new Date(capturedAt).toISOString() !== row.notificationPhoneCapturedAt
    || capturedAt > now) return {ok: false, code: 'contact_unconfirmed'};
  if (row.notificationPhoneBasis === 'account_otp' && recipient !== notificationPhone(row.accountPhone || '')) {
    return {ok: false, code: 'contact_unconfirmed'};
  }
  const name = smsText(row.locationName, 70);
  const address = smsText(row.addressLine1, 120);
  const locality = smsText(row.locality, 70);
  if (!name || !address || !locality || !/^\d{5}$/.test(row.postalCode || '')
    || !Number.isSafeInteger(row.ticketNumber) || (row.ticketNumber || 0) < 1) {
    return {ok: false, code: 'location_unconfigured'};
  }
  return {ok: true, recipient,
    content: `${name} : votre commande n°${row.ticketNumber} est prête. Retrait au ${address}, ${row.postalCode} ${locality}.`};
}

export type SmsTransport = (url: string, init: RequestInit) => Promise<Response>;

/** A confirmed rate rejection is retried; an ambiguous result is never retried automatically. */
export async function sendReadySms(
  delivery: {recipient: string; content: string},
  environment: ReadyNotificationEnvironment,
  transport: SmsTransport = fetch,
): Promise<SendOutcome> {
  const apiKey = environment.BREVO_API_KEY?.trim();
  const sender = environment.SMS_SENDER || 'DolcePizz';
  if (!apiKey || !/^[A-Za-z][A-Za-z0-9 ]{0,10}$/.test(sender)) return {status: 'failed', code: 'provider_unconfigured'};
  try {
    const response = await transport(PROVIDER_URL, {
      method: 'POST', redirect: 'error',
      headers: {'api-key': apiKey, 'content-type': 'application/json', accept: 'application/json'},
      body: JSON.stringify({sender, recipient: delivery.recipient.slice(1), content: delivery.content,
        type: 'transactional', tag: 'order_ready', unicodeEnabled: true}),
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    });
    // Brevo documents HTTP 429 as rejecting requests above its rate limit. No request body is logged.
    if (response.status === 429) return {status: 'retry', code: 'provider_rate_limited', retryAfterMs: 60_000};
    if (response.status >= 500 || response.status === 408 || response.status === 425) {
      return {status: 'unknown', code: 'provider_outcome_unknown'};
    }
    if (response.status >= 400 && response.status < 500) return {status: 'failed', code: 'provider_rejected'};
    if (!response.ok) return {status: 'unknown', code: 'provider_outcome_unknown'};
    const data: unknown = await response.json();
    const id = data && typeof data === 'object' && 'messageId' in data ? data.messageId : null;
    const providerMessageId = typeof id === 'string' && /^[A-Za-z0-9_.:@<>-]{1,200}$/.test(id) ? id
      : typeof id === 'number' && Number.isSafeInteger(id) && id > 0 ? String(id) : null;
    if (!providerMessageId) return {status: 'unknown', code: 'provider_receipt_missing'};
    return {status: 'sent', providerMessageId};
  } catch {
    // Fetch can fail after the provider accepted the SMS. Retrying would risk billing/sending twice.
    return {status: 'unknown', code: 'provider_outcome_unknown'};
  }
}

export type DispatchCounts = {
  dryRun: boolean; examined: number; claimed: number; eligible: number; sent: number;
  skipped: number; failed: number; retry: number; unknown: number; recovered: number;
};

export async function dispatchReadyNotifications(options: {
  store: ReadyNotificationStore;
  environment: ReadyNotificationEnvironment;
  dryRun?: boolean;
  now?: () => number;
  token?: () => string;
  transport?: SmsTransport;
}): Promise<DispatchCounts> {
  const {store, environment, dryRun = false, now = Date.now, token = () => crypto.randomUUID(), transport} = options;
  const counts: DispatchCounts = {dryRun, examined: 0, claimed: 0, eligible: 0, sent: 0,
    skipped: 0, failed: 0, retry: 0, unknown: 0, recovered: 0};
  // No hosted or local simulation fallback. A dry run alone may inspect without provider credentials.
  if (!dryRun && (!environment.BREVO_API_KEY?.trim()
    || !/^[A-Za-z][A-Za-z0-9 ]{0,10}$/.test(environment.SMS_SENDER || 'DolcePizz'))) {
    throw new NotificationDispatchError(503, 'provider_unconfigured');
  }
  const started = new Date(now()).toISOString();
  if (!dryRun) counts.recovered = await store.recoverExpired(started);
  const ids = await store.listDue(started, READY_NOTIFICATION_BATCH);
  for (const id of ids.slice(0, READY_NOTIFICATION_BATCH)) {
    counts.examined++;
    const leaseToken = token();
    if (!dryRun) {
      const claimedAt = now();
      if (!await store.claim(id, leaseToken, new Date(claimedAt).toISOString(),
        new Date(claimedAt + READY_NOTIFICATION_LEASE_MS).toISOString())) continue;
      counts.claimed++;
    }
    const checkedAt = now();
    const row = await store.delivery(id, dryRun ? null : leaseToken, new Date(checkedAt).toISOString());
    const decision = row ? readyDeliveryDecision(row, checkedAt) : {ok: false as const, code: 'source_unavailable'};
    if (decision.ok) counts.eligible++;
    if (dryRun) {
      if (!decision.ok) counts.skipped++;
      continue;
    }
    let result: FinalOutcome;
    if (!decision.ok || !row) {
      counts.skipped++;
      result = {status: 'skipped', errorCode: decision.ok ? 'source_unavailable' : decision.code,
        providerMessageId: null, availableAt: new Date(now()).toISOString(), at: new Date(now()).toISOString()};
    } else {
      const outcome = await sendReadySms(decision, environment, transport);
      const at = now();
      if (outcome.status === 'sent') {
        counts.sent++;
        result = {status: 'sent', errorCode: null, providerMessageId: outcome.providerMessageId,
          availableAt: new Date(at).toISOString(), at: new Date(at).toISOString()};
      } else if (outcome.status === 'retry' && row.attempts < READY_NOTIFICATION_MAX_ATTEMPTS) {
        counts.retry++;
        const backoff = Math.min(3_600_000, outcome.retryAfterMs * 2 ** Math.max(0, row.attempts - 1));
        result = {status: 'pending', errorCode: outcome.code, providerMessageId: null,
          availableAt: new Date(at + backoff).toISOString(), at: new Date(at).toISOString()};
      } else {
        const status = outcome.status === 'retry' ? 'failed' : outcome.status;
        counts[status]++;
        result = {status, errorCode: outcome.status === 'retry' ? 'retry_exhausted' : outcome.code,
          providerMessageId: null, availableAt: new Date(at).toISOString(), at: new Date(at).toISOString()};
      }
    }
    if (!await store.finish(id, leaseToken, result)) {
      // If the receipt cannot be persisted, recovery converts the abandoned lease to unknown.
      throw new NotificationDispatchError(503, 'receipt_persistence_failed');
    }
  }
  return counts;
}

export class NotificationDispatchError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string) { super(code); this.status = status; this.code = code; }
}

export async function dispatchAuthorization(header: string | null, secret: string | undefined): Promise<boolean> {
  if (!secret || !/^[\x21-\x7e]{32,256}$/.test(secret)) return false;
  const candidate = /^Bearer ([\x21-\x7e]{1,256})$/.exec(header || '')?.[1] || '';
  const encoder = new TextEncoder();
  const digests = await Promise.all([secret, candidate].map(value => crypto.subtle.digest('SHA-256', encoder.encode(value))));
  const [left, right] = digests.map(value => new Uint8Array(value));
  let difference = 0;
  for (let i = 0; i < 32; i++) difference |= left[i] ^ right[i];
  return difference === 0;
}

const json = (body: unknown, status: number) => Response.json(body,
  {status, headers: {'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'}});

/** Pure handler for deployment wrappers and security tests. No session or cookie grants access. */
export async function handleReadyNotificationRequest(request: Request, dependencies: {
  environment: ReadyNotificationEnvironment;
  store: () => ReadyNotificationStore;
  now?: () => number;
  token?: () => string;
  transport?: SmsTransport;
}): Promise<Response> {
  if (request.method !== 'POST') return json({error: 'method_not_allowed'}, 405);
  if (!await dispatchAuthorization(request.headers.get('authorization'), dependencies.environment.NOTIFICATION_DISPATCH_SECRET)) {
    return json({error: 'unauthorized'}, 401);
  }
  if (new URL(request.url).search) return json({error: 'query_not_allowed'}, 400);
  if (!/^application\/json(?:\s*;.*)?$/i.test(request.headers.get('content-type') || '')) {
    return json({error: 'json_required'}, 415);
  }
  let dryRun = false;
  try {
    const reader = request.body?.getReader();
    let size = 0;
    let text = '';
    const decoder = new TextDecoder('utf-8', {fatal: true});
    if (reader) {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > 128) { await reader.cancel(); return json({error: 'body_too_large'}, 413); }
        text += decoder.decode(chunk.value, {stream: true});
      }
      text += decoder.decode();
    }
    const body: unknown = JSON.parse(text || '{}');
    if (!body || Array.isArray(body) || typeof body !== 'object'
      || Object.keys(body).some(key => key !== 'dryRun')
      || ('dryRun' in body && typeof body.dryRun !== 'boolean')) return json({error: 'invalid_body'}, 400);
    dryRun = 'dryRun' in body && body.dryRun === true;
  } catch { return json({error: 'invalid_body'}, 400); }
  try {
    const result = await dispatchReadyNotifications({...dependencies, store: dependencies.store(), dryRun});
    return json(result, 200);
  } catch (error) {
    return json({error: error instanceof NotificationDispatchError ? error.code : 'dispatch_unavailable'},
      error instanceof NotificationDispatchError ? error.status : 503);
  }
}

/** Parameterized SQL only; every join repeats organization and location scope. */
export function createD1ReadyNotificationStore(database: Pick<D1Database, 'prepare'>): ReadyNotificationStore {
  return {
    async recoverExpired(now) {
      const result = await database.prepare("UPDATE notification_outbox SET status='unknown',last_error_code='lease_expired',lease_token=NULL,lease_expires_at=NULL,updated_at=? WHERE status='sending' AND (lease_expires_at IS NULL OR lease_expires_at<=?)")
        .bind(now, now).run();
      return result.meta.changes;
    },
    async listDue(now, limit) {
      const result = await database.prepare("SELECT id FROM notification_outbox WHERE status='pending' AND event_type='order_ready' AND available_at<=? AND attempts<? ORDER BY available_at,created_at,id LIMIT ?")
        .bind(now, READY_NOTIFICATION_MAX_ATTEMPTS, Math.min(READY_NOTIFICATION_BATCH, Math.max(0, limit))).all<{id: string}>();
      return result.results.map(row => row.id);
    },
    async claim(id, token, now, expiresAt) {
      const row = await database.prepare("UPDATE notification_outbox SET status='sending',attempts=attempts+1,lease_token=?,lease_expires_at=?,last_error_code=NULL,updated_at=? WHERE id=? AND status='pending' AND event_type='order_ready' AND available_at<=? AND attempts<? RETURNING id")
        .bind(token, expiresAt, now, id, now, READY_NOTIFICATION_MAX_ATTEMPTS).first<{id: string}>();
      return !!row;
    },
    async delivery(id, token, now) {
      // A lease that expired during a stalled invocation may never authorize a provider call.
      const row = await database.prepare(`SELECT n.id,n.attempts,n.created_at AS notificationCreatedAt,n.organization_id AS organizationId,n.location_id AS locationId,n.order_id AS orderId,n.event_type AS eventType,
        o.organization_id AS orderOrganizationId,o.location_id AS orderLocationId,o.status AS orderStatus,o.fulfillment,o.channel,o.phone,
        o.notification_phone AS notificationPhone,o.notification_phone_basis AS notificationPhoneBasis,o.notification_phone_captured_at AS notificationPhoneCapturedAt,
        u.phone AS accountPhone,g.status AS organizationStatus,l.status AS locationStatus,l.country_code AS countryCode,
        l.name AS locationName,l.address_line1 AS addressLine1,l.postal_code AS postalCode,l.locality,
        t.status AS ticketStatus,t.ticket_number AS ticketNumber,t.organization_id AS ticketOrganizationId,t.location_id AS ticketLocationId
        FROM notification_outbox n
        LEFT JOIN orders o ON o.id=n.order_id AND o.organization_id=n.organization_id AND o.location_id=n.location_id
        LEFT JOIN users u ON u.id=o.user_id
        LEFT JOIN organizations g ON g.id=n.organization_id
        LEFT JOIN locations l ON l.id=n.location_id AND l.organization_id=n.organization_id
        LEFT JOIN production_tickets t ON t.order_id=n.order_id AND t.organization_id=n.organization_id AND t.location_id=n.location_id
        WHERE n.id=? AND ((? IS NULL AND n.status='pending') OR (n.status='sending' AND n.lease_token=? AND n.lease_expires_at>?))`)
        .bind(id, token, token, now).first<ReadyDelivery>();
      return row;
    },
    async finish(id, token, outcome) {
      const result = await database.prepare("UPDATE notification_outbox SET status=?,last_error_code=?,provider_message_id=?,available_at=?,updated_at=?,sent_at=?,lease_token=NULL,lease_expires_at=NULL WHERE id=? AND status='sending' AND lease_token=?")
        .bind(outcome.status, outcome.errorCode, outcome.providerMessageId, outcome.availableAt, outcome.at,
          outcome.status === 'sent' ? outcome.at : null, id, token).run();
      return result.meta.changes === 1;
    },
  };
}
