import {NextResponse} from 'next/server';
import {z} from 'zod';
import {db, ensureSeed, ingredientList, productList, settings} from '@/lib/server';
import {sessionUser, normalizePhone} from '@/lib/auth';
import {allowedSlot, slots} from '@/lib/rules';
import {priceCart} from '@/lib/pricing';
import {snapshotPricedLines} from '@/lib/production-repository';
import {loadStaffScope} from '@/lib/staff-access';
import {hasStaffOrderAccess, staffOrderChannelAllowed, staffOrderInputSchema, staffOrderSqlGuard} from '@/lib/staff-orders';
import {readBoundedRequestText} from '@/lib/staff-access';

export const dynamic = 'force-dynamic';
const MAX_BODY_BYTES = 35_000;
const json = (data: unknown, status = 200) => NextResponse.json(data, {status, headers: {'Cache-Control': 'no-store'}});

class HttpError extends Error {
  constructor(public status: number, message: string) {super(message);}
}
function fail(status: number, message: string): never {throw new HttpError(status, message);}

async function authenticatedRequest(request: Request, url: URL, requireOrigin: boolean) {
  const origin = request.headers.get('origin');
  if ((requireOrigin && !origin) || (origin && origin !== url.origin)) fail(403, 'Cette demande doit être envoyée depuis le site.');
  const user = await sessionUser(request.headers.get('cookie'));
  if (!user) fail(401, 'Connectez-vous avec un compte de l’équipe.');
  await ensureSeed();
  return user;
}

async function loadAuthorizedScope(organizationId: string, locationId: string, principalId: string) {
  const scope = await loadStaffScope(db(), principalId, {organizationId, locationId});
  if (!scope || !hasStaffOrderAccess(scope.roles)) fail(403, 'Vous n’avez pas accès à la prise de commande de cet établissement.');
  return scope;
}

function parseJson(text: string): unknown {
  try {return JSON.parse(text);}
  catch {return fail(400, 'Vérifiez les informations envoyées.');}
}

