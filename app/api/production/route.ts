import {NextResponse} from 'next/server';
import {z} from 'zod';
import {db} from '@/lib/server';
import {sessionUser} from '@/lib/auth';
import {
  canOperateStation,
  loadStaffScope,
  productionWriteGuardSql,
  readBoundedRequestText,
  staffScopeSchema,
  type StaffScopeKey,
} from '@/lib/staff-access';
import {
  completeStation,
  markOrderReady,
  startStation,
  type ProductionOrder,
  type ProductionStation as Station,
} from '@/lib/production-flow';
import {
  createTicketFromOrder,
  parseProductionCommand,
  parseProductionPayload,
  parseProductionState,
  productionDataIssue,
  productionStateIssue,
  projectProductionTicket,
} from '@/lib/production-repository';

export const dynamic = 'force-dynamic';

const json = (body: unknown, status = 200) =>
  NextResponse.json(body, {status, headers: {'Cache-Control': 'no-store'}});

class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

type OrderRow = {
  id: string;
  organization_id: string;
  location_id: string;
  status: string;
  version: number;
  created_at: string;
  updated_at: string;
  slot: string;
  channel: string;
  fulfillment: string;
  note: string;
  items: string;
};

type TicketRow = {
  order_id: string;
  ticket_number: number;
  status: string;
  revision: number;
  ticket_payload: string;
  production_state: string;
  order_version: number;
};

async function requireOperator(request: Request) {
  const user = await sessionUser(request.headers.get('cookie'));
  if (!user) throw new ApiError(401, 'Connectez-vous avec un compte autorisé.');
  const query = new URL(request.url).searchParams;
  if (query.getAll('organizationId').length > 1 || query.getAll('locationId').length > 1) {
    throw new ApiError(400, 'Choisissez un seul établissement.');
  }
  const scope = staffScopeSchema.parse(query.has('organizationId') || query.has('locationId')
    ? {organizationId: query.get('organizationId'), locationId: query.get('locationId')}
    : {organizationId: 'dolce-pizza', locationId: 'ronchin'});
  const access = await loadStaffScope(db(), user.id, scope);
  if (!access) throw new ApiError(403, 'Votre compte n’a pas accès à cet établissement actif.');
  return {user, scope, access};
}

async function ensureTicket(order: OrderRow) {
  const ORGANIZATION_ID = order.organization_id;
  const LOCATION_ID = order.location_id;
  const existing = await db().prepare(
    'SELECT t.order_id,t.ticket_number,t.status,t.revision,t.ticket_payload,t.production_state,o.version AS order_version FROM production_tickets t JOIN orders o ON o.id=t.order_id WHERE t.order_id=? AND t.organization_id=? AND t.location_id=? AND o.organization_id=? AND o.location_id=?',
  ).bind(order.id, ORGANIZATION_ID, LOCATION_ID, ORGANIZATION_ID, LOCATION_ID).first<TicketRow>();
  if (existing || order.status !== 'preparing') return existing;

  const allocated = await db().prepare(
    'INSERT INTO production_ticket_sequences(organization_id,location_id,next_number) VALUES(?,?,2) ON CONFLICT(organization_id,location_id) DO UPDATE SET next_number=next_number+1 RETURNING next_number-1 AS ticket_number',
  ).bind(ORGANIZATION_ID, LOCATION_ID).first<{ticket_number: number}>();
  if (!allocated) throw new Error('Could not allocate a production ticket number');
  const initial = createTicketFromOrder(order);
  const now = new Date().toISOString();
  await db().prepare(
    "INSERT OR IGNORE INTO production_tickets(order_id,organization_id,location_id,ticket_number,status,revision,ticket_payload,production_state,last_command_id,created_at,updated_at) SELECT ?,?,?,?,'in_progress',0,?,?,NULL,?,? FROM orders WHERE id=? AND organization_id=? AND location_id=? AND status='preparing'",
  ).bind(order.id, ORGANIZATION_ID, LOCATION_ID, allocated.ticket_number, JSON.stringify(initial.payload), JSON.stringify(initial.flow), now, now, order.id, ORGANIZATION_ID, LOCATION_ID).run();
  return await db().prepare(
    'SELECT t.order_id,t.ticket_number,t.status,t.revision,t.ticket_payload,t.production_state,o.version AS order_version FROM production_tickets t JOIN orders o ON o.id=t.order_id WHERE t.order_id=? AND t.organization_id=? AND t.location_id=? AND o.organization_id=? AND o.location_id=?',
  ).bind(order.id, ORGANIZATION_ID, LOCATION_ID, ORGANIZATION_ID, LOCATION_ID).first<TicketRow>();
}

