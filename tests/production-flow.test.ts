import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
  cancelProductionOrder,
  completeProductionOrder,
  completeStation,
  createProductionOrder,
  markOrderReady,
  markOrderReadyAtOven,
  reopenCancelledOrder,
  startStation,
  type ProductionItemInput,
  type ProductionOrder,
  type ReasonedProductionCommand,
  type ProductionStation,
} from '../lib/production-flow';

const instant = '2026-10-22T18:00:00+02:00';
const item = (
  id: string,
  kind: ProductionItemInput['kind'],
  changes: Partial<ProductionItemInput> = {},
): ProductionItemInput => ({id, lineId: id, name: id, kind, ...changes});

const orderWith = (...items: ProductionItemInput[]): ProductionOrder => {
  const result = createProductionOrder({id: 'order-1', items});
  if (!result.ok) throw new Error(`Unable to build order: ${result.error}`);
  return result.order;
};

const command = (
  order: ProductionOrder,
  changes: Partial<ReasonedProductionCommand> = {},
): ReasonedProductionCommand => ({
  actorId: 'kitchen-user',
  at: instant,
  expectedRevision: order.revision,
  ...changes,
});

const start = (
  order: ProductionOrder,
  itemId: string,
  station: ProductionStation,
): ProductionOrder => {
  const result = startStation(order, itemId, station, command(order));
  if (!result.ok) throw new Error(`Unable to start station: ${result.error}`);
  return result.order;
};

const finish = (
  order: ProductionOrder,
  itemId: string,
  station: ProductionStation,
): ProductionOrder => {
  const result = completeStation(order, itemId, station, command(order));
  if (!result.ok) throw new Error(`Unable to complete station: ${result.error}`);
  return result.order;
};

const finishRoute = (order: ProductionOrder, itemId: string): ProductionOrder => {
  let current = order;
  const productionItem = current.items.find((candidate) => candidate.id === itemId)!;
  for (const step of productionItem.steps) {
    current = start(current, itemId, step.station);
    current = finish(current, itemId, step.station);
  }
  return current;
};

test('default routes send pizzas through Make Line, Oven, Expeditor and drinks directly to Expeditor', () => {
  const order = orderWith(item('pizza-unit-1', 'pizza'), item('drink-unit-1', 'drink'));
  assert.deepEqual(order.items[0].steps.map((step) => step.station), [
    'make_line',
    'oven',
    'expeditor',
  ]);
  assert.deepEqual(order.items[1].steps.map((step) => step.station), ['expeditor']);
});

test('order cannot be marked ready until every required unit has completed Expeditor', () => {
  let order = orderWith(item('pizza-1', 'pizza'), item('drink-1', 'drink'));
  order = finishRoute(order, 'pizza-1');

  const blocked = markOrderReady(order, command(order));
  assert.deepEqual(blocked, {
    ok: false,
    error: 'incomplete_items',
    incompleteItemIds: ['drink-1'],
  });
  assert.equal(order.status, 'in_progress');

  order = start(order, 'drink-1', 'expeditor');
  order = finish(order, 'drink-1', 'expeditor');
  const ready = markOrderReady(order, command(order));
  assert.equal(ready.ok, true);
  if (ready.ok) {
    assert.equal(ready.order.status, 'ready');
    assert.equal(ready.order.events.at(-1)?.type, 'order_ready');
  }
});

test('oven readiness closes the optional Expeditor step with a valid lifecycle', () => {
  let order = orderWith(item('pizza-1', 'pizza'));
  order = start(order, 'pizza-1', 'make_line');
  order = finish(order, 'pizza-1', 'make_line');
  order = start(order, 'pizza-1', 'oven');
  order = finish(order, 'pizza-1', 'oven');

  const ready = markOrderReadyAtOven(order, command(order));
  assert.equal(ready.ok, true);
  if (ready.ok) {
    const expeditor = ready.order.items[0].steps.find((step) => step.station === 'expeditor');
    assert.equal(expeditor?.status, 'completed');
    assert.equal(expeditor?.startedAt, instant);
    assert.equal(expeditor?.completedAt, instant);
  }
});

