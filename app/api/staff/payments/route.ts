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
  amount: z.number().int().nonnegative().max(100000),
  method: z.enum(['cash', 'card']),
}).strict();

type PaymentRow = {
  id: string;
  organization_id: string;
  location_id: string;
  order_id: string;
  idempotency_key: string;
  amount: number;
  method: 'cash' | 'card';
  status: string;
};
type ShiftRow = {id: string; business_date: string; opening_float: number; opened_at: string};

function paymentResponse(payment: PaymentRow, orderStatus: string, paymentStatus: string) {
  return {
    payment: {
      id: payment.id,
      orderId: payment.order_id,
      amount: payment.amount,
      method: payment.method,
      status: payment.status,
    },
    order: {id: payment.order_id, status: orderStatus, paymentStatus},
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
    const shift = await db().prepare(
      `SELECT id,business_date,opening_float,opened_at FROM cash_shifts
       WHERE organization_id=? AND location_id=? AND status='open'`,
    ).bind(scope.data.organizationId, scope.data.locationId).first<ShiftRow>();
    const rows = await db().prepare(
      `SELECT id,name,total,slot,channel,service_mode,table_label,updated_at,created_at
       FROM orders
       WHERE organization_id=? AND location_id=? AND fulfillment='pickup' AND status='ready' AND payment_status='due_at_pickup'
       ORDER BY slot,created_at
       LIMIT 150`,
    ).bind(scope.data.organizationId, scope.data.locationId).all<{
      id: string; name: string; total: number; slot: string; channel: string; service_mode: string; table_label: string; updated_at: string; created_at: string;
    }>();
    const totals = shift ? await db().prepare(
      `SELECT COALESCE(SUM(CASE WHEN e.method='cash' THEN e.amount ELSE 0 END),0) AS cash_sales,
        COALESCE(SUM(CASE WHEN e.method='card' THEN e.amount ELSE 0 END),0) AS card_sales,
        COUNT(*) AS payment_count
       FROM cash_shift_entries e WHERE e.organization_id=? AND e.location_id=? AND e.shift_id=?`,
    ).bind(scope.data.organizationId, scope.data.locationId, shift.id).first<{cash_sales: number; card_sales: number; payment_count: number}>() : null;
    return json({shift: shift ? {id: shift.id, businessDate: shift.business_date, openingFloat: shift.opening_float, openedAt: shift.opened_at, cashSales: totals?.cash_sales||0, cardSales: totals?.card_sales||0, paymentCount: totals?.payment_count||0, expectedCash: shift.opening_float + (totals?.cash_sales||0)} : null, orders: rows.results.map(row => ({
      id: row.id,
      label: row.id.slice(0, 6).toUpperCase(),
      name: row.name,
      total: row.total,
      slot: row.slot,
      channel: row.channel,
      serviceMode: row.service_mode,
      tableLabel: row.table_label,
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
      `SELECT p.id,p.organization_id,p.location_id,p.order_id,p.idempotency_key,p.amount,p.method,p.status,
        o.status AS order_status,o.payment_status
       FROM payments p JOIN orders o ON o.id=p.order_id AND o.organization_id=p.organization_id AND o.location_id=p.location_id
       WHERE p.organization_id=? AND p.location_id=? AND p.idempotency_key=?`,
    ).bind(input.organizationId, input.locationId, input.idempotencyKey).first<PaymentRow & {order_status: string; payment_status: string}>();
    if (duplicate) {
      if (duplicate.order_id !== input.orderId || duplicate.amount !== input.amount || duplicate.method !== input.method) {
        throw new ApiError(409, 'Cette tentative de paiement est déjà associée à une autre commande.');
      }
      return json(paymentResponse(duplicate, duplicate.order_status, duplicate.payment_status));
    }

    const order = await db().prepare(
      `SELECT id,status,payment_status,total,version
       FROM orders WHERE id=? AND organization_id=? AND location_id=? AND fulfillment='pickup'`,
    ).bind(input.orderId, input.organizationId, input.locationId).first<{id: string; status: string; payment_status: string; total: number; version: number}>();
    if (!order) throw new ApiError(404, 'Commande introuvable dans cet établissement.');
    if (order.status !== 'ready' || order.payment_status !== 'due_at_pickup') {
      throw new ApiError(409, 'Cette commande n’est pas prête à être encaissée.');
    }
    if (order.total !== input.amount) throw new ApiError(409, 'Le montant du ticket a changé. Réimprimez le ticket.');
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
        `INSERT INTO payments(id,organization_id,location_id,order_id,idempotency_key,amount,method,status,provider,provider_reference,actor_user_id,created_at)
         SELECT ?,?,?,?,?,?,?,'captured','cashier',NULL,?,?
         WHERE ${cashierGuard}
           AND EXISTS(SELECT 1 FROM orders o WHERE o.id=? AND o.organization_id=? AND o.location_id=? AND o.status='ready' AND o.payment_status='due_at_pickup' AND o.total=?)
           AND EXISTS(SELECT 1 FROM cash_shifts s WHERE s.id=? AND s.organization_id=? AND s.location_id=? AND s.status='open')
         ON CONFLICT(organization_id,location_id,idempotency_key) DO NOTHING`,
      ).bind(paymentId, input.organizationId, input.locationId, input.orderId, input.idempotencyKey, input.amount, input.method, user.id, now,
        input.locationId, input.organizationId, user.id, input.orderId, input.organizationId, input.locationId, input.amount, shift.id, input.organizationId, input.locationId),
      db().prepare(
        `INSERT INTO cash_shift_entries(id,organization_id,location_id,shift_id,payment_id,amount,method,created_at)
         SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM payments p WHERE p.id=? AND p.organization_id=? AND p.location_id=? AND p.order_id=?)
         ON CONFLICT(organization_id,location_id,payment_id) DO NOTHING`,
      ).bind(`${paymentId}:shift`, input.organizationId, input.locationId, shift.id, paymentId, input.amount, input.method, now, paymentId, input.organizationId, input.locationId, input.orderId),
      db().prepare(
        `UPDATE orders SET status='completed',payment_status='paid',payment_method=?,version=version+1,updated_at=?
         WHERE id=? AND organization_id=? AND location_id=? AND status='ready' AND payment_status='due_at_pickup' AND total=?
           AND EXISTS(SELECT 1 FROM payments p WHERE p.id=? AND p.organization_id=? AND p.location_id=? AND p.order_id=?)
           AND EXISTS(SELECT 1 FROM cash_shift_entries e WHERE e.organization_id=? AND e.location_id=? AND e.shift_id=? AND e.payment_id=?)
           AND ${cashierGuard}`,
      ).bind(input.method, now, input.orderId, input.organizationId, input.locationId, input.amount, paymentId, input.organizationId, input.locationId, input.orderId, input.organizationId, input.locationId, shift.id, paymentId,
        input.locationId, input.organizationId, user.id),
      db().prepare(
        `INSERT INTO events(id,order_id,status,actor,note,created_at)
         SELECT ?,id,'completed',?,'Commande encaissée au retrait',? FROM orders
         WHERE id=? AND organization_id=? AND location_id=? AND status='completed' AND payment_status='paid'`,
      ).bind(`${paymentId}:completed`, user.id, now, input.orderId, input.organizationId, input.locationId),
    ]);
    if (!results[0]?.meta.changes || !results[1]?.meta.changes) {
      const current = await db().prepare(
        `SELECT p.id,p.organization_id,p.location_id,p.order_id,p.idempotency_key,p.amount,p.method,p.status,
          o.status AS order_status,o.payment_status
         FROM payments p JOIN orders o ON o.id=p.order_id AND o.organization_id=p.organization_id AND o.location_id=p.location_id
         WHERE p.organization_id=? AND p.location_id=? AND p.idempotency_key=?`,
      ).bind(input.organizationId, input.locationId, input.idempotencyKey).first<PaymentRow & {order_status: string; payment_status: string}>();
      if (current) {
        if (current.order_id !== input.orderId || current.amount !== input.amount || current.method !== input.method) {
          throw new ApiError(409, 'Cette tentative de paiement est déjà associée à une autre commande.');
        }
        return json(paymentResponse(current, current.order_status, current.payment_status));
      }
      throw new ApiError(409, 'La commande a été modifiée pendant l’encaissement. Actualisez le ticket.');
    }
    const payment = await db().prepare('SELECT id,organization_id,location_id,order_id,idempotency_key,amount,method,status FROM payments WHERE id=? AND organization_id=? AND location_id=?').bind(paymentId, input.organizationId, input.locationId).first<PaymentRow>();
    if (!payment) throw new ApiError(503, 'Le reçu de paiement est introuvable après l’encaissement.');
    return json(paymentResponse(payment, 'completed', 'paid'), 201);
  } catch (error) {
    if (error instanceof z.ZodError) return json({error: error.issues[0]?.message || 'Vérifiez les informations.'}, 400);
    if (error instanceof RangeError) return json({error: 'La demande est trop volumineuse.'}, 413);
    if (error instanceof ApiError) return json({error: error.message}, error.status);
    console.error('Payment API error', error instanceof Error ? error.message : 'unknown');
    return json({error: 'Le paiement n’a pas pu être enregistré. Aucun reçu n’a été confirmé.'}, 503);
  }
}
