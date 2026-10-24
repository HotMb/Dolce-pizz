import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {Product} from '../lib/catalog';
import {seedIngredients} from '../lib/menu';
import {priceCart} from '../lib/pricing';
import {
  createTicketFromOrder,
  parseProductionCommand,
  parseProductionPayload,
  parseProductionState,
  productionDataIssue,
  productionStateIssue,
  projectProductionTicket,
  snapshotPricedLines,
} from '../lib/production-repository';
import {completeStation, startStation} from '../lib/production-flow';

const pizza: Product = {
  id: 'pizza-test',
  name: 'Pizza de test',
  category: 'tomate',
  description: '',
  price: 1500,
  xxl: 2100,
  available: true,
  offer: true,
  ingredients: ['pate', 'mozzarella'],
  allergens: [],
  allergensChecked: true,
};
const freePizza: Product = {
  ...pizza,
  id: 'pizza-free',
  name: 'Pizza offerte',
};
const unverifiedDrink: Product = {
  id: 'drink-test',
  name: 'Boisson de test',
  category: 'boissons',
  description: '',
  price: 150,
  xxl: null,
  available: true,
  ingredients: [],
  allergens: ['soja'],
  allergensChecked: false,
};
const ingredients = seedIngredients.map((ingredient) =>
  ingredient.id === 'oeuf' ? {...ingredient, extra: true, available: true} : ingredient,
);
const cart = [
  {
    id: pizza.id,
    size: 'senior' as const,
    option: '',
    quantity: 1,
    freeId: freePizza.id,
    freeOption: '',
    removed: ['mozzarella'],
    added: ['oeuf'],
    freeRemoved: ['mozzarella'],
    freeAdded: ['oeuf'],
  },
  {id: unverifiedDrink.id, size: 'unique' as const, option: '', quantity: 1},
];

test('new order snapshots freeze route and allergens after modifiers for paid and free pizzas', () => {
  const priced = priceCart(cart, {products: [pizza, freePizza, unverifiedDrink], ingredients, extraPrice: 100});
  assert.equal(priced.problem, '');
  const [paid, drink] = snapshotPricedLines(priced.lines, [pizza, freePizza, unverifiedDrink], ingredients);

  assert.equal(paid.kind, 'pizza');
  assert.equal(paid.routeKnown, true);
  assert.equal(paid.allergensKnown, true);
  assert.deepEqual(paid.allergens, ['gluten', 'oeufs']);
  assert.deepEqual(paid.without, ['Mozzarella']);
  assert.deepEqual(paid.extra, ['Œuf']);
  assert.equal(paid.free?.name, 'Pizza offerte');
  assert.equal(paid.free?.kind, 'pizza');
  assert.equal(paid.free?.routeKnown, true);
  assert.equal(paid.free?.allergensKnown, true);
  assert.deepEqual(paid.free?.allergens, ['gluten', 'oeufs']);
  assert.deepEqual(paid.free?.without, ['Mozzarella']);
  assert.deepEqual(paid.free?.extra, ['Œuf']);
  assert.equal(drink.kind, 'drink');
  assert.equal(drink.routeKnown, true);
  assert.equal(drink.allergensKnown, false);
  assert.deepEqual(drink.allergens, ['soja']);
});

test('production command validation rejects client supplied tenant scope and malformed station actions', () => {
  const valid = {
    orderId: '8e6ee5d8-fcc5-4f3d-a9bd-c1c525f50fd0',
    action: 'start',
    itemId: 'line-1:item-1',
    station: 'make_line',
    expectedRevision: 0,
  };
  assert.deepEqual(parseProductionCommand(valid), valid);
  const ready = {
    orderId: valid.orderId,
    action: 'ready',
    station: 'expeditor',
    expectedRevision: 1,
  };
  assert.deepEqual(parseProductionCommand(ready), ready);
  assert.throws(() => parseProductionCommand({...valid, locationId: 'tourcoing'}));
  assert.throws(() => parseProductionCommand({...valid, station: 'expeditor', expectedRevision: -1}));
  assert.deepEqual(parseProductionCommand({...ready, station: 'oven'}), {...ready, station: 'oven'});
  assert.throws(() => parseProductionCommand({orderId: valid.orderId, action: 'ready', expectedRevision: 1}));
  assert.throws(() => parseProductionCommand({...ready, itemId: valid.itemId}));
});