test('station progression rejects skipped, duplicate and unstarted transitions without mutation', () => {
  const initial = orderWith(item('pizza-1', 'pizza'));
  const skipped = startStation(initial, 'pizza-1', 'oven', command(initial));
  assert.equal(skipped.ok, false);
  if (!skipped.ok) {
    assert.equal(skipped.error, 'station_out_of_order');
    assert.equal(skipped.expectedStation, 'make_line');
  }

  let order = start(initial, 'pizza-1', 'make_line');
  assert.equal(
    completeStation(initial, 'pizza-1', 'make_line', command(initial)).ok,
    false,
  );
  const repeatedStart = startStation(order, 'pizza-1', 'make_line', command(order));
  assert.equal(repeatedStart.ok, false);
  if (!repeatedStart.ok) assert.equal(repeatedStart.error, 'station_already_started');

  const skippedCompletion = completeStation(order, 'pizza-1', 'oven', command(order));
  assert.equal(skippedCompletion.ok, false);
  if (!skippedCompletion.ok) assert.equal(skippedCompletion.error, 'station_out_of_order');

  order = finish(order, 'pizza-1', 'make_line');
  const duplicateCompletion = completeStation(order, 'pizza-1', 'make_line', command(order));
  assert.equal(duplicateCompletion.ok, false);
  if (!duplicateCompletion.ok) assert.equal(duplicateCompletion.error, 'station_already_completed');
  assert.equal(initial.revision, 0);
  assert.equal(initial.items[0].steps[0].status, 'pending');
});

test('a drink cannot bypass the Expeditor check, and a station outside its route is rejected', () => {
  const order = orderWith(item('drink-1', 'drink'));
  const skipped = markOrderReady(order, command(order));
  assert.equal(skipped.ok, false);
  if (!skipped.ok) assert.deepEqual(skipped.incompleteItemIds, ['drink-1']);

  const makeLine = startStation(order, 'drink-1', 'make_line', command(order));
  assert.equal(makeLine.ok, false);
  if (!makeLine.ok) assert.equal(makeLine.error, 'station_not_in_route');
});

test('custom routes must be unique and end at Expeditor; item ids must be unique', () => {
  for (const stations of [
    [],
    ['make_line'],
    ['make_line', 'oven', 'make_line', 'expeditor'],
    ['make_line', 'not-a-station', 'expeditor'],
  ]) {
    const result = createProductionOrder({
      id: 'order-1',
      items: [item('pizza-1', 'pizza', {stations: stations as ProductionStation[]})],
    });
    assert.deepEqual(result, {ok: false, error: 'invalid_item_route'});
  }

  assert.deepEqual(
    createProductionOrder({id: 'order-1', items: [item('x', 'pizza'), item('x', 'drink')]}),
    {ok: false, error: 'duplicate_item_id'},
  );
  assert.deepEqual(createProductionOrder({id: 'order-1', items: []}), {
    ok: false,
    error: 'empty_order',
  });
});

test('reopening a cancelled order requires a reason, supervisor confirmation and full progress reset', () => {
  let order = orderWith(item('pizza-1', 'pizza'));
  order = start(order, 'pizza-1', 'make_line');
  order = finish(order, 'pizza-1', 'make_line');

  const cancelled = cancelProductionOrder(order, command(order, {reason: 'Customer cancelled'}));
  assert.equal(cancelled.ok, true);
  if (!cancelled.ok) throw new Error('Expected cancellation to succeed');
  order = cancelled.order;
  assert.equal(order.status, 'cancelled');
  assert.equal(order.events.at(-1)?.type, 'order_cancelled');

  const unauthorized = reopenCancelledOrder(order, {
    ...command(order),
    reason: 'Wrong order was cancelled',
    supervisorConfirmed: false,
    resetProgress: true,
  });
  assert.equal(unauthorized.ok, false);
  if (!unauthorized.ok) assert.equal(unauthorized.error, 'reopen_requires_supervisor_confirmation');

  const noReset = reopenCancelledOrder(order, {
    ...command(order),
    reason: 'Wrong order was cancelled',
    supervisorConfirmed: true,
    resetProgress: false,
  });
  assert.equal(noReset.ok, false);
  if (!noReset.ok) assert.equal(noReset.error, 'reopen_requires_progress_reset');

  const reopened = reopenCancelledOrder(order, {
    ...command(order),
    actorId: 'supervisor-1',
    reason: 'Wrong order was cancelled',
    supervisorConfirmed: true,
    resetProgress: true,
  });
  assert.equal(reopened.ok, true);
  if (reopened.ok) {
    assert.equal(reopened.order.status, 'in_progress');
    assert.deepEqual(
      reopened.order.items[0].steps.map((step) => [step.status, step.startedAt, step.completedAt]),
      [
        ['pending', null, null],
        ['pending', null, null],
        ['pending', null, null],
      ],
    );
    assert.deepEqual(
      reopened.order.events.slice(-2).map((event) => event.type),
      ['order_cancelled', 'order_reopened'],
    );
  }
});

