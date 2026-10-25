import {NextResponse} from 'next/server';
import {z} from 'zod';
import {db, ensureSeed, ingredientList, productList, settings} from '@/lib/server';
import {staffSessionUser} from '@/lib/auth';
import {allowedSlot, slots} from '@/lib/rules';
import {priceCart} from '@/lib/pricing';
import {snapshotPricedLines} from '@/lib/production-repository';
import {loadStaffScope} from '@/lib/staff-access';
import {confirmedOrderContact, hasStaffOrderAccess, staffOrderChannelAllowed, staffOrderInputSchema, staffOrderSqlGuard} from '@/lib/staff-orders';
import {readBoundedRequestText} from '@/lib/staff-access';

export const dynamic = 'force-dynamic';
const MAX_BODY_BYTES = 35_000;
const json = (data: unknown, status = 200) => NextResponse.json(data, {status, headers: {'Cache-Control': 'no-store'}});

class HttpError extends Error {
  constructor(public status: number, message: string) {super(message);}
}
function fail(status: number, message: string): never {throw new HttpError(status, message);}

type OrderActor = {id:string; phone:string; name:string; deviceRole?:string; deviceOrganizationId?:string; deviceLocationId?:string};
async function deviceTokenActor(request: Request): Promise<OrderActor | null> {
  const token = request.headers.get('authorization')?.match(/^Bearer ([0-9a-f]{64})$/)?.[1];
  if (!token) return null;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  const row = await db().prepare(`SELECT c.created_by,c.organization_id,c.location_id,d.role,u.phone,u.name
    FROM device_credentials c
    JOIN devices d ON d.organization_id=c.organization_id AND d.location_id=c.location_id AND d.id=c.device_id
    JOIN organizations o ON o.id=c.organization_id AND o.status='active'
    JOIN locations l ON l.organization_id=c.organization_id AND l.id=c.location_id AND l.status='active'
    JOIN users u ON u.id=c.created_by
    WHERE c.token_hash=? AND c.revoked_at IS NULL AND c.expires_at>? AND d.status='active'`)
    .bind(hash, Date.now()).first<{created_by:string;organization_id:string;location_id:string;role:string;phone:string;name:string}>();
  if (!row || !['kiosk','pos'].includes(row.role)) return null;
  await db().prepare('UPDATE device_credentials SET last_seen_at=? WHERE token_hash=? AND revoked_at IS NULL').bind(new Date().toISOString(), hash).run();
  return {id:row.created_by, phone:row.phone, name:row.name, deviceRole:row.role, deviceOrganizationId:row.organization_id, deviceLocationId:row.location_id};
}

async function authenticatedRequest(request: Request, url: URL, requireOrigin: boolean) {
  const origin = request.headers.get('origin');
  if ((requireOrigin && !origin) || (origin && origin !== url.origin)) fail(403, 'Cette demande doit être envoyée depuis le site.');
  const user = await staffSessionUser(request.headers.get('cookie'));
  const actor = user ? {id:user.id, phone:user.phone, name:user.name} : await deviceTokenActor(request);
  if (!actor) fail(401, 'Connectez-vous avec un compte de l’équipe ou un appareil borne autorisé.');
  await ensureSeed();
  return actor;
}

async function loadAuthorizedScope(organizationId: string, locationId: string, actor: OrderActor) {
  if (actor.deviceRole) {
    if (actor.deviceOrganizationId !== organizationId || actor.deviceLocationId !== locationId) fail(403, 'Cette borne n’est pas rattachée à cet établissement.');
    return null;
  }
  const principalId = actor.id;
  const scope = await loadStaffScope(db(), principalId, {organizationId, locationId});
  if (!scope || !hasStaffOrderAccess(scope.roles)) fail(403, 'Vous n’avez pas accès à la prise de commande de cet établissement.');
  return scope;
}

function parseJson(text: string): unknown {
  try {return JSON.parse(text);}
  catch {return fail(400, 'Vérifiez les informations envoyées.');}
}

