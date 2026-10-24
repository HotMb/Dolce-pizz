import {NextResponse} from 'next/server';
import {z} from 'zod';
import {db, ensureSeed} from '@/lib/server';
import {sessionUser} from '@/lib/auth';
import {loadStaffScope, readBoundedRequestText, type StaffScopeKey} from '@/lib/staff-access';
import {paymentTerminalAdapter} from '@/lib/payment-terminal';

export const dynamic = 'force-dynamic';
const json = (body: unknown, status = 200) => NextResponse.json(body, {status, headers: {'Cache-Control': 'no-store'}});
class ApiError extends Error {constructor(public status: number, message: string) {super(message);}}
const inputSchema = z.object({
  organizationId: z.string().min(1).max(128), locationId: z.string().min(1).max(128),
  orderId: z.string().min(1).max(128), idempotencyKey: z.string().uuid(),
  amount: z.number().int().min(1).max(100000),
}).strict();

async function requireCashier(request: Request, scope: StaffScopeKey) {
  const origin = request.headers.get('origin');
  if (!origin || origin !== new URL(request.url).origin) throw new ApiError(403, 'Cette demande doit être envoyée depuis le site.');
  const user = await sessionUser(request.headers.get('cookie'));
  if (!user) throw new ApiError(401, 'Connectez-vous avec un compte autorisé.');
  await ensureSeed();
  const access = await loadStaffScope(db(), user.id, scope);
  if (!access || !access.roles.some(role => role === 'owner' || role === 'manager' || role === 'pos')) throw new ApiError(403, 'Votre rôle ne permet pas d’utiliser le terminal.');
  return user;
}

/** Starts a provider transaction only after a real adapter is installed. */
export async function POST(request: Request) {
  try {
    const text = await readBoundedRequestText(request, 6000);
    let raw: unknown;
    try {raw = JSON.parse(text);} catch {throw new ApiError(400, 'La demande est illisible.');}
    const input = inputSchema.parse(raw);
    await requireCashier(request, {organizationId: input.organizationId, locationId: input.locationId});
    const order = await db().prepare('SELECT id,total,paid_total,status,payment_status FROM orders WHERE id=? AND organization_id=? AND location_id=? AND fulfillment=\'pickup\'')
      .bind(input.orderId, input.organizationId, input.locationId).first<{id:string; total:number; paid_total:number; status:string; payment_status:string}>();
    if (!order) throw new ApiError(404, 'Commande introuvable dans cet établissement.');
    if (order.status !== 'ready' || !['due_at_pickup', 'partially_paid'].includes(order.payment_status) || input.amount > order.total - order.paid_total) throw new ApiError(409, 'Le montant ne peut pas être présenté au terminal.');
    const result = await paymentTerminalAdapter().capture({organizationId: input.organizationId, locationId: input.locationId, orderId: input.orderId, paymentId: `terminal:${input.idempotencyKey}`, amount: input.amount, currency: 'EUR', idempotencyKey: input.idempotencyKey});
    if (result.status !== 'captured') return json({error: 'Aucun paiement n’a été confirmé par le terminal.', code: result.code || 'terminal_failed'}, 503);
    // A provider adapter must be completed with an atomic payment ledger write before this endpoint can return success.
    return json({error: 'Adaptateur terminal incomplet : aucun paiement n’a été enregistré.', code: 'terminal_adapter_incomplete'}, 503);
  } catch (error) {
    if (error instanceof z.ZodError) return json({error: error.issues[0]?.message || 'Vérifiez les informations.'}, 400);
    if (error instanceof ApiError) return json({error: error.message}, error.status);
    console.error('Terminal payment API error', error instanceof Error ? error.message : 'unknown');
    return json({error: 'Le terminal est momentanément indisponible.'}, 503);
  }
}
