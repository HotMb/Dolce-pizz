import {allergensOf, type Ingredient} from './menu';
import {isPizza, type PricedLine} from './pricing';
import {z} from 'zod';
import {
  createProductionOrder,
  defaultStationsFor,
  type ProductionItemInput,
  type ProductionOrder,
  type ProductionStation,
} from './production-flow';
import type {Product} from './catalog';
import type {ProductionPriority} from './production-priority';

export type SnapshotKind = ProductionItemInput['kind'];

export type ProductionSnapshot = {
  kind: SnapshotKind;
  routeKnown: boolean;
  allergens: string[];
  allergensKnown: boolean;
};

export type StoredOrderItem = {
  id: string;
  name: string;
  size: string;
  option: string;
  quantity: number;
  unitPrice: number;
  total: number;
  without: string[];
  extra: string[];
  extrasPrice?: number;
  kind?: SnapshotKind;
  routeKnown?: boolean;
  allergens?: string[];
  allergensKnown?: boolean;
  free?: {
    id: string;
    name: string;
    option: string;
    unitPrice: number;
    without?: string[];
    extra?: string[];
    kind?: SnapshotKind;
    routeKnown?: boolean;
    allergens?: string[];
    allergensKnown?: boolean;
  };
};

export type ProductionUnitSnapshot = {
  id: string;
  lineId: string;
  name: string;
  kind: SnapshotKind;
  size?: string;
  option?: string;
  without: string[];
  extra: string[];
  allergens: string[];
  allergensKnown: boolean;
  routeKnown: boolean;
};

export type ProductionTicketPayload = {
  createdAt: string;
  slot: string;
  channel: string;
  fulfillment: string;
  serviceMode: string;
  tableLabel: string;
  note: string;
  units: ProductionUnitSnapshot[];
};

export type ProductionDataIssue = 'item_snapshot_missing' | 'routing_unverified' | 'allergens_unverified';

/** Enforce the same recipe-safety gate on the server that the KDS communicates visually. */
export function productionDataIssue(
  payload: ProductionTicketPayload,
  itemId?: string,
): ProductionDataIssue | null {
  const units = itemId === undefined
    ? payload.units
    : payload.units.filter((unit) => unit.id === itemId);
  if (units.length === 0) return 'item_snapshot_missing';
  if (units.some((unit) => !unit.routeKnown)) return 'routing_unverified';
  if (units.some((unit) => !unit.allergensKnown)) return 'allergens_unverified';
  return null;
}

export type ProductionStateIssue = 'order_id_mismatch' | 'unit_snapshot_mismatch';

/** Ensure persisted workflow units still match the immutable units accepted with the order. */
export function productionStateIssue(
  orderId: string,
  payload: ProductionTicketPayload,
  flow: ProductionOrder,
): ProductionStateIssue | null {
  if (flow.id !== orderId) return 'order_id_mismatch';
  if (flow.items.length !== payload.units.length) return 'unit_snapshot_mismatch';
  const snapshots = new Map(payload.units.map((unit) => [unit.id, unit]));
  if (snapshots.size !== payload.units.length) return 'unit_snapshot_mismatch';
  if (flow.items.some((item) => {
    const snapshot = snapshots.get(item.id);
    if (!snapshot || snapshot.lineId !== item.lineId || snapshot.kind !== item.kind) return true;
    const expectedRoute = snapshot.routeKnown
      ? defaultStationsFor(snapshot.kind)
      : ['make_line', 'oven', 'expeditor'];
    return item.steps.length !== expectedRoute.length
      || item.steps.some((step, index) => step.station !== expectedRoute[index]);
  })) return 'unit_snapshot_mismatch';
  return null;
}

export type ProductionTicketView = {
  id: string;
  ticketNumber: number;
  slot: string;
  createdAt: string;
  channel: string;
  fulfillment: string;
  serviceMode: string;
  tableLabel: string;
  note: string;
  status: ProductionOrder['status'];
  revision: number;
  priority?: ProductionPriority;
  items: Array<ProductionUnitSnapshot & {steps: ProductionOrder['items'][number]['steps']}>;
};

const arrays = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((part): part is string => typeof part === 'string') : [];