async function getSlots(request: Request, url: URL) {
  const actor = await authenticatedRequest(request, url, false);
  const query = z.object({organizationId: z.string().min(1).max(128), locationId: z.string().min(1).max(128)}).strict()
    .safeParse(Object.fromEntries(url.searchParams.entries()));
  if (!query.success) fail(400, 'Sélectionnez un établissement valide.');
  await loadAuthorizedScope(query.data.organizationId, query.data.locationId, actor);

  const location = await db().prepare(
    `SELECT l.name,l.address_line1,l.postal_code,l.locality,l.phone
     FROM locations l JOIN organizations o ON o.id=l.organization_id
     WHERE l.organization_id=? AND l.id=? AND l.status='active' AND o.status='active' AND o.country_code='FR'`,
  ).bind(query.data.organizationId, query.data.locationId).first<{
    name: string; address_line1: string | null; postal_code: string | null; locality: string | null; phone: string | null;
  }>();
  if (!location) fail(503, 'Cet établissement ne peut pas encore recevoir de commandes.');

  let currentSettings: Awaited<ReturnType<typeof settings>>;
  try {currentSettings = await settings(query.data.organizationId,query.data.locationId);}
  catch {fail(503, 'Les horaires et créneaux ne sont pas configurés pour cette enseigne.');}
  const now = new Date().toISOString();
  const countRows = await db().prepare(
    "SELECT substr(slot,1,16)||':00.000Z' AS slot,COUNT(*) AS n FROM orders WHERE organization_id=? AND location_id=? AND status NOT IN ('rejected','cancelled') AND substr(slot,1,16)||':00.000Z'>? GROUP BY substr(slot,1,16)||':00.000Z'",
  ).bind(query.data.organizationId, query.data.locationId, now).all<{slot: string; n: number}>();
  const counts = Object.fromEntries(countRows.results.map(row => [row.slot, row.n]));
  return json({
    slots: slots(currentSettings, counts),
    location: {
      name: location.name,
      addressLine1: location.address_line1,
      postalCode: location.postal_code,
      locality: location.locality,
      phone: location.phone,
    },
  });
}

