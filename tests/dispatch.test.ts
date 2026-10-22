import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
  normalizeFrenchPostalCode,
  routeDelivery,
  routePickup,
  type DispatchLocation,
} from '../lib/dispatch';

const location = (
  id: string,
  changes: Partial<DispatchLocation> = {},
): DispatchLocation => ({
  id,
  name: id,
  enabled: true,
  isOpen: true,
  isAcceptingOrders: true,
  deliveryPostalCodes: ['59000'],
  pickupPostalCode: '59000',
  routingPriority: 0,
  capacity: {currentLoad: 0, maxLoad: 10},
  ...changes,
});

test('French postal codes remain strings and invalid formats are rejected', () => {
  assert.equal(normalizeFrenchPostalCode(' 05900 '), '05900');
  assert.equal(normalizeFrenchPostalCode(59000), null);
  assert.equal(normalizeFrenchPostalCode('59 000'), null);
  assert.equal(normalizeFrenchPostalCode('5900'), null);
  assert.equal(normalizeFrenchPostalCode('ABCDE'), null);
});

test('delivery chooses the eligible overlapping location with the lowest load ratio', () => {
  const result = routeDelivery('59000', [
    location('tourcoing', {capacity: {currentLoad: 8, maxLoad: 10}}),
    location('ronchin', {capacity: {currentLoad: 2, maxLoad: 10}}),
  ]);

  assert.equal(result.status, 'routed');
  if (result.status !== 'routed') return;
  assert.equal(result.selected.locationId, 'ronchin');
  assert.equal(result.rationale, 'lowest_load_ratio');
  assert.equal(result.selected.utilization, 0.2);
});

test('equal delivery load is resolved by configured priority then stable location id', () => {
  const priorityResult = routeDelivery('59000', [
    location('ronchin', {
      capacity: {currentLoad: 1, maxLoad: 4},
      routingPriority: 1,
    }),
    location('tourcoing', {
      capacity: {currentLoad: 2, maxLoad: 8},
      routingPriority: 3,
    }),
  ]);
  assert.equal(priorityResult.status, 'routed');
  if (priorityResult.status === 'routed') {
    assert.equal(priorityResult.selected.locationId, 'tourcoing');
    assert.equal(priorityResult.rationale, 'routing_priority_tiebreak');
  }

  const stableResult = routeDelivery('59000', [
    location('zeta', {capacity: {currentLoad: 1, maxLoad: 4}}),
    location('alpha', {capacity: {currentLoad: 2, maxLoad: 8}}),
  ]);
  assert.equal(stableResult.status, 'routed');
  if (stableResult.status === 'routed') {
    assert.equal(stableResult.selected.locationId, 'alpha');
    assert.equal(stableResult.rationale, 'stable_location_id_tiebreak');
  }
});

test('delivery excludes disabled, closed, paused, full and misconfigured locations with reasons', () => {
  const result = routeDelivery('59000', [
    location('disabled', {enabled: false}),
    location('closed', {isOpen: false}),
    location('paused', {isAcceptingOrders: false}),
    location('full', {capacity: {currentLoad: 10, maxLoad: 10}}),
    location('bad-capacity', {capacity: {currentLoad: 2, maxLoad: 0}}),
    location('wrong-zone', {deliveryPostalCodes: ['59200']}),
    location('no-zone', {deliveryPostalCodes: []}),
  ]);

  assert.equal(result.status, 'unavailable');
  if (result.status !== 'unavailable') return;
  const reasonsById = new Map(
    result.candidates.map((candidate) => [candidate.locationId, candidate.reasons]),
  );
  assert.ok(reasonsById.get('disabled')?.includes('location_disabled'));
  assert.ok(reasonsById.get('closed')?.includes('location_closed'));
  assert.ok(reasonsById.get('paused')?.includes('not_accepting_orders'));
  assert.ok(reasonsById.get('full')?.includes('at_capacity'));
  assert.ok(reasonsById.get('bad-capacity')?.includes('capacity_unconfigured'));
  assert.ok(reasonsById.get('wrong-zone')?.includes('outside_service_area'));
  assert.ok(reasonsById.get('no-zone')?.includes('delivery_zone_unconfigured'));
});

test('invalid customer postal code cannot produce a delivery recommendation', () => {
  assert.deepEqual(routeDelivery('59-000', [location('ronchin')]), {
    status: 'invalid_input',
    postalCode: null,
    reasons: ['invalid_postal_code'],
    candidates: [],
  });
});

test('pickup postal-code suggestion never confirms the location without an explicit selection', () => {
  const result = routePickup(undefined, '59000', [
    location('ronchin'),
    location('tourcoing', {pickupPostalCode: '59200'}),
  ]);

  assert.equal(result.status, 'selection_required');
  if (result.status !== 'selection_required') return;
  assert.equal(result.postalCode, '59000');
  assert.deepEqual(result.suggestions.map((suggestion) => suggestion.locationId), ['ronchin']);
});

test('pickup honors the customer-confirmed site, independent of postal-code suggestion', () => {
  const result = routePickup('tourcoing', '59000', [
    location('ronchin'),
    location('tourcoing', {pickupPostalCode: '59200'}),
  ]);

  assert.equal(result.status, 'confirmed');
  if (result.status === 'confirmed') assert.equal(result.selected.locationId, 'tourcoing');
});

test('pickup confirmation still checks enabled, open, accepting and capacity state', () => {
  const result = routePickup('ronchin', null, [
    location('ronchin', {isOpen: false}),
  ]);

  assert.equal(result.status, 'unavailable');
  if (result.status === 'unavailable') {
    assert.deepEqual(result.reasons, ['location_closed']);
  }
});

test('pickup reports unknown selections and flags malformed optional suggestion postal codes', () => {
  assert.deepEqual(routePickup('missing', null, [location('ronchin')]), {
    status: 'unavailable',
    postalCode: null,
    selected: null,
    reasons: ['unknown_location'],
  });

  const result = routePickup(null, '59-000', [location('ronchin')]);
  assert.equal(result.status, 'selection_required');
  if (result.status === 'selection_required') {
    assert.equal(result.postalCodeIssue, 'invalid_postal_code');
    assert.deepEqual(result.suggestions, []);
  }
});

test('duplicate location ids cannot receive delivery or pickup dispatch', () => {
  const locations = [location('ronchin'), location('ronchin')];
  const delivery = routeDelivery('59000', locations);
  assert.equal(delivery.status, 'unavailable');
  if (delivery.status === 'unavailable') {
    assert.ok(delivery.candidates.every((candidate) =>
      candidate.reasons.includes('duplicate_location_id'),
    ));
  }

  const pickup = routePickup('ronchin', null, locations);
  assert.equal(pickup.status, 'unavailable');
  if (pickup.status === 'unavailable') {
    assert.ok(pickup.reasons.includes('duplicate_location_id'));
  }
});