async function getSlots(request: Request, url: URL) {
  const user = await authenticatedRequest(request, url, false);
  const query = z.object({organizationId: z.string().min(1).max(128), locationId: z.string().min(1).max(128)}).strict()
    .safeParse(Object.fromEntries(url.searchParams.entries()));
  if (!query.success) fail(400, 'Sélectionnez un établissement valide.');
  await loadAuthorizedScope(query.data.organizationId, query.data.locationId, user.id);

  const location = await db().prepare(
    `SELECT l.name,l.address_line1,l.postal_code,l.locality,l.phone
     FROM locations l JOIN organizations o ON o.id=l.organization_id
     WHERE l.organization_id=? AND l.id=? AND l.status='active' AND o.status='active' AND o.country_code='FR'`,
  ).bind(query.data.organizationId, query.data.locationId).first<{
    name: string; address_line1: string | null; postal_code: string | null; locality: string | null; phone: string | null;
  }>();
  if (!location) fail(503, 'Cet établissement ne peut pas encore recevoir de commandes.');

  let currentSettings: Awaited<ReturnType<typeof settings>>;
  try {currentSettings = await settings(query.data.organizationId);}
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
  const user = await authenticatedRequest(request, url, true);
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) fail(413, 'La demande est trop volumineuse.');
  let text: string;
  try {text = await readBoundedRequestText(request, MAX_BODY_BYTES);}
  catch (error) {if (error instanceof RangeError) fail(413, 'La demande est trop volumineuse.'); throw error;}
  const parsed = staffOrderInputSchema.safeParse(parseJson(text));
  if (!parsed.success) fail(400, 'Vérifiez les informations de la commande.');
  const input = parsed.data;
  const scope = await loadAuthorizedScope(input.organizationId, input.locationId, user.id);
  if (!staffOrderChannelAllowed(scope.roles, input.channel)) fail(403, 'Votre rôle ne permet pas de saisir cette commande.');

  const previous = await db().prepare(
    'SELECT id,total,status,slot,location_id,channel FROM orders WHERE user_id=? AND idempotency=? AND organization_id=? AND location_id=? AND channel=?',
  ).bind(user.id, input.key, input.organizationId, input.locationId, input.channel).first<{
    id: string; total: number; status: string; slot: string; location_id: string; channel: string;
  }>();
  if (previous) return json({order: orderResponse(previous)});

  let currentSettings: Awaited<ReturnType<typeof settings>>;
  try {currentSettings = await settings(input.organizationId);}
  catch {fail(503, 'Les horaires et créneaux ne sont pas configurés pour cette enseigne.');}
  const slot = new Date(Date.parse(input.slot)).toISOString();
  const slotMs = Date.parse(slot);
  if (!currentSettings.hoursConfirmed || !allowedSlot(slotMs, currentSettings)) {
    fail(409, 'Ce créneau de retrait n’est plus disponible. Choisissez un autre horaire.');
  }
  const [products, ingredients] = await Promise.all([productList(false, input.organizationId), ingredientList(input.organizationId)]);
  // Offers use the same server-owned product flags and calculation as web orders. Loyalty is never applied here.
  const priced = priceCart(input.items, {
    products,
    ingredients,
    extraPrice: currentSettings.extraPrice,
  });
  if (priced.problem) fail(409, priced.problem);
  if (priced.count > 30) fail(400, 'Pour plus de 30 articles, appelez la pizzeria.');
  const latestSettings = await settings(input.organizationId);
  if (latestSettings.version !== currentSettings.version || !latestSettings.hoursConfirmed || !allowedSlot(slotMs, latestSettings)) {
    fail(409, 'La carte ou ce créneau vient de changer. Actualisez les disponibilités et réessayez.');
  }
  const items = snapshotPricedLines(priced.lines, products, ingredients);
  const normalizedPhone = input.customerPhone ? normalizePhone(input.customerPhone) : null;
  const contactConfirmed = !!normalizedPhone && input.readySmsConfirmed;
  const storedPhone = contactConfirmed ? `0${normalizedPhone!.slice(3)}` : '';
  const notificationPhone = contactConfirmed ? normalizedPhone! : '';
  const contactBasis = contactConfirmed ? 'staff_confirmed' : 'none';
  const contactCapturedAt = contactConfirmed ? new Date().toISOString() : null;
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const sqlGuard = staffOrderSqlGuard(input.channel);
  const insert = db().prepare(
    `INSERT INTO orders(
      id,user_id,idempotency,name,phone,email,items,note,slot,subtotal,offer_discount,discount,total,redeemed,earned,
      status,reason,organization_id,location_id,channel,fulfillment,payment_status,payment_method,
      notification_phone,notification_phone_basis,notification_phone_captured_at,created_at,updated_at,version
    )
    SELECT ?,?,?,?,?,'',?,?,?,?,?,0,?,0,0,'preparing','',?,?,?,'pickup','due_at_pickup',NULL,?,?,?,?,?,1
    WHERE ${sqlGuard}
      AND (SELECT version FROM config WHERE organization_id=?)=?
      AND (SELECT COUNT(*) FROM orders WHERE organization_id=? AND location_id=? AND substr(slot,1,16)||':00.000Z'=? AND status NOT IN ('rejected','cancelled')) < ?
    ON CONFLICT(organization_id,location_id,user_id,idempotency) DO NOTHING`,
  ).bind(
    id, user.id, input.key, input.customerName, storedPhone, JSON.stringify(items), input.note, slot,
    priced.subtotal, priced.offer, priced.total,
    input.organizationId, input.locationId, input.channel, notificationPhone, contactBasis, contactCapturedAt, now, now,
    input.organizationId, input.locationId, input.organizationId, user.id, input.locationId,
    input.organizationId, latestSettings.version, input.organizationId, input.locationId, slot, latestSettings.capacity,
  );
  const event = db().prepare(
    `INSERT INTO events(id,order_id,status,actor,note,created_at)
     SELECT ?,id,'preparing',?,'Commande équipe enregistrée',? FROM orders
     WHERE id=? AND user_id=? AND idempotency=? AND organization_id=? AND location_id=? AND channel=?`,
  ).bind(`${id}:1`, user.id, now, id, user.id, input.key, input.organizationId, input.locationId, input.channel);
  const printJob = db().prepare(
    `INSERT OR IGNORE INTO print_outbox(id,operation_id,organization_id,location_id,order_id,job_type,payload,status,attempts,available_at,created_at,updated_at)
     SELECT ?,?,?,?,id,'kitchen_ticket',?,'pending',0,?,?,? FROM orders
     WHERE id=? AND organization_id=? AND location_id=? AND status='preparing'`,
  ).bind(`${id}:print:kitchen`, `${id}:print:kitchen`, input.organizationId, input.locationId,
    JSON.stringify({orderId: id, format: 'ticket-v1'}), now, now, now, id, input.organizationId, input.locationId);
  const result = await db().batch([insert, event, printJob]);
  if (!result[0]?.meta.changes) {
    const duplicate = await db().prepare(
      'SELECT id,total,status,slot,location_id,channel FROM orders WHERE user_id=? AND idempotency=? AND organization_id=? AND location_id=? AND channel=?',
    ).bind(user.id, input.key, input.organizationId, input.locationId, input.channel).first<{
      id: string; total: number; status: string; slot: string; location_id: string; channel: string;
    }>();
    if (duplicate) return json({order: orderResponse(duplicate)});
    const stillAuthorized = await loadStaffScope(db(), user.id, {organizationId: input.organizationId, locationId: input.locationId});
    if (!stillAuthorized || !staffOrderChannelAllowed(stillAuthorized.roles, input.channel)) fail(403, 'Votre accès à cet établissement a changé. Actualisez votre session.');
    fail(409, 'Le créneau est complet ou la configuration a changé. Actualisez les disponibilités et réessayez.');
  }
  return json({order: {id, total: priced.total, status: 'preparing', slot, locationId: input.locationId, channel: input.channel}}, 201);
}

function orderResponse(order: {id: string; total: number; status: string; slot: string; location_id: string; channel: string}) {
  return {id: order.id, total: order.total, status: order.status, slot: order.slot, locationId: order.location_id, channel: order.channel};
}

async function handler(request: Request) {
  try {
    const url = new URL(request.url);
    if (request.method === 'GET') return await getSlots(request, url);
    if (request.method === 'POST') return await postOrder(request, url);
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
