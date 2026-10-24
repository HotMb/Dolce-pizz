import {NextResponse} from 'next/server';
import {z} from 'zod';
import {db, ensureSeed} from '@/lib/server';
import {staffSessionUser} from '@/lib/auth';
import {loadStaffScope, readBoundedRequestText} from '@/lib/staff-access';

export const dynamic = 'force-dynamic';
const json = (body: unknown, status = 200) => NextResponse.json(body, {status, headers: {'Cache-Control': 'no-store'}});
class ApiError extends Error { constructor(public status: number, message: string) {super(message);} }

const scopeSchema = z.object({organizationId: z.string().min(1).max(128), locationId: z.string().min(1).max(128)}).strict();
const inputSchema = z.object({
  organizationId: z.string().min(1).max(128), locationId: z.string().min(1).max(128),
  action: z.enum(['open', 'close']), businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  openingFloat: z.number().int().nonnegative().max(100000).optional(),
  countedCash: z.number().int().nonnegative().max(100000).optional(),
  closeNote: z.string().trim().max(500).optional(), version: z.number().int().positive().optional(),
}).strict();

async function authorize(request: Request, scope: {organizationId: string; locationId: string}, requireOrigin: boolean) {
  const url = new URL(request.url); const origin = request.headers.get('origin');
  if (requireOrigin && (!origin || origin !== url.origin)) throw new ApiError(403, 'Cette demande doit être envoyée depuis le site.');
  const user = await staffSessionUser(request.headers.get('cookie')); if (!user) throw new ApiError(401, 'Connectez-vous avec un compte autorisé.');
  await ensureSeed();
  const access = await loadStaffScope(db(), user.id, scope);
  if (!access || !access.roles.some(role => role === 'owner' || role === 'manager' || role === 'pos')) throw new ApiError(403, 'Votre rôle ne permet pas de gérer cette caisse.');
  return {user, roles: access.roles};
}

type ShiftRecord = {id: string; business_date: string; status: string; opening_float: number; opened_by: string; opened_at: string; closed_by: string|null; closed_at: string|null; counted_cash: number|null; close_note: string; version: number};
type ShiftAggregate = {cash_sales: number; card_sales: number; payment_count: number};
async function shift(scope: {organizationId: string; locationId: string}) {
  return db().prepare(`SELECT id,business_date,status,opening_float,opened_by,opened_at,closed_by,closed_at,counted_cash,close_note,version FROM cash_shifts WHERE organization_id=? AND location_id=? AND status='open'`).bind(scope.organizationId, scope.locationId).first<ShiftRecord>();
}
async function totals(scope: {organizationId: string; locationId: string}, shiftId: string) {
  return db().prepare(`SELECT
    COALESCE((SELECT SUM(CASE WHEN method='cash' THEN amount ELSE 0 END) FROM cash_shift_entries WHERE organization_id=? AND location_id=? AND shift_id=?),0)+COALESCE((SELECT SUM(CASE WHEN method='cash' THEN amount ELSE 0 END) FROM cash_shift_adjustments WHERE organization_id=? AND location_id=? AND shift_id=?),0) AS cash_sales,
    COALESCE((SELECT SUM(CASE WHEN method='card' THEN amount ELSE 0 END) FROM cash_shift_entries WHERE organization_id=? AND location_id=? AND shift_id=?),0)+COALESCE((SELECT SUM(CASE WHEN method='card' THEN amount ELSE 0 END) FROM cash_shift_adjustments WHERE organization_id=? AND location_id=? AND shift_id=?),0) AS card_sales,
    (SELECT COUNT(*) FROM cash_shift_entries WHERE organization_id=? AND location_id=? AND shift_id=?) AS payment_count`).bind(scope.organizationId,scope.locationId,shiftId,scope.organizationId,scope.locationId,shiftId,scope.organizationId,scope.locationId,shiftId,scope.organizationId,scope.locationId,shiftId,scope.organizationId,scope.locationId,shiftId).first<{cash_sales: number; card_sales: number; payment_count: number}>();
}
function response(row: ShiftRecord, aggregate: ShiftAggregate|null) { return {id: row.id, businessDate: row.business_date, status: row.status, openingFloat: row.opening_float, openedBy: row.opened_by, openedAt: row.opened_at, closedBy: row.closed_by, closedAt: row.closed_at, countedCash: row.counted_cash, closeNote: row.close_note, version: row.version, cashSales: aggregate?.cash_sales || 0, cardSales: aggregate?.card_sales || 0, paymentCount: aggregate?.payment_count || 0, expectedCash: (row.opening_float || 0) + (aggregate?.cash_sales || 0)}; }