async function activeOrders(scope: StaffScopeKey): Promise<OrderRow[]> {
  const ORGANIZATION_ID = scope.organizationId;
  const LOCATION_ID = scope.locationId;
  const result = await db().prepare(
    "SELECT id,organization_id,location_id,status,version,created_at,updated_at,slot,channel,fulfillment,note,items FROM orders WHERE organization_id=? AND location_id=? AND (status='preparing' OR (status='ready' AND updated_at>?)) ORDER BY CASE WHEN status='preparing' THEN 0 ELSE 1 END,slot,created_at LIMIT 150",
  ).bind(ORGANIZATION_ID, LOCATION_ID, new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()).all<OrderRow>();
  return result.results;
}

export async function GET(request: Request) {
  try {
    const {scope, access} = await requireOperator(request);
    const requested = new URL(request.url).searchParams.get('station');
    const parsedStation = z.enum(['make_line', 'oven', 'expeditor']).safeParse(requested);
    if (!parsedStation.success) throw new ApiError(400, 'Choisissez un poste de production valide.');
    const station: Station = parsedStation.data;
    if (!canOperateStation(access, station, 'read')) throw new ApiError(403, 'Votre rôle ne permet pas de consulter ce poste.');
    const orders = await activeOrders(scope);
    const tickets = [];
    for (const order of orders) {
      const ticket = await ensureTicket(order);
      if (!ticket) continue;
      const flow = parseProductionState(ticket.production_state);
      const payload = parseProductionPayload(ticket.ticket_payload);
      if (productionStateIssue(order.id, payload, flow)) {
        throw new ApiError(503, 'Les articles du ticket ne correspondent plus à la commande. Demandez une vérification responsable.');
      }
      if (flow.status === 'cancelled' || flow.status === 'completed') continue;
      const projected = projectProductionTicket({
        orderId: order.id,
        ticketNumber: ticket.ticket_number,
        payload,
        flow,
        station,
      });
      if (projected) tickets.push(projected);
    }
    return json({orders: tickets, scope: access});
  } catch (error) {
    return handleError(error);
  }
}

