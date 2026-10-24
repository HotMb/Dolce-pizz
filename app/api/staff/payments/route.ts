import {NextResponse} from 'next/server';
import {z} from 'zod';
import {db, ensureSeed} from '@/lib/server';
import {sessionUser} from '@/lib/auth';
import {loadStaffScope, readBoundedRequestText, type StaffScopeKey} from '@/lib/staff-access';

export const dynamic = 'force-dynamic';

const json = (body: unknown, status = 200) =>
  NextResponse.json(body, {status, headers: {'Cache-Control': 'no-store'}});

class ApiError extends Error {
  constructor(public status: number, message: string) {super(message);}
}

const paymentInput = z.object({
  organizationId: z.string().min(1).max(128),
  locationId: z.string().min(1).max(128),
  orderId: z.string().min(1).max(128),
  idempotencyKey: z.string().uuid(),
  amount: z.number().int().min(1).max(100000),
  allocations: z.array(z.object({lineIndex: z.number().int().min(0).max(59), amount: z.number().int().min(1).max(100000)}).strict()).max(60).default([]),
  method: z.enum(['cash', 'card']),
}).strict();

type PaymentRow = {
  id: string;
  organization_id: string;
  location_id: string;
  order_id: string;
  idempotency_key: string;
  amount: number;
  allocation: string;
  method: 'cash' | 'card';
  status: string;
};
type ShiftRow = {id: string; business_date: string; opening_float: number; opened_at: string};

function paymentResponse(payment: PaymentRow, orderStatus: string, paymentStatus: string, paidTotal: number, total: number) {
  return {
    payment: {
      id: payment.id,
      orderId: payment.order_id,
      amount: payment.amount,
      method: payment.method,
      status: payment.status,
    },
    order: {id: payment.order_id, status: orderStatus, paymentStatus, paidTotal, remaining: Math.max(0, total - paidTotal)},
  };
}