const stationSchema = z.enum(['make_line', 'oven', 'expeditor']);
const productionUnitSnapshotSchema = z.object({
  id: z.string().min(1).max(200),
  lineId: z.string().min(1).max(200),
  name: z.string().min(1).max(100),
  kind: z.enum(['pizza', 'prepared_food', 'drink', 'dessert', 'other']),
  size: z.string().max(40).optional(),
  option: z.string().max(80).optional(),
  without: z.array(z.string().max(100)).max(30),
  extra: z.array(z.string().max(100)).max(30),
  allergens: z.array(z.string().max(40)).max(14),
  allergensKnown: z.boolean(),
  routeKnown: z.boolean(),
}).strict();
const productionPayloadSchema = z.object({
  createdAt: z.string().min(1),
  slot: z.string().min(1),
  channel: z.string().min(1).max(40),
  fulfillment: z.string().min(1).max(40),
  serviceMode: z.string().min(1).max(20).default('pickup'),
  tableLabel: z.string().max(30).default(''),
  note: z.string().max(500),
  units: z.array(productionUnitSnapshotSchema).min(1).max(600),
}).strict().superRefine((payload, context) => {
  const ids = payload.units.map((unit) => unit.id);
  if (new Set(ids).size !== ids.length) {
    context.addIssue({code: z.ZodIssueCode.custom, message: 'Production snapshot unit ids must be unique'});
  }
});
const productionStepSchema = z.object({
  station: stationSchema,
  status: z.enum(['pending', 'in_progress', 'completed']),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
}).strict().superRefine((step, context) => {
  if (step.status === 'pending' && (step.startedAt !== null || step.completedAt !== null)) {
    context.addIssue({code: z.ZodIssueCode.custom, message: 'Pending production steps cannot have timestamps'});
  }
  if (step.status === 'in_progress' && (step.startedAt === null || step.completedAt !== null)) {
    context.addIssue({code: z.ZodIssueCode.custom, message: 'In-progress production steps need a start timestamp only'});
  }
  if (step.status === 'completed' && (step.startedAt === null || step.completedAt === null)) {
    context.addIssue({code: z.ZodIssueCode.custom, message: 'Completed production steps need both timestamps'});
  }
});
const productionItemSchema = z.object({
  id: z.string().min(1),
  lineId: z.string().min(1),
  name: z.string().min(1),
  kind: z.enum(['pizza', 'prepared_food', 'drink', 'dessert', 'other']),
  steps: z.array(productionStepSchema).min(1).max(3),
}).strict().superRefine((item, context) => {
  const stations = item.steps.map((step) => step.station);
  if (new Set(stations).size !== stations.length || stations[stations.length - 1] !== 'expeditor') {
    context.addIssue({code: z.ZodIssueCode.custom, message: 'Production routes must be unique and end at Expeditor'});
  }
});
const eventActor = z.string().min(1);
const eventTime = z.string().min(1);
const productionEventSchema = z.discriminatedUnion('type', [
  z.object({type: z.literal('station_started'), itemId: z.string().min(1), station: stationSchema, actorId: eventActor, at: eventTime}).strict(),
  z.object({type: z.literal('station_completed'), itemId: z.string().min(1), station: stationSchema, actorId: eventActor, at: eventTime}).strict(),
  z.object({type: z.literal('order_ready'), actorId: eventActor, at: eventTime}).strict(),
  z.object({type: z.literal('order_cancelled'), actorId: eventActor, at: eventTime, reason: z.string().min(1)}).strict(),
  z.object({type: z.literal('order_reopened'), actorId: eventActor, at: eventTime, reason: z.string().min(1), supervisorConfirmed: z.literal(true), progressReset: z.literal(true)}).strict(),
  z.object({type: z.literal('order_completed'), actorId: eventActor, at: eventTime}).strict(),
]);
const productionStateSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(['in_progress', 'ready', 'cancelled', 'completed']),
  revision: z.number().int().nonnegative(),
  items: z.array(productionItemSchema).min(1).max(600),
  events: z.array(productionEventSchema).max(2000),
}).strict().superRefine((flow, context) => {
  const ids = flow.items.map((item) => item.id);
  if (new Set(ids).size !== ids.length) {
    context.addIssue({code: z.ZodIssueCode.custom, message: 'Production item ids must be unique'});
  }
  if (flow.events.length !== flow.revision) {
    context.addIssue({code: z.ZodIssueCode.custom, message: 'Production event count must match its revision'});
  }
  if (['ready', 'completed'].includes(flow.status)
    && flow.items.some((item) => item.steps.some((step) => step.status !== 'completed'))) {
    context.addIssue({code: z.ZodIssueCode.custom, message: 'Ready production orders require all routed steps completed'});
  }
});
const productionCommandSchema = z.discriminatedUnion('action', [
  z.object({
    orderId: z.string().uuid(),
    action: z.enum(['start', 'complete']),
    itemId: z.string().min(1).max(200),
    station: stationSchema,
    expectedRevision: z.number().int().nonnegative(),
  }).strict(),
  z.object({
    orderId: z.string().uuid(),
    action: z.literal('ready'),
    station: z.enum(['oven', 'expeditor']),
    expectedRevision: z.number().int().nonnegative(),
  }).strict(),
]);