async function postOrder(request: Request, url: URL) {
  const actor = await authenticatedRequest(request, url, true);
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) fail(413, 'La demande est trop volumineuse.');
  let text: string;
  try {text = await readBoundedRequestText(request, MAX_BODY_BYTES);}
  catch (error) {if (error instanceof RangeError) fail(413, 'La demande est trop volumineuse.'); throw error;}
  const parsed = staffOrderInputSchema.safeParse(parseJson(text));
  if (!parsed.success) fail(400, 'Vérifiez les informations de la commande.');
  const input = parsed.data;
  const serviceMode = input.channel === 'pos' ? input.serviceMode : 'pickup';
  const tableLabel = serviceMode === 'dine_in' ? input.tableLabel.trim() : '';
  if (serviceMode === 'dine_in' && !/^[A-Za-zÀ-ÖØ-öø-ÿ0-9][A-Za-zÀ-ÖØ-öø-ÿ0-9 .#-]{0,29}$/.test(tableLabel)) fail(400, 'Indiquez une table valide pour une commande sur place.');
  const scope = await loadAuthorizedScope(input.organizationId, input.locationId, actor);
  if (actor.deviceRole && ((actor.deviceRole === 'kiosk' && input.channel !== 'kiosk') || (actor.deviceRole === 'pos' && input.channel !== 'pos'))) fail(403, actor.deviceRole === 'pos' ? 'Ce poste POS ne peut créer que des commandes POS mobile.' : 'Une borne ne peut créer que des commandes borne.');
  if (!actor.deviceRole && (!scope || !staffOrderChannelAllowed(scope.roles, input.channel))) fail(403, 'Votre rôle ne permet pas de saisir cette commande.');

  const previous = await db().prepare(
    'SELECT id,total,status,slot,location_id,channel FROM orders WHERE user_id=? AND idempotency=? AND organization_id=? AND location_id=? AND channel=?',
  ).bind(actor.id, input.key, input.organizationId, input.locationId, input.channel).first<{
    id: string; total: number; status: string; slot: string; location_id: string; channel: string;
  }>();
  if (previous) return json({order: orderResponse(previous)});

  let currentSettings: Awaited<ReturnType<typeof settings>>;
  try {currentSettings = await settings(input.organizationId,input.locationId);}
  catch {fail(503, 'Les horaires et créneaux ne sont pas configurés pour cette enseigne.');}
  if (input.channel === 'phone' && !input.slot) fail(400, 'Le centre d’appels doit choisir une heure de retrait.');
  const countRows = await db().prepare(
    "SELECT substr(slot,1,16)||':00.000Z' AS slot,COUNT(*) AS n FROM orders WHERE organization_id=? AND location_id=? AND status NOT IN ('rejected','cancelled') AND substr(slot,1,16)||':00.000Z'>? GROUP BY substr(slot,1,16)||':00.000Z'",
  ).bind(input.organizationId, input.locationId, new Date().toISOString()).all<{slot: string; n: number}>();
  const counts = Object.fromEntries(countRows.results.map(row => [row.slot, row.n]));
  const requestedSlot = input.slot ? new Date(Date.parse(input.slot)).toISOString() : null;
  const slot = requestedSlot || slots(currentSettings, counts)[0]?.iso;
  if (!slot) fail(409, 'Aucun créneau opérationnel n’est disponible pour cette commande.');
  const slotMs = Date.parse(slot);
  if (!currentSettings.hoursConfirmed || !allowedSlot(slotMs, currentSettings)) {
    fail(409, 'Ce créneau de retrait n’est plus disponible. Choisissez un autre horaire.');
  }
  const [products, ingredients] = await Promise.all([productList(false, input.organizationId, input.locationId), ingredientList(input.organizationId)]);
  // Offers use the same server-owned product flags and calculation as web orders. Loyalty is never applied here.
  const priced = priceCart(input.items, {
    products,
    ingredients,
    extraPrice: currentSettings.extraPrice,
  });
  if (priced.problem) fail(409, priced.problem);
  if (priced.count > 30) fail(400, 'Pour plus de 30 articles, appelez la pizzeria.');
  const latestSettings = await settings(input.organizationId,input.locationId);
  if (latestSettings.version !== currentSettings.version || !latestSettings.hoursConfirmed || !allowedSlot(slotMs, latestSettings)) {
    fail(409, 'La carte ou ce créneau vient de changer. Actualisez les disponibilités et réessayez.');
  }
  const items = snapshotPricedLines(priced.lines, products, ingredients);
  const contact = confirmedOrderContact(input);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const sqlGuard = staffOrderSqlGuard(input.channel);
  const insert = db().prepare(
    `INSERT INTO orders(
      id,user_id,idempotency,name,phone,email,items,note,slot,subtotal,offer_discount,discount,total,redeemed,earned,
      status,reason,organization_id,location_id,channel,fulfillment,service_mode,table_label,payment_status,payment_method,
      notification_phone,notification_phone_basis,notification_phone_captured_at,created_at,updated_at,version
    )
    SELECT ?,?,?,?,?,'',?,?,?,?,?,0,?,0,0,'preparing','',?,?,?,'pickup',?,?,'due_at_pickup',NULL,?,?,?,?,?,1
    WHERE ${sqlGuard}
      AND COALESCE((SELECT version FROM location_config WHERE organization_id=? AND location_id=?),(SELECT version FROM config WHERE organization_id=?))=?
      AND (SELECT COUNT(*) FROM orders WHERE organization_id=? AND location_id=? AND substr(slot,1,16)||':00.000Z'=? AND status NOT IN ('rejected','cancelled')) < ?
    ON CONFLICT(organization_id,location_id,user_id,idempotency) DO NOTHING`,
    ).bind(
    id, actor.id, input.key, input.customerName, contact.phone, JSON.stringify(items), input.note, slot,
    priced.subtotal, priced.offer, priced.total,
    input.organizationId, input.locationId, input.channel, serviceMode, tableLabel, contact.notificationPhone, contact.basis, contact.capturedAt, now, now,
    input.organizationId, input.locationId, input.organizationId, actor.id, input.locationId,
    input.organizationId, input.locationId, input.organizationId, latestSettings.version, input.organizationId, input.locationId, slot, latestSettings.capacity,
  );
  const event = db().prepare(
    `INSERT INTO events(id,order_id,status,actor,note,created_at)
     SELECT ?,id,'preparing',?,'Commande équipe enregistrée',? FROM orders
     WHERE id=? AND user_id=? AND idempotency=? AND organization_id=? AND location_id=? AND channel=?`,
  ).bind(`${id}:1`, actor.id, now, id, actor.id, input.key, input.organizationId, input.locationId, input.channel);
  const printJob = db().prepare(
    `INSERT OR IGNORE INTO print_outbox(id,operation_id,organization_id,location_id,order_id,job_type,payload,status,attempts,available_at,created_at,updated_at)
     SELECT ?,?,?,?,id,'kitchen_ticket',?,'pending',0,?,?,? FROM orders
     WHERE id=? AND organization_id=? AND location_id=? AND status='preparing'`,
  ).bind(`${id}:print:kitchen`, `${id}:print:kitchen`, input.organizationId, input.locationId,
    JSON.stringify({orderId: id, format: 'ticket-v1'}), now, now, now, id, input.organizationId, input.locationId);
  const receiptJob = db().prepare(
    `INSERT OR IGNORE INTO print_outbox(id,operation_id,organization_id,location_id,order_id,job_type,payload,status,attempts,available_at,created_at,updated_at)
     SELECT ?,?,?,?,id,'customer_receipt',?,'pending',0,?,?,? FROM orders
     WHERE id=? AND organization_id=? AND location_id=? AND status='preparing' AND notification_phone=''`,
  ).bind(`${id}:print:receipt`, `${id}:print:receipt`, input.organizationId, input.locationId,
    JSON.stringify({orderId: id, format: 'receipt-v1'}), now, now, now, id, input.organizationId, input.locationId);
  const result = await db().batch([insert, event, printJob, receiptJob]);
  if (!result[0]?.meta.changes) {
    const duplicate = await db().prepare(
      'SELECT id,total,status,slot,location_id,channel FROM orders WHERE user_id=? AND idempotency=? AND organization_id=? AND location_id=? AND channel=?',
    ).bind(actor.id, input.key, input.organizationId, input.locationId, input.channel).first<{
      id: string; total: number; status: string; slot: string; location_id: string; channel: string;
    }>();
    if (duplicate) return json({order: orderResponse(duplicate)});
    if (actor.deviceRole) fail(409, 'Le poste a déjà enregistré cette commande ou le créneau est complet.');
    const stillAuthorized = await loadStaffScope(db(), actor.id, {organizationId: input.organizationId, locationId: input.locationId});
    if (!stillAuthorized || !staffOrderChannelAllowed(stillAuthorized.roles, input.channel)) fail(403, 'Votre accès à cet établissement a changé. Actualisez votre session.');
    fail(409, 'Le créneau est complet ou la configuration a changé. Actualisez les disponibilités et réessayez.');
  }
  return json({order: {id, total: priced.total, status: 'preparing', slot, locationId: input.locationId, channel: input.channel}}, 201);
}

async function patchOrder(request: Request, url: URL) {
  const actor = await authenticatedRequest(request, url, true);
  if (actor.deviceRole) fail(403, 'Le transfert de table nécessite une session équipe.');
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (Number.isFinite(contentLength) && contentLength > 4000) fail(413, 'La demande est trop volumineuse.');
  let text: string;
  try {text = await readBoundedRequestText(request, 4000);} catch (error) {if (error instanceof RangeError) fail(413, 'La demande est trop volumineuse.'); throw error;}
  const parsed = z.object({
    organizationId: z.string().min(1).max(128), locationId: z.string().min(1).max(128),
    orderId: z.string().min(1).max(128), tableLabel: z.string().trim().min(1).max(30), version: z.number().int().nonnegative(),
  }).strict().safeParse(parseJson(text));
  if (!parsed.success) fail(400, 'Indiquez une table et une version valides.');
  const input = parsed.data;
  if (!/^[A-Za-zÀ-ÖØ-öø-ÿ0-9][A-Za-zÀ-ÖØ-öø-ÿ0-9 .#-]{0,29}$/.test(input.tableLabel)) fail(400, 'Indiquez une table valide.');
  const scope = await loadAuthorizedScope(input.organizationId, input.locationId, actor);
  if (!scope || !scope.roles.some(role => ['owner', 'manager', 'pos'].includes(role))) fail(403, 'Votre rôle ne permet pas de transférer une table.');
  const now = new Date().toISOString();
  const update = db().prepare(
    `UPDATE orders SET table_label=?,version=version+1,updated_at=?
     WHERE id=? AND organization_id=? AND location_id=? AND service_mode='dine_in'
       AND status IN ('preparing','ready') AND version=? AND table_label<>?`,
  ).bind(input.tableLabel, now, input.orderId, input.organizationId, input.locationId, input.version, input.tableLabel);
  const event = db().prepare(
    `INSERT INTO events(id,order_id,status,actor,note,created_at)
     SELECT ?,id,status,?,? ,? FROM orders
     WHERE id=? AND organization_id=? AND location_id=? AND version=? AND table_label=?`,
  ).bind(`${input.orderId}:table:${input.version + 1}`, actor.id, `Commande transférée vers la table ${input.tableLabel}`, now, input.orderId, input.organizationId, input.locationId, input.version + 1, input.tableLabel);
  const result = await db().batch([update, event]);
  if (!result[0]?.meta.changes) {
    const current = await db().prepare('SELECT status,service_mode,table_label,version FROM orders WHERE id=? AND organization_id=? AND location_id=?').bind(input.orderId, input.organizationId, input.locationId).first<{status:string;service_mode:string;table_label:string;version:number}>();
    if (!current) fail(404, 'Commande introuvable dans cet établissement.');
    if (current.service_mode !== 'dine_in' || !['preparing','ready'].includes(current.status)) fail(409, 'Cette commande ne peut plus être transférée.');
    fail(409, 'La commande a changé. Rechargez-la avant de transférer la table.');
  }
  return json({order: {id: input.orderId, serviceMode: 'dine_in', tableLabel: input.tableLabel, version: input.version + 1}});
}

function orderResponse(order: {id: string; total: number; status: string; slot: string; location_id: string; channel: string}) {
  return {id: order.id, total: order.total, status: order.status, slot: order.slot, locationId: order.location_id, channel: order.channel};
}

async function handler(request: Request) {
  try {
    const url = new URL(request.url);
    if (request.method === 'GET') return await getSlots(request, url);
    if (request.method === 'POST') return await postOrder(request, url);
    if (request.method === 'PATCH') return await patchOrder(request, url);
    return json({error: 'Méthode non autorisée.'}, 405);
  } catch (error) {
    if (error instanceof HttpError) return json({error: error.message}, error.status);
    if (error instanceof z.ZodError) return json({error: 'Vérifiez les informations envoyées.'}, 400);
    console.error('Staff order request failed:', error instanceof Error ? error.message : 'unknown error');
    return json({error: 'La prise de commande est momentanément indisponible.'}, 500);
  }
}

export const GET = handler;
export const POST = handler;
export const PATCH = handler;