async function requireCashier(request: Request, scope: StaffScopeKey, requireOrigin: boolean) {
  const origin = request.headers.get('origin');
  const url = new URL(request.url);
  if (requireOrigin && (!origin || origin !== url.origin)) throw new ApiError(403, 'Cette demande doit être envoyée depuis le site.');
  const user = await sessionUser(request.headers.get('cookie'));
  if (!user) throw new ApiError(401, 'Connectez-vous avec un compte autorisé.');
  await ensureSeed();
  const access = await loadStaffScope(db(), user.id, scope);
  if (!access || !access.roles.some(role => role === 'owner' || role === 'manager' || role === 'pos')) {
    throw new ApiError(403, 'Votre rôle ne permet pas d’encaisser une commande.');
  }
  return user;
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const scope = z.object({organizationId: z.string().min(1).max(128), locationId: z.string().min(1).max(128)}).strict()
      .safeParse({organizationId: url.searchParams.get('organizationId'), locationId: url.searchParams.get('locationId')});
    if (!scope.success) throw new ApiError(400, 'Choisissez un établissement valide.');
    await requireCashier(request, scope.data, false);
    const requestedOrderId = url.searchParams.get('orderId')?.trim() || '';
    if (requestedOrderId) {
      if (requestedOrderId.length > 128) throw new ApiError(400, 'Cette commande est invalide.');
      const order = await db().prepare(
        `SELECT id,name,total,paid_total,status,payment_status,service_mode,table_label,items
         FROM orders WHERE id=? AND organization_id=? AND location_id=? AND fulfillment='pickup'`,
      ).bind(requestedOrderId, scope.data.organizationId, scope.data.locationId).first<{
        id:string; name:string; total:number; paid_total:number; status:string; payment_status:string; service_mode:string; table_label:string; items:string;
      }>();
      if (!order) throw new ApiError(404, 'Commande introuvable dans cet établissement.');
      let rawItems: unknown = [];
      try {rawItems = JSON.parse(order.items);} catch {rawItems = [];}
      const items = Array.isArray(rawItems) ? rawItems.slice(0, 60).map((item: any) => ({
        name: typeof item?.name === 'string' ? item.name.slice(0, 120) : 'Article à vérifier',
        quantity: Number.isInteger(item?.quantity) ? Math.max(1, Math.min(20, item.quantity)) : 1,
        unitPrice: Number.isInteger(item?.unitPrice) ? Math.max(0, item.unitPrice) : 0,
        total: Number.isInteger(item?.total) ? Math.max(0, item.total) : 0,
        size: typeof item?.size === 'string' ? item.size.slice(0, 20) : '',
        option: typeof item?.option === 'string' ? item.option.slice(0, 80) : '',
        without: Array.isArray(item?.without) ? item.without.slice(0, 20).map((value: unknown) => String(value).slice(0, 80)) : [],
        extra: Array.isArray(item?.extra) ? item.extra.slice(0, 20).map((value: unknown) => String(value).slice(0, 80)) : [],
      })) : [];
      const prior = await db().prepare('SELECT allocation FROM payments WHERE order_id=? AND organization_id=? AND location_id=? AND status=\'captured\'').bind(order.id, scope.data.organizationId, scope.data.locationId).all<{allocation:string}>();
      const allocated = new Map<number, number>();
      for (const row of prior.results) {try {const saved = JSON.parse(row.allocation); if (Array.isArray(saved)) for (const entry of saved) if (Number.isInteger(entry?.lineIndex)&&Number.isInteger(entry?.amount)) allocated.set(entry.lineIndex,(allocated.get(entry.lineIndex)||0)+entry.amount);} catch {}}
      const detailedItems = items.map((item, lineIndex) => ({...item, lineIndex, paidTotal: allocated.get(lineIndex)||0, remaining: Math.max(0, item.total-(allocated.get(lineIndex)||0))}));
      return json({addition: {id: order.id, name: order.name, total: order.total, paidTotal: order.paid_total, remaining: Math.max(0, order.total - order.paid_total), status: order.status, paymentStatus: order.payment_status, serviceMode: order.service_mode, tableLabel: order.table_label, items: detailedItems}, scope: scope.data});
    }
    const shift = await db().prepare(
      `SELECT id,business_date,opening_float,opened_at FROM cash_shifts
       WHERE organization_id=? AND location_id=? AND status='open'`,
    ).bind(scope.data.organizationId, scope.data.locationId).first<ShiftRow>();
    const rows = await db().prepare(
       `SELECT id,name,total,paid_total,slot,channel,service_mode,table_label,updated_at,created_at
       FROM orders
       WHERE organization_id=? AND location_id=? AND fulfillment='pickup' AND status='ready' AND payment_status IN ('due_at_pickup','partially_paid')
       ORDER BY slot,created_at
       LIMIT 150`,
    ).bind(scope.data.organizationId, scope.data.locationId).all<{
      id: string; name: string; total: number; paid_total: number; slot: string; channel: string; service_mode: string; table_label: string; updated_at: string; created_at: string;
    }>();
    const totals = shift ? await db().prepare(
      `SELECT
        COALESCE((SELECT SUM(CASE WHEN e.method='cash' THEN e.amount ELSE 0 END) FROM cash_shift_entries e WHERE e.organization_id=? AND e.location_id=? AND e.shift_id=?),0)+COALESCE((SELECT SUM(CASE WHEN a.method='cash' THEN a.amount ELSE 0 END) FROM cash_shift_adjustments a WHERE a.organization_id=? AND a.location_id=? AND a.shift_id=?),0) AS cash_sales,
        COALESCE((SELECT SUM(CASE WHEN e.method='card' THEN e.amount ELSE 0 END) FROM cash_shift_entries e WHERE e.organization_id=? AND e.location_id=? AND e.shift_id=?),0)+COALESCE((SELECT SUM(CASE WHEN a.method='card' THEN a.amount ELSE 0 END) FROM cash_shift_adjustments a WHERE a.organization_id=? AND a.location_id=? AND a.shift_id=?),0) AS card_sales,
        (SELECT COUNT(*) FROM cash_shift_entries e WHERE e.organization_id=? AND e.location_id=? AND e.shift_id=?) AS payment_count`,
    ).bind(scope.data.organizationId,scope.data.locationId,shift.id,scope.data.organizationId,scope.data.locationId,shift.id,scope.data.organizationId,scope.data.locationId,shift.id,scope.data.organizationId,scope.data.locationId,shift.id,scope.data.organizationId,scope.data.locationId,shift.id).first<{cash_sales: number; card_sales: number; payment_count: number}>() : null;
    return json({shift: shift ? {id: shift.id, businessDate: shift.business_date, openingFloat: shift.opening_float, openedAt: shift.opened_at, cashSales: totals?.cash_sales||0, cardSales: totals?.card_sales||0, paymentCount: totals?.payment_count||0, expectedCash: shift.opening_float + (totals?.cash_sales||0)} : null, orders: rows.results.map(row => ({
      id: row.id,
      label: row.id.slice(0, 6).toUpperCase(),
      name: row.name,
      total: row.total,
      slot: row.slot,
      channel: row.channel,
      serviceMode: row.service_mode,
      tableLabel: row.table_label,
      paidTotal: row.paid_total,
      remaining: Math.max(0, row.total - row.paid_total),
      readyAt: row.updated_at,
      createdAt: row.created_at,
    })), scope: scope.data});
  } catch (error) {
    if (error instanceof z.ZodError) return json({error: error.issues[0]?.message || 'Vérifiez les informations.'}, 400);
    if (error instanceof ApiError) return json({error: error.message}, error.status);
    console.error('Payment list API error', error instanceof Error ? error.message : 'unknown');
    return json({error: 'La liste de caisse est momentanément indisponible.'}, 503);
  }
}