export type ProductionCommandInput = z.infer<typeof productionCommandSchema>;
export const parseProductionCommand = (value: unknown): ProductionCommandInput => productionCommandSchema.parse(value);

function kindOf(product: Product): SnapshotKind {
  if (isPizza(product) || product.category === 'kids') return 'pizza';
  if (product.category === 'boissons') return 'drink';
  if (product.category === 'desserts') return 'dessert';
  return 'prepared_food';
}

function snapshotFor(
  product: Product | undefined,
  ingredients: Ingredient[],
  removed: string[] = [],
  added: string[] = [],
  option = '',
): ProductionSnapshot {
  if (!product) {
    return {kind: 'other', routeKnown: false, allergens: [], allergensKnown: false};
  }
  return {
    kind: kindOf(product),
    routeKnown: true,
    allergens: allergensOf(product, ingredients, removed, added, option),
    allergensKnown: product.allergensChecked === true,
  };
}

/** Freeze product routing and modified allergen data alongside the customer-facing order snapshot. */
export function snapshotPricedLines(
  lines: readonly PricedLine[],
  products: readonly Product[],
  ingredients: Ingredient[],
): StoredOrderItem[] {
  const find = (id: string) => products.find((product) => product.id === id);
  return lines.map((line) => {
    const paid = snapshotFor(find(line.id), ingredients, line.removed, line.added, line.option);
    const freeProduct = line.free ? find(line.free.id) : undefined;
    const free = line.free
      ? {
          ...line.free,
          ...snapshotFor(
            freeProduct,
            ingredients,
            line.freeRemoved,
            line.freeAdded,
            line.freeOption,
          ),
        }
      : undefined;
    return {
      id: line.id,
      name: line.name,
      size: line.size,
      option: line.option,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      total: line.total,
      without: [...line.without],
      extra: [...line.extra],
      ...(line.extras ? {extrasPrice: line.extras} : {}),
      ...paid,
      ...(free ? {free} : {}),
    };
  });
}

function safeNote(value: string): string {
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[coordonnée masquée]')
    .replace(/(?:\+33|0033|0)[\s.()-]*(?:[1-9](?:[\s.()-]*\d){8})/g, '[coordonnée masquée]')
    .replace(/\b\d{1,5}\s+(?:(?:bis|ter)\s+)?(?:rue|avenue|av\.?|boulevard|bd\.?|impasse|place|route|allée|allee|chemin|cours|quai)\b(?:\s+[^,;]{1,60})?/giu, '[adresse masquée]')
    .slice(0, 500);
}

function unitMetadata(
  line: Partial<StoredOrderItem>,
  free: Partial<NonNullable<StoredOrderItem['free']>> | undefined,
  id: string,
  lineId: string,
): ProductionUnitSnapshot {
  const item = free ? {...line, ...free} : line;
  const routeKnown = item.routeKnown === true;
  return {
    id,
    lineId,
    name: typeof item.name === 'string' ? item.name.slice(0, 100) : 'Article à vérifier',
    kind: isKind(item.kind) ? item.kind : 'other',
    ...(typeof item.size === 'string' ? {size: item.size.slice(0, 40)} : {}),
    ...(typeof item.option === 'string' && item.option ? {option: item.option.slice(0, 80)} : {}),
    without: arrays(item.without).slice(0, 30),
    extra: arrays(item.extra).slice(0, 30),
    allergens: arrays(item.allergens).slice(0, 14),
    allergensKnown: item.allergensKnown === true,
    routeKnown,
  };
}

function isKind(value: unknown): value is SnapshotKind {
  return value === 'pizza' || value === 'prepared_food' || value === 'drink' || value === 'dessert' || value === 'other';
}