test('cancellation needs a reason, ready orders can be cancelled, and completed orders are terminal', () => {
  let order = orderWith(item('drink-1', 'drink'));
  const missingReason = cancelProductionOrder(order, command(order, {reason: '  '}));
  assert.equal(missingReason.ok, false);
  if (!missingReason.ok) assert.equal(missingReason.error, 'cancellation_reason_required');

  order = start(order, 'drink-1', 'expeditor');
  order = finish(order, 'drink-1', 'expeditor');
  const ready = markOrderReady(order, command(order));
  assert.equal(ready.ok, true);
  if (!ready.ok) return;
  order = ready.order;

  const cancelled = cancelProductionOrder(order, command(order, {reason: 'Customer changed mind'}));
  assert.equal(cancelled.ok, true);
  if (!cancelled.ok) return;
  const completedAfterCancel = completeProductionOrder(cancelled.order, command(cancelled.order));
  assert.equal(completedAfterCancel.ok, false);
  if (!completedAfterCancel.ok) assert.equal(completedAfterCancel.error, 'order_already_cancelled');

  const reopened = reopenCancelledOrder(cancelled.order, {
    ...command(cancelled.order),
    actorId: 'supervisor-1',
    reason: 'Customer confirmed again',
    supervisorConfirmed: true,
    resetProgress: true,
  });
  assert.equal(reopened.ok, true);
  if (!reopened.ok) return;
  order = orderWith(item('drink-2', 'drink'));
  order = start(order, 'drink-2', 'expeditor');
  order = finish(order, 'drink-2', 'expeditor');
  const orderWithReadyState = markOrderReady(order, command(order));
  assert.equal(orderWithReadyState.ok, true);
  if (!orderWithReadyState.ok) return;
  const completed = completeProductionOrder(
    orderWithReadyState.order,
    command(orderWithReadyState.order),
  );
  assert.equal(completed.ok, true);
  if (completed.ok) {
    assert.equal(completed.order.status, 'completed');
    const cancellationAfterCompletion = cancelProductionOrder(
      completed.order,
      command(completed.order, {reason: 'Too late'}),
    );
    assert.equal(cancellationAfterCompletion.ok, false);
    if (!cancellationAfterCompletion.ok) {
      assert.equal(cancellationAfterCompletion.error, 'order_already_completed');
    }
  }
});

test('revision conflicts and malformed commands are rejected without changing the order', () => {
  const order = orderWith(item('drink-1', 'drink'));
  const started = start(order, 'drink-1', 'expeditor');

  const stale = completeStation(started, 'drink-1', 'expeditor', {
    ...command(started),
    expectedRevision: order.revision,
  });
  assert.equal(stale.ok, false);
  if (!stale.ok) {
    assert.equal(stale.error, 'revision_conflict');
    assert.equal(stale.expectedRevision, order.revision);
    assert.equal(stale.actualRevision, started.revision);
  }

  const malformed = completeStation(started, 'drink-1', 'expeditor', {
    ...command(started),
    at: 'not-a-timestamp',
  });
  assert.equal(malformed.ok, false);
  if (!malformed.ok) assert.equal(malformed.error, 'invalid_command');
  assert.equal(started.items[0].steps[0].status, 'in_progress');
});