test('ticket initialization expands quantities, routes known item snapshots, and exposes uncertainty for legacy rows', () => {
  const orderId = '8e6ee5d8-fcc5-4f3d-a9bd-c1c525f50fd0';
  const itemSnapshot = snapshotPricedLines(
    priceCart([cart[0]], {products: [pizza, freePizza], ingredients, extraPrice: 100}).lines,
    [pizza, freePizza],
    ingredients,
  );
  itemSnapshot[0].quantity = 2;
  const known = createTicketFromOrder({
    id: orderId,
    created_at: '2026-10-22T16:00:00.000Z',
    slot: '2026-10-22T18:00:00.000Z',
    channel: 'web',
    fulfillment: 'pickup',
    note: '',
    items: JSON.stringify(itemSnapshot),
  });
  assert.equal(known.payload.units.length, 4);
  assert.deepEqual(known.flow.items[0].steps.map((step) => step.station), ['make_line', 'oven', 'expeditor']);
  assert.equal(known.payload.units[0].routeKnown, true);

  const legacy = createTicketFromOrder({
    id: orderId,
    created_at: '2026-10-22T16:00:00.000Z',
    slot: '2026-10-22T18:00:00.000Z',
    channel: 'phone',
    fulfillment: 'pickup',
    note: 'Appelez le 06 12 34 56 78 ou le 03 20 40 09 01. Livrer au 12 rue des Lilas, 59000 Lille. client@example.fr',
    items: JSON.stringify([{id: 'old-product', name: 'Ancienne pizza', quantity: 1}]),
  });
  assert.equal(legacy.payload.units[0].routeKnown, false);
  assert.equal(legacy.payload.units[0].allergensKnown, false);
  assert.deepEqual(legacy.flow.items[0].steps.map((step) => step.station), ['make_line', 'oven', 'expeditor']);
  assert.doesNotMatch(legacy.payload.note, /06 12 34 56 78|client@example\.fr/);
  assert.doesNotMatch(legacy.payload.note, /03 20 40 09 01|12 rue des Lilas/);

  const view = projectProductionTicket({
    orderId,
    ticketNumber: 12,
    payload: legacy.payload,
    flow: legacy.flow,
    station: 'make_line',
  });
  assert.equal(view?.items[0].routeKnown, false);
  assert.equal(view?.items[0].allergensKnown, false);
  assert.equal('name' in (view || {}), false);
  assert.equal('phone' in (view || {}), false);
});

test('station projection shows only the current station while Expeditor receives every unit', () => {
  const orderId = 'f863d441-d1a7-46e4-8f64-9c13ca4c790c';
  const initialized = createTicketFromOrder({
    id: orderId,
    created_at: '2026-10-22T16:00:00.000Z',
    slot: '2026-10-22T18:00:00.000Z',
    channel: 'web',
    fulfillment: 'pickup',
    note: '',
    items: JSON.stringify([
      {id: 'pizza', name: 'Pizza', size: 'senior', option: '', quantity: 1, kind: 'pizza', routeKnown: true, allergens: [], allergensKnown: true},
      {id: 'drink', name: 'Boisson', size: 'unique', option: '', quantity: 1, kind: 'drink', routeKnown: true, allergens: [], allergensKnown: true},
    ]),
  });
  const pizzaId = initialized.flow.items[0].id;
  const emptyAtOven = projectProductionTicket({
    orderId,
    ticketNumber: 3,
    payload: initialized.payload,
    flow: initialized.flow,
    station: 'oven',
  });
  assert.equal(emptyAtOven, null);

  let flow = startStation(initialized.flow, pizzaId, 'make_line', {
    actorId: 'operator', at: '2026-10-22T18:00:00.000Z', expectedRevision: 0,
  });
  assert.equal(flow.ok, true);
  if (flow.ok) flow = completeStation(flow.order, pizzaId, 'make_line', {
    actorId: 'operator', at: '2026-10-22T18:01:00.000Z', expectedRevision: 1,
  });
  assert.equal(flow.ok, true);
  if (!flow.ok) return;
  const oven = projectProductionTicket({orderId, ticketNumber: 3, payload: initialized.payload, flow: flow.order, station: 'oven'});
  const expeditor = projectProductionTicket({orderId, ticketNumber: 3, payload: initialized.payload, flow: flow.order, station: 'expeditor'});
  assert.deepEqual(oven?.items.map((item) => item.kind), ['pizza']);
  assert.equal(expeditor?.items.length, 2);
});

test('server-side production data gate rejects unknown routing and allergens for unit actions and order readiness', () => {
  const orderId = '2d508338-9f40-4ed4-9bee-4f18d4c93b68';
  const ticket = createTicketFromOrder({
    id: orderId,
    created_at: '2026-10-22T16:00:00.000Z',
    slot: '2026-10-22T18:00:00.000Z',
    channel: 'web',
    fulfillment: 'pickup',
    note: '',
    items: JSON.stringify([
      {id: 'known', name: 'Pizza vérifiée', quantity: 1, kind: 'pizza', routeKnown: true, allergens: ['gluten'], allergensKnown: true},
      {id: 'unknown', name: 'Boisson à vérifier', quantity: 1, kind: 'drink', routeKnown: true, allergens: [], allergensKnown: false},
    ]),
  });
  const [knownUnit, unknownUnit] = ticket.payload.units;

  assert.equal(productionDataIssue(ticket.payload, knownUnit.id), null);
  assert.equal(productionDataIssue(ticket.payload, unknownUnit.id), 'allergens_unverified');
  assert.equal(productionDataIssue(ticket.payload), 'allergens_unverified');
  assert.equal(productionDataIssue({ ...ticket.payload, units: [] }, knownUnit.id), 'item_snapshot_missing');
  assert.equal(productionStateIssue(orderId, ticket.payload, ticket.flow), null);
  assert.equal(productionStateIssue('f863d441-d1a7-46e4-8f64-9c13ca4c790c', ticket.payload, ticket.flow), 'order_id_mismatch');
  const shortenedPizzaRoute = {
    ...ticket.flow,
    items: ticket.flow.items.map((item) => item.id === knownUnit.id ? {...item, steps: item.steps.slice(-1)} : item),
  };
  assert.equal(productionStateIssue(orderId, ticket.payload, shortenedPizzaRoute), 'unit_snapshot_mismatch');
  assert.throws(() => parseProductionPayload(JSON.stringify({...ticket.payload, units: [knownUnit, knownUnit]})));
  assert.throws(() => parseProductionState(JSON.stringify({...ticket.flow, items: []})));
  assert.throws(() => parseProductionState(JSON.stringify({...ticket.flow, status: 'ready'})));
});