/** Build the first persisted ticket. Legacy snapshots get an explicit, conservative full kitchen route. */
export function createTicketFromOrder(order: {
  id: string;
  created_at: string;
  slot: string;
  channel: string;
  fulfillment: string;
  service_mode?: string;
  table_label?: string;
  note: string;
  items: string | unknown[];
}): {payload: ProductionTicketPayload; flow: ProductionOrder} {
  const decoded: unknown = typeof order.items === 'string' ? JSON.parse(order.items) : order.items;
  if (!Array.isArray(decoded) || decoded.length === 0) throw new Error('Order item snapshot is invalid');
  const payload: ProductionTicketPayload = {
    createdAt: order.created_at,
    slot: order.slot,
    channel: order.channel,
    fulfillment: order.fulfillment,
    serviceMode: order.service_mode || 'pickup',
    tableLabel: order.table_label || '',
    note: safeNote(order.note || ''),
    units: [],
  };
  const units: ProductionItemInput[] = [];
  decoded.forEach((raw, lineIndex) => {
    if (!raw || typeof raw !== 'object') return;
    const line = raw as Partial<StoredOrderItem>;
    const quantity = Number.isInteger(line.quantity) && (line.quantity as number) > 0
      ? Math.min(line.quantity as number, 20)
      : 1;
    const lineId = `${order.id}:line:${lineIndex + 1}`;
    for (let index = 1; index <= quantity; index++) {
      const id = `${lineId}:item:${index}`;
      const metadata = unitMetadata(line, undefined, id, lineId);
      payload.units.push(metadata);
      units.push({
        id,
        lineId,
        name: metadata.name,
        kind: metadata.kind,
        ...(!metadata.routeKnown ? {stations: ['make_line', 'oven', 'expeditor'] as const} : {}),
      });
      if (line.free) {
        const freeId = `${lineId}:free:${index}`;
        const freeMeta = unitMetadata(line, line.free, freeId, lineId);
        payload.units.push(freeMeta);
        units.push({
          id: freeId,
          lineId,
          name: freeMeta.name,
          kind: freeMeta.kind,
          ...(!freeMeta.routeKnown ? {stations: ['make_line', 'oven', 'expeditor'] as const} : {}),
        });
      }
    }
  });
  const created = createProductionOrder({id: order.id, items: units});
  if (!created.ok) throw new Error(`Unable to initialize production flow: ${created.error}`);
  return {payload, flow: created.order};
}

/** Render a ticket for one station; legacy route uncertainty is visible and never inferred from today's menu. */
export function projectProductionTicket(input: {
  orderId: string;
  ticketNumber: number;
  payload: ProductionTicketPayload;
  flow: ProductionOrder;
  station: ProductionStation;
  priority?: ProductionPriority;
}): ProductionTicketView | null {
  const metaById = new Map(input.payload.units.map((unit) => [unit.id, unit]));
  const items = input.flow.items.flatMap((item) => {
    const meta = metaById.get(item.id);
    if (!meta) return [];
    const currentStep = item.steps.find((step) => step.status !== 'completed');
    // The oven remains the final readiness gate for the standard pickup flow.
    // Keep a cooked item visible there while its optional Expeditor step is
    // still pending so the operator can print the ready ticket and notify the
    // customer without having to switch stations.
    const hasOvenStep = item.steps.some((step) => step.station === 'oven');
    const ovenReady = hasOvenStep && item.steps
      .filter((step) => step.station !== 'expeditor')
      .every((step) => step.status === 'completed');
    const visibleAtStation = input.station === 'expeditor'
      || currentStep?.station === input.station
      || (input.station === 'oven' && ovenReady);
    if (!visibleAtStation) return [];
    return [{...meta, steps: [...item.steps]}];
  });
  if (!items.length) return null;
  return {
    id: input.orderId,
    ticketNumber: input.ticketNumber,
    slot: input.payload.slot,
    createdAt: input.payload.createdAt,
    channel: input.payload.channel,
    fulfillment: input.payload.fulfillment,
    serviceMode: input.payload.serviceMode,
    tableLabel: input.payload.tableLabel,
    note: input.payload.note,
    status: input.flow.status,
    revision: input.flow.revision,
    ...(input.priority ? {priority: input.priority} : {}),
    items,
  };
}

export function parseProductionPayload(serialized: string): ProductionTicketPayload {
  const value: unknown = JSON.parse(serialized);
  return productionPayloadSchema.parse(value) as ProductionTicketPayload;
}

export function parseProductionState(serialized: string): ProductionOrder {
  const value: unknown = JSON.parse(serialized);
  return productionStateSchema.parse(value) as ProductionOrder;
}
