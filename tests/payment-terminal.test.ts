import assert from 'node:assert/strict';
import {test} from 'node:test';
import {missingTerminalAdapter} from '../lib/payment-terminal';

test('terminal adapter fails closed until a provider is configured', async () => {
  const adapter = missingTerminalAdapter();
  const request = {organizationId: 'org', locationId: 'site', orderId: 'order', paymentId: 'payment', amount: 100, currency: 'EUR' as const, idempotencyKey: crypto.randomUUID()};
  assert.deepEqual(await adapter.capture(request), {status: 'failed', code: 'terminal_not_configured'});
  assert.deepEqual(await adapter.refund({...request, reason: 'Correction'}), {status: 'failed', code: 'terminal_not_configured'});
});
