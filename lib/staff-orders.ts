import {z} from 'zod';
import {normalizePhone} from './auth';
import {staffScopeSchema} from './staff-access';

const clean = z.string().trim();
const ingredientIds = z.array(clean.max(80)).max(20).optional();
export const staffOrderLineSchema = z.object({
  id: clean.max(80),
  size: z.enum(['senior', 'xxl', 'unique']),
  quantity: z.number().int().min(1).max(20),
  option: clean.max(80).default(''),
  freeId: clean.max(80).optional(),
  freeOption: clean.max(80).default(''),
  removed: ingredientIds,
  added: ingredientIds,
  freeRemoved: ingredientIds,
  freeAdded: ingredientIds,
}).strict();

export const staffOrderInputSchema = z.object({
  key: z.string().uuid(),
  ...staffScopeSchema.shape,
  channel: z.enum(['counter', 'phone', 'pos', 'kiosk']),
  customerName: clean.min(2).max(80),
  customerPhone: clean.max(30).refine(value => value === '' || normalizePhone(value) !== null),
  readySmsConfirmed: z.boolean(),
  postalCode: z.string().regex(/^\d{5}$/).optional(),
  slot: z.string().datetime(),
  note: clean.max(500),
  items: z.array(staffOrderLineSchema).min(1).max(40),
}).strict();

export type StaffOrderInput = z.infer<typeof staffOrderInputSchema>;
export type StaffOrderChannel = StaffOrderInput['channel'];

export const pilotOrderScope = {organizationId: 'dolce-pizza', locationId: 'ronchin'} as const;

export function staffOrderChannelAllowed(roles: readonly string[], channel: StaffOrderChannel): boolean {
  return roles.includes('owner') || roles.includes('manager')
    || (channel === 'counter' ? roles.includes('pos') : channel === 'phone' ? roles.includes('call_center') : channel === 'pos' ? roles.includes('pos') : roles.includes('kiosk'));
}

export function hasStaffOrderAccess(roles: readonly string[]): boolean {
  return staffOrderChannelAllowed(roles, 'counter') || staffOrderChannelAllowed(roles, 'phone');
}

export function staffOrderSqlGuard(channel: StaffOrderChannel): string {
  const channelRoles = channel === 'counter' || channel === 'pos' ? "'owner','manager','pos'" : channel === 'phone' ? "'owner','call_center'" : "'owner'";
  const organizationRoles = channel === 'phone' ? "'owner','call_center'" : "'owner'";
  return `EXISTS(
    SELECT 1 FROM locations sl
    JOIN organizations so ON so.id=sl.organization_id AND so.status='active'
    WHERE sl.organization_id=? AND sl.id=? AND sl.status='active'
  ) AND EXISTS(
    SELECT 1 FROM organization_memberships sm
    WHERE sm.organization_id=? AND sm.principal_id=? AND sm.status='active'
      AND sm.role IN (${channelRoles})
      AND (sm.location_id=? OR (sm.location_id IS NULL AND sm.role IN (${organizationRoles})))
  )`;
}

export function confirmedOrderContact(input: Pick<StaffOrderInput, 'customerPhone' | 'readySmsConfirmed'>) {
  const phone = input.customerPhone ? normalizePhone(input.customerPhone) : null;
  if (!phone || !input.readySmsConfirmed) {
    return {phone: '', notificationPhone: '', basis: 'none' as const, capturedAt: null};
  }
  return {phone: `0${phone.slice(3)}`, notificationPhone: phone, basis: 'staff_confirmed' as const, capturedAt: new Date().toISOString()};
}