export async function POST(request: Request) {
  try {
    const url = new URL(request.url);
    const origin = request.headers.get('origin');
    if (!origin || origin !== url.origin) throw new ApiError(403, 'Cette demande doit être envoyée depuis le site.');
    if (Number(request.headers.get('content-length') || 0) > 10000) throw new ApiError(413, 'La demande est trop volumineuse.');
    const {user, scope, access} = await requireOperator(request);
    const ORGANIZATION_ID = scope.organizationId;
    const LOCATION_ID = scope.locationId;
    const serialized = await readBoundedRequestText(request, 10000);
    let body: unknown;
    try {
      body = JSON.parse(serialized);
    } catch {
      throw new ApiError(400, 'La demande est illisible.');
    }
    const input = parseProductionCommand(body);
    if (!canOperateStation(access, input.station, input.action)) {
      throw new ApiError(403, 'Votre rôle ne permet pas cette action à ce poste.');
    }
    const order = await db().prepare(
      "SELECT id,organization_id,location_id,status,version,created_at,updated_at,slot,channel,fulfillment,note,items FROM orders WHERE id=? AND organization_id=? AND location_id=? AND status='preparing'",
    ).bind(input.orderId, ORGANIZATION_ID, LOCATION_ID).first<OrderRow>();
    if (!order) throw new ApiError(404, 'Commande active introuvable. Actualisez la liste.');
    const ticket = await ensureTicket(order);
    if (!ticket) throw new ApiError(409, 'Le ticket n’est plus en préparation. Actualisez la liste.');

    let current: ProductionOrder;
    try {
      current = parseProductionState(ticket.production_state);
    } catch {
      throw new ApiError(503, 'Le ticket doit être contrôlé avant de continuer.');
    }
    if (current.revision !== ticket.revision) throw new ApiError(503, 'Le ticket doit être contrôlé avant de continuer.');

    let payload;
    try {
      payload = parseProductionPayload(ticket.ticket_payload);
    } catch {
      throw new ApiError(503, 'La fiche de production doit être contrôlée avant de continuer.');
    }
    if (productionStateIssue(order.id, payload, current)) {
      throw new ApiError(503, 'Les articles du ticket ne correspondent plus à la commande. Demandez une vérification responsable.');
    }
    const dataIssue = productionDataIssue(payload, input.action === 'ready' ? undefined : input.itemId);
    if (dataIssue) {
      const message = dataIssue === 'item_snapshot_missing'
        ? 'La fiche de cet article est introuvable. Actualisez le ticket.'
        : dataIssue === 'routing_unverified'
          ? 'Le routage de cet article doit être confirmé dans la fiche menu.'
          : 'Les allergènes de cet article doivent être vérifiés dans la fiche menu.';
      throw new ApiError(409, message);
    }

    const command = {
      actorId: user.id,
      at: new Date().toISOString(),
      expectedRevision: input.expectedRevision,
    };
    const transitioned = input.action === 'ready'
      ? markOrderReady(current, command)
      : input.action === 'start'
        ? startStation(current, input.itemId, input.station, command)
        : completeStation(current, input.itemId, input.station, command);
    if (!transitioned.ok) {
      const latest = await currentTicketRevision(input.orderId, scope);
      const message = transitioned.error === 'revision_conflict'
        ? 'Le ticket a été modifié sur un autre poste. Actualisez la liste.'
        : transitionMessage(transitioned.error);
      return json({error: message, refresh: true, revision: latest}, 409);
    }

    const next = transitioned.order;
    const operationId = crypto.randomUUID();
    const event = next.events[next.events.length - 1];
    const eventType = event?.type || 'unknown';
    const stationEvent = event?.type === 'station_started' || event?.type === 'station_completed' ? event : null;
    const itemId = stationEvent?.itemId ?? null;
    const station = stationEvent?.station ?? null;
    const eventDetails = JSON.stringify({type: eventType});
    const now = new Date().toISOString();
    const ready = next.status === 'ready';

    const results = await db().batch([
      db().prepare(
        `UPDATE production_tickets SET status=?,revision=?,production_state=?,last_command_id=?,updated_at=? WHERE order_id=? AND organization_id=? AND location_id=? AND revision=? AND EXISTS(SELECT 1 FROM orders o WHERE o.id=production_tickets.order_id AND o.organization_id=? AND o.location_id=? AND o.status='preparing' AND o.version=?) AND ${productionWriteGuardSql}`,
      ).bind(next.status, next.revision, JSON.stringify(next), operationId, now, input.orderId, ORGANIZATION_ID, LOCATION_ID, input.expectedRevision, ORGANIZATION_ID, LOCATION_ID, order.version, LOCATION_ID, ORGANIZATION_ID, user.id, input.station),
      db().prepare(
        "UPDATE orders SET status='ready',version=version+1,updated_at=? WHERE id=? AND organization_id=? AND location_id=? AND status='preparing' AND version=? AND ?=1 AND EXISTS(SELECT 1 FROM production_tickets WHERE order_id=? AND last_command_id=? AND revision=?)",
      ).bind(now, input.orderId, ORGANIZATION_ID, LOCATION_ID, order.version, ready ? 1 : 0, input.orderId, operationId, next.revision),
      db().prepare(
        'INSERT INTO production_events(id,operation_id,order_id,organization_id,location_id,revision,event_type,actor_user_id,item_id,station,details,created_at) SELECT ?,?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM production_tickets WHERE order_id=? AND last_command_id=? AND revision=?)',
      ).bind(operationId, operationId, input.orderId, ORGANIZATION_ID, LOCATION_ID, next.revision, eventType, user.id, itemId, station, eventDetails, now, input.orderId, operationId, next.revision),
      db().prepare(
        "INSERT INTO events(id,order_id,status,actor,note,created_at) SELECT ?,id,'ready',?,'Commande prête',? FROM orders WHERE id=? AND organization_id=? AND location_id=? AND status='ready' AND ?=1 AND EXISTS(SELECT 1 FROM production_tickets WHERE order_id=? AND last_command_id=? AND revision=?)",
      ).bind(`${input.orderId}:production:${next.revision}`, user.id, now, input.orderId, ORGANIZATION_ID, LOCATION_ID, ready ? 1 : 0, input.orderId, operationId, next.revision),
      db().prepare(
        "INSERT INTO notification_outbox(id,operation_id,organization_id,location_id,order_id,event_type,payload,status,attempts,available_at,created_at,updated_at,sent_at) SELECT ?,?,?,?,?,'order_ready',?,'pending',0,?,?,?,NULL FROM orders WHERE id=? AND organization_id=? AND location_id=? AND status='ready' AND fulfillment='pickup' AND channel IN ('web','phone','pos','kiosk','counter') AND phone<>'' AND notification_phone<>'' AND notification_phone_basis IN ('account_otp','staff_confirmed') AND notification_phone_captured_at IS NOT NULL AND ?=1 AND EXISTS(SELECT 1 FROM production_tickets WHERE order_id=? AND last_command_id=? AND revision=?)",
      ).bind(`${operationId}:notification`, `${operationId}:notification`, ORGANIZATION_ID, LOCATION_ID, input.orderId, JSON.stringify({orderId: input.orderId, eventType: 'order_ready'}), now, now, now, input.orderId, ORGANIZATION_ID, LOCATION_ID, ready ? 1 : 0, input.orderId, operationId, next.revision),
    ]);
    if (!results[0].meta.changes) {
      const latest = await currentTicketRevision(input.orderId, scope);
      return json({error: 'Le ticket a été modifié sur un autre poste. Actualisez la liste.', refresh: true, revision: latest}, 409);
    }
    return json({ok: true, revision: next.revision, status: next.status, refresh: true});
  } catch (error) {
    return handleError(error);
  }
}