export async function POST(request: Request) {
  try {
    const contentLength = Number(request.headers.get('content-length') || 0);
    if (Number.isFinite(contentLength) && contentLength > 8000) throw new ApiError(413, 'La demande est trop volumineuse.');
    const text = await readBoundedRequestText(request, 8000);
    let raw: unknown;
    try {raw = JSON.parse(text);} catch {throw new ApiError(400, 'La demande est illisible.');}
    const input = paymentInput.parse(raw);
    const user = await requireCashier(request, {organizationId: input.organizationId, locationId: input.locationId}, true);

    const duplicate = await db().prepare(
      `SELECT p.id,p.organization_id,p.location_id,p.order_id,p.idempotency_key,p.amount,p.allocation,p.method,p.status,
        o.status AS order_status,o.payment_status,o.paid_total,o.total
       FROM payments p JOIN orders o ON o.id=p.order_id AND o.organization_id=p.organization_id AND o.location_id=p.location_id
       WHERE p.organization_id=? AND p.location_id=? AND p.idempotency_key=?`,
    ).bind(input.organizationId, input.locationId, input.idempotencyKey).first<PaymentRow & {order_status: string; payment_status: string; paid_total:number; total:number}>();
    if (duplicate) {
      if (duplicate.order_id !== input.orderId || duplicate.amount !== input.amount || duplicate.method !== input.method || duplicate.allocation !== JSON.stringify(input.allocations)) {
        throw new ApiError(409, 'Cette tentative de paiement est déjà associée à une autre commande.');
      }
      return json(paymentResponse(duplicate, duplicate.order_status, duplicate.payment_status, duplicate.paid_total, duplicate.total));
    }

    const order = await db().prepare(
      `SELECT id,status,payment_status,total,paid_total,version
       FROM orders WHERE id=? AND organization_id=? AND location_id=? AND fulfillment='pickup'`,
    ).bind(input.orderId, input.organizationId, input.locationId).first<{id: string; status: string; payment_status: string; total: number; paid_total:number; version: number}>();
    if (!order) throw new ApiError(404, 'Commande introuvable dans cet établissement.');
    if (order.status !== 'ready' || !['due_at_pickup','partially_paid'].includes(order.payment_status)) {
      throw new ApiError(409, 'Cette commande n’est pas prête à être encaissée.');
    }
    const remaining = order.total - order.paid_total;
    if (remaining <= 0 || input.amount > remaining) throw new ApiError(409, 'Le montant dépasse le reste à encaisser. Actualisez l’addition.');
    const allocation = input.allocations.map(item => ({lineIndex: item.lineIndex, amount: item.amount}));
    if (allocation.length) {
      const unique = new Set(allocation.map(item => item.lineIndex));
      if (unique.size !== allocation.length) throw new ApiError(400, 'Une ligne ne peut apparaître qu’une seule fois.');
      let rawItems: unknown = [];
      try {rawItems = JSON.parse((await db().prepare('SELECT items FROM orders WHERE id=? AND organization_id=? AND location_id=?').bind(input.orderId, input.organizationId, input.locationId).first<{items:string}>())?.items || '[]');} catch {rawItems = [];}
      if (!Array.isArray(rawItems) || allocation.some(item => !rawItems[item.lineIndex] || !Number.isInteger((rawItems[item.lineIndex] as {total?:unknown})?.total))) throw new ApiError(400, 'La répartition ne correspond plus à l’addition.');
      const prior = await db().prepare('SELECT allocation FROM payments WHERE order_id=? AND organization_id=? AND location_id=? AND status=\'captured\'').bind(input.orderId, input.organizationId, input.locationId).all<{allocation:string}>();
      const allocated = new Map<number, number>();
      for (const row of prior.results) {try {const saved = JSON.parse(row.allocation); if (Array.isArray(saved)) for (const item of saved) if (Number.isInteger(item?.lineIndex)&&Number.isInteger(item?.amount)) allocated.set(item.lineIndex,(allocated.get(item.lineIndex)||0)+item.amount);} catch {}}
      if (allocation.reduce((sum, item) => sum + item.amount, 0) !== input.amount || allocation.some(item => item.amount + (allocated.get(item.lineIndex)||0) > Number((rawItems[item.lineIndex] as {total:number}).total))) throw new ApiError(409, 'La répartition dépasse le solde d’une ligne.');
    }
    const allocationJson = JSON.stringify(allocation);
    const shift = await db().prepare(
      `SELECT id FROM cash_shifts WHERE organization_id=? AND location_id=? AND status='open'`,
    ).bind(input.organizationId, input.locationId).first<{id: string}>();
    if (!shift) throw new ApiError(409, 'Ouvrez un shift de caisse avant d’encaisser.');

    const now = new Date().toISOString();
    const paymentId = crypto.randomUUID();
    const cashierGuard = `EXISTS(
      SELECT 1 FROM organization_memberships m
      JOIN organizations o ON o.id=m.organization_id AND o.status='active'
      JOIN locations l ON l.organization_id=m.organization_id AND l.id=? AND l.status='active'
      WHERE m.organization_id=? AND m.principal_id=? AND m.status='active'
        AND ((m.role='owner' AND m.location_id IS NULL)
          OR (m.location_id=l.id AND m.role IN ('manager','pos')))
    )`;
    const results = await db().batch([
      db().prepare(
        `INSERT INTO payments(id,organization_id,location_id,order_id,idempotency_key,amount,allocation,method,status,provider,provider_reference,actor_user_id,created_at)
         SELECT ?,?,?,?,?,?,?,?,'captured','cashier',NULL,?,?
         WHERE ${cashierGuard}
           AND EXISTS(SELECT 1 FROM orders o WHERE o.id=? AND o.organization_id=? AND o.location_id=? AND o.status='ready' AND o.payment_status IN ('due_at_pickup','partially_paid') AND o.paid_total+?<=o.total)
           AND EXISTS(SELECT 1 FROM cash_shifts s WHERE s.id=? AND s.organization_id=? AND s.location_id=? AND s.status='open')
         ON CONFLICT(organization_id,location_id,idempotency_key) DO NOTHING`,
      ).bind(paymentId, input.organizationId, input.locationId, input.orderId, input.idempotencyKey, input.amount, allocationJson, input.method, user.id, now,
        input.locationId, input.organizationId, user.id, input.orderId, input.organizationId, input.locationId, input.amount, shift.id, input.organizationId, input.locationId),
      db().prepare(
        `INSERT INTO cash_shift_entries(id,organization_id,location_id,shift_id,payment_id,amount,method,created_at)
         SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM payments p WHERE p.id=? AND p.organization_id=? AND p.location_id=? AND p.order_id=?)
         ON CONFLICT(organization_id,location_id,payment_id) DO NOTHING`,
      ).bind(`${paymentId}:shift`, input.organizationId, input.locationId, shift.id, paymentId, input.amount, input.method, now, paymentId, input.organizationId, input.locationId, input.orderId),
      db().prepare(
        `UPDATE orders SET paid_total=paid_total+?,status=CASE WHEN paid_total+?=total THEN 'completed' ELSE 'ready' END,payment_status=CASE WHEN paid_total+?=total THEN 'paid' ELSE 'partially_paid' END,payment_method=?,version=version+1,updated_at=?
         WHERE id=? AND organization_id=? AND location_id=? AND status='ready' AND payment_status IN ('due_at_pickup','partially_paid') AND paid_total+?<=total
           AND EXISTS(SELECT 1 FROM payments p WHERE p.id=? AND p.organization_id=? AND p.location_id=? AND p.order_id=?)
           AND EXISTS(SELECT 1 FROM cash_shift_entries e WHERE e.organization_id=? AND e.location_id=? AND e.shift_id=? AND e.payment_id=?)
           AND ${cashierGuard}`,
      ).bind(input.amount, input.amount, input.amount, input.method, now, input.orderId, input.organizationId, input.locationId, input.amount, paymentId, input.organizationId, input.locationId, input.orderId, input.organizationId, input.locationId, shift.id, paymentId,
        input.locationId, input.organizationId, user.id),
      db().prepare(
        `INSERT INTO events(id,order_id,status,actor,note,created_at)
         SELECT ?,id,status,?,CASE WHEN payment_status='paid' THEN 'Commande encaissée au retrait' ELSE 'Paiement partiel enregistré au retrait' END,? FROM orders
         WHERE id=? AND organization_id=? AND location_id=? AND paid_total>=?`,
      ).bind(`${paymentId}:payment`, user.id, now, input.orderId, input.organizationId, input.locationId, input.amount),
    ]);
    if (!results[0]?.meta.changes || !results[1]?.meta.changes) {
      const current = await db().prepare(
        `SELECT p.id,p.organization_id,p.location_id,p.order_id,p.idempotency_key,p.amount,p.allocation,p.method,p.status,
          o.status AS order_status,o.payment_status,o.paid_total,o.total
         FROM payments p JOIN orders o ON o.id=p.order_id AND o.organization_id=p.organization_id AND o.location_id=p.location_id
         WHERE p.organization_id=? AND p.location_id=? AND p.idempotency_key=?`,
      ).bind(input.organizationId, input.locationId, input.idempotencyKey).first<PaymentRow & {order_status: string; payment_status: string; paid_total:number; total:number}>();
      if (current) {
        if (current.order_id !== input.orderId || current.amount !== input.amount || current.method !== input.method || current.allocation !== allocationJson) {
          throw new ApiError(409, 'Cette tentative de paiement est déjà associée à une autre commande.');
        }
        return json(paymentResponse(current, current.order_status, current.payment_status, current.paid_total, current.total));
      }
      throw new ApiError(409, 'La commande a été modifiée pendant l’encaissement. Actualisez le ticket.');
    }
    const payment = await db().prepare('SELECT id,organization_id,location_id,order_id,idempotency_key,amount,allocation,method,status FROM payments WHERE id=? AND organization_id=? AND location_id=?').bind(paymentId, input.organizationId, input.locationId).first<PaymentRow>();
    if (!payment) throw new ApiError(503, 'Le reçu de paiement est introuvable après l’encaissement.');
    const finalOrder = await db().prepare('SELECT status,payment_status,paid_total,total FROM orders WHERE id=? AND organization_id=? AND location_id=?').bind(input.orderId, input.organizationId, input.locationId).first<{status:string;payment_status:string;paid_total:number;total:number}>();
    if (!finalOrder) throw new ApiError(503, 'La commande est introuvable après le paiement.');
    return json(paymentResponse(payment, finalOrder.status, finalOrder.payment_status, finalOrder.paid_total, finalOrder.total), 201);
  } catch (error) {
    if (error instanceof z.ZodError) return json({error: error.issues[0]?.message || 'Vérifiez les informations.'}, 400);
    if (error instanceof RangeError) return json({error: 'La demande est trop volumineuse.'}, 413);
    if (error instanceof ApiError) return json({error: error.message}, error.status);
    console.error('Payment API error', error instanceof Error ? error.message : 'unknown');
    return json({error: 'Le paiement n’a pas pu être enregistré. Aucun reçu n’a été confirmé.'}, 503);
  }
}