export async function GET(request: Request) {
  try {
    const url = new URL(request.url); const parsed = scopeSchema.safeParse({organizationId: url.searchParams.get('organizationId'), locationId: url.searchParams.get('locationId')});
    if (!parsed.success) throw new ApiError(400, 'Choisissez un établissement valide.');
    await authorize(request, parsed.data, false); const current = await shift(parsed.data);
    return json({shift: current ? response(current, await totals(parsed.data, current.id)) : null, scope: parsed.data});
  } catch (error) { if (error instanceof ApiError) return json({error: error.message}, error.status); console.error('Shift GET error', error); return json({error: 'La caisse est momentanément indisponible.'}, 503); }
}

export async function POST(request: Request) {
  try {
    const text = await readBoundedRequestText(request, 8000); let raw: unknown; try {raw = JSON.parse(text);} catch {throw new ApiError(400, 'La demande est illisible.');}
    const input = inputSchema.parse(raw); const auth = await authorize(request, {organizationId: input.organizationId, locationId: input.locationId}, true);
    const manager = auth.roles.some(role => role === 'owner' || role === 'manager'); if (!manager) throw new ApiError(403, 'Seul un responsable peut ouvrir ou clôturer un shift.');
    const now = new Date().toISOString();
    if (input.action === 'open') {
      if (input.openingFloat === undefined) throw new ApiError(400, 'Indiquez le fond de caisse initial.');
      if (await shift(input)) throw new ApiError(409, 'Un shift est déjà ouvert pour cet établissement.');
      const businessDate = input.businessDate || now.slice(0, 10); const id = crypto.randomUUID();
      const result = await db().prepare(`INSERT INTO cash_shifts(id,organization_id,location_id,business_date,status,opening_float,opened_by,opened_at,version) SELECT ?,?,?,?,'open',?,?,?,1 WHERE EXISTS(SELECT 1 FROM organizations o JOIN locations l ON l.organization_id=o.id AND l.id=? AND l.status='active' WHERE o.id=? AND o.status='active')`).bind(id, input.organizationId, input.locationId, businessDate, input.openingFloat, auth.user.id, now, input.locationId, input.organizationId).run();
      if (!result.meta.changes) throw new ApiError(409, 'Ce shift ne peut pas être ouvert pour cet établissement.');
      return json({shift: response({id, business_date: businessDate, status: 'open', opening_float: input.openingFloat, opened_by: auth.user.id, opened_at: now, closed_by: null, closed_at: null, counted_cash: null, close_note: '', version: 1}, {cash_sales: 0, card_sales: 0, payment_count: 0})}, 201);
    }
    const current = await shift(input); if (!current) throw new ApiError(409, 'Aucun shift ouvert pour cet établissement.');
    if (input.version !== undefined && input.version !== current.version) throw new ApiError(409, 'La caisse a changé. Actualisez avant de clôturer.');
    if (input.countedCash === undefined) throw new ApiError(400, 'Indiquez le montant espèces compté.');
    const aggregate = await totals(input, current.id); const expected = current.opening_float + (aggregate?.cash_sales || 0); const variance = input.countedCash - expected;
    if (variance !== 0 && !input.closeNote) throw new ApiError(409, `Le comptage espèces diffère de ${Math.abs(variance)} centime(s). Ajoutez une note de clôture.`);
    const result = await db().prepare(`UPDATE cash_shifts SET status='closed',closed_by=?,closed_at=?,counted_cash=?,close_note=?,version=version+1 WHERE id=? AND organization_id=? AND location_id=? AND status='open' AND version=?`).bind(auth.user.id, now, input.countedCash, input.closeNote || '', current.id, input.organizationId, input.locationId, current.version).run();
    if (!result.meta.changes) throw new ApiError(409, 'Le shift a déjà été clôturé.');
    return json({shift: response({...current, status: 'closed', closed_by: auth.user.id, closed_at: now, counted_cash: input.countedCash, close_note: input.closeNote || '', version: current.version + 1}, aggregate), variance});
  } catch (error) { if (error instanceof z.ZodError) return json({error: error.issues[0]?.message || 'Vérifiez les informations.'}, 400); if (error instanceof ApiError) return json({error: error.message}, error.status); console.error('Shift POST error', error); return json({error: 'Le shift n’a pas pu être enregistré.'}, 503); }
}