async function currentTicketRevision(orderId: string, scope: StaffScopeKey): Promise<number | null> {
  const row = await db().prepare(
    'SELECT revision FROM production_tickets WHERE order_id=? AND organization_id=? AND location_id=?',
  ).bind(orderId, scope.organizationId, scope.locationId).first<{revision: number}>();
  return row?.revision ?? null;
}

function transitionMessage(error: string): string {
  const messages: Record<string, string> = {
    incomplete_items: 'Des articles ne sont pas encore terminés par tous les postes.',
    station_out_of_order: 'Cet article doit passer par le poste précédent.',
    station_not_started: 'Démarrez cet article avant de le terminer.',
    station_already_started: 'Cet article est déjà en cours à ce poste.',
    station_already_completed: 'Cet article a déjà terminé ce poste.',
    station_not_in_route: 'Cet article ne passe pas par ce poste.',
    item_not_found: 'Cet article n’existe plus sur le ticket.',
    order_already_ready: 'Cette commande est déjà prête.',
  };
  return messages[error] || 'Cette action n’est pas valide pour l’état actuel du ticket.';
}

function handleError(error: unknown) {
  if (error instanceof RangeError) return json({error: 'La demande est trop volumineuse.'}, 413);
  if (error instanceof z.ZodError) return json({error: error.issues[0]?.message || 'Vérifiez les informations.'}, 400);
  if (error instanceof ApiError) return json({error: error.message}, error.status);
  console.error('Production API error', error instanceof Error ? error.message : 'unknown');
  return json({error: 'Le service de production est momentanément indisponible.'}, 503);
}
