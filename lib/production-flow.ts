/** Pure domain model for an order moving through restaurant production stations. */

export type ProductionStation = 'make_line' | 'oven' | 'expeditor';
export type ProductionItemKind = 'pizza' | 'prepared_food' | 'drink' | 'dessert' | 'other';
export type ProductionOrderStatus = 'in_progress' | 'ready' | 'cancelled' | 'completed';
export type ProductionStepStatus = 'pending' | 'in_progress' | 'completed';

export type ProductionItemInput = {
  /** Unique physical item id. Expand a quantity into separate item ids upstream. */
  id: string;
  /** The source order-line id, shared by units that came from one line. */
  lineId: string;
  name: string;
  kind: ProductionItemKind;
  /** Optional tenant-configured route; Expeditor must always be the final step. */
  stations?: readonly ProductionStation[];
};

export type ProductionStep = {
  station: ProductionStation;
  status: ProductionStepStatus;
  startedAt: string | null;
  completedAt: string | null;
};

export type ProductionItem = {
  id: string;
  lineId: string;
  name: string;
  kind: ProductionItemKind;
  steps: readonly ProductionStep[];
};

export type ProductionEvent =
  | {
      type: 'station_started';
      itemId: string;
      station: ProductionStation;
      actorId: string;
      at: string;
    }
  | {
      type: 'station_completed';
      itemId: string;
      station: ProductionStation;
      actorId: string;
      at: string;
    }
  | {type: 'order_ready'; actorId: string; at: string}
  | {type: 'order_cancelled'; actorId: string; at: string; reason: string}
  | {
      type: 'order_reopened';
      actorId: string;
      at: string;
      reason: string;
      supervisorConfirmed: true;
      progressReset: true;
    }
  | {type: 'order_completed'; actorId: string; at: string};

export type ProductionOrder = {
  id: string;
  status: ProductionOrderStatus;
  /** Incremented on every successful command; persist with compare-and-swap. */
  revision: number;
  items: readonly ProductionItem[];
  events: readonly ProductionEvent[];
};

export type ProductionFlowError =
  | 'invalid_order'
  | 'empty_order'
  | 'invalid_item'
  | 'duplicate_item_id'
  | 'invalid_item_route'
  | 'invalid_command'
  | 'revision_conflict'
  | 'order_not_in_progress'
  | 'item_not_found'
  | 'station_not_in_route'
  | 'station_out_of_order'
  | 'station_already_started'
  | 'station_not_started'
  | 'station_already_completed'
  | 'order_not_ready'
  | 'order_already_ready'
  | 'order_already_cancelled'
  | 'order_already_completed'
  | 'incomplete_items'
  | 'cancellation_reason_required'
  | 'order_not_cancelled'
  | 'reopen_requires_supervisor_confirmation'
  | 'reopen_requires_progress_reset';

export type ProductionFlowResult =
  | {ok: true; order: ProductionOrder}
  | {
      ok: false;
      error: ProductionFlowError;
      expectedRevision?: number;
      actualRevision?: number;
      expectedStation?: ProductionStation;
      incompleteItemIds?: readonly string[];
    };

export type ProductionCommand = {
  actorId: string;
  /** ISO-8601 timestamp with an explicit UTC offset. */
  at: string;
  expectedRevision: number;
};

export type ReasonedProductionCommand = ProductionCommand & {reason?: string};

export type ReopenProductionCommand = ReasonedProductionCommand & {
  supervisorConfirmed?: boolean;
  resetProgress?: boolean;
};

const DEFAULT_STATIONS: Readonly<Record<ProductionItemKind, readonly ProductionStation[]>> = {
  pizza: ['make_line', 'oven', 'expeditor'],
  prepared_food: ['make_line', 'expeditor'],
  // Drinks and other items that do not need kitchen production still have to
  // pass through the Expeditor so they are included in the final order check.
  drink: ['expeditor'],
  dessert: ['expeditor'],
  other: ['expeditor'],
};

export function defaultStationsFor(kind: ProductionItemKind): readonly ProductionStation[] {
  return [...DEFAULT_STATIONS[kind]];
}

/** Validate and construct an immutable initial state. One item represents one physical unit. */
export function createProductionOrder(input: {
  id: string;
  items: readonly ProductionItemInput[];
}): ProductionFlowResult {
  if (!isNonBlank(input.id) || !Array.isArray(input.items)) {
    return {ok: false, error: 'invalid_order'};
  }
  const inputItems: readonly ProductionItemInput[] = input.items;
  if (inputItems.length === 0) return {ok: false, error: 'empty_order'};

  const seenIds = new Set<string>();
  const items: ProductionItem[] = [];
  for (const inputItem of inputItems) {
    if (
      !isNonBlank(inputItem.id) ||
      !isNonBlank(inputItem.lineId) ||
      !isNonBlank(inputItem.name) ||
      !isProductionItemKind(inputItem.kind)
    ) {
      return {ok: false, error: 'invalid_item'};
    }
    if (seenIds.has(inputItem.id)) return {ok: false, error: 'duplicate_item_id'};
    seenIds.add(inputItem.id);

    const stations = inputItem.stations ?? DEFAULT_STATIONS[inputItem.kind];
    if (!isValidRoute(stations)) return {ok: false, error: 'invalid_item_route'};
    items.push({
      id: inputItem.id,
      lineId: inputItem.lineId,
      name: inputItem.name,
      kind: inputItem.kind,
      steps: stations.map((station) => ({
        station,
        status: 'pending',
        startedAt: null,
        completedAt: null,
      })),
    });
  }

  return {
    ok: true,
    order: {id: input.id, status: 'in_progress', revision: 0, items, events: []},
  };
}

export function startStation(
  order: ProductionOrder,
  itemId: string,
  station: ProductionStation,
  command: ProductionCommand,
): ProductionFlowResult {
  const commandError = validateCommand(order, command);
  if (commandError) return commandError;
  const statusError = requireInProgress(order);
  if (statusError) return statusError;

  const itemIndex = order.items.findIndex((item) => item.id === itemId);
  if (itemIndex < 0) return {ok: false, error: 'item_not_found'};
  const item = order.items[itemIndex];
  const stepIndex = item.steps.findIndex((step) => step.station === station);
  if (stepIndex < 0) return {ok: false, error: 'station_not_in_route'};
  const nextIndex = firstIncompleteStep(item);

  if (stepIndex < nextIndex) return {ok: false, error: 'station_already_completed'};
  if (stepIndex > nextIndex) {
    return {
      ok: false,
      error: 'station_out_of_order',
      expectedStation: item.steps[nextIndex]?.station,
    };
  }
  const step = item.steps[stepIndex];
  if (step.status === 'in_progress') return {ok: false, error: 'station_already_started'};
  if (step.status === 'completed') return {ok: false, error: 'station_already_completed'};

  const updatedItem: ProductionItem = {
    ...item,
    steps: item.steps.map((candidate, index) =>
      index === stepIndex
        ? {...candidate, status: 'in_progress', startedAt: command.at}
        : candidate,
    ),
  };
  const items = replaceItem(order.items, itemIndex, updatedItem);
  return succeed(order, items, {
    type: 'station_started',
    itemId,
    station,
    actorId: command.actorId.trim(),
    at: command.at,
  });
}

export function completeStation(
  order: ProductionOrder,
  itemId: string,
  station: ProductionStation,
  command: ProductionCommand,
): ProductionFlowResult {
  const commandError = validateCommand(order, command);
  if (commandError) return commandError;
  const statusError = requireInProgress(order);
  if (statusError) return statusError;

  const itemIndex = order.items.findIndex((item) => item.id === itemId);
  if (itemIndex < 0) return {ok: false, error: 'item_not_found'};
  const item = order.items[itemIndex];
  const stepIndex = item.steps.findIndex((step) => step.station === station);
  if (stepIndex < 0) return {ok: false, error: 'station_not_in_route'};
  const nextIndex = firstIncompleteStep(item);

  if (stepIndex < nextIndex) return {ok: false, error: 'station_already_completed'};
  if (stepIndex > nextIndex) {
    return {
      ok: false,
      error: 'station_out_of_order',
      expectedStation: item.steps[nextIndex]?.station,
    };
  }
  const step = item.steps[stepIndex];
  if (step.status === 'pending') return {ok: false, error: 'station_not_started'};
  if (step.status === 'completed') return {ok: false, error: 'station_already_completed'};

  const updatedItem: ProductionItem = {
    ...item,
    steps: item.steps.map((candidate, index) =>
      index === stepIndex
        ? {...candidate, status: 'completed', completedAt: command.at}
        : candidate,
    ),
  };
  const items = replaceItem(order.items, itemIndex, updatedItem);
  return succeed(order, items, {
    type: 'station_completed',
    itemId,
    station,
    actorId: command.actorId.trim(),
    at: command.at,
  });
}

/** Expeditor's final check: all routed item units must have completed every step. */
export function markOrderReady(
  order: ProductionOrder,
  command: ProductionCommand,
): ProductionFlowResult {
  const commandError = validateCommand(order, command);
  if (commandError) return commandError;
  if (order.status === 'ready') return {ok: false, error: 'order_already_ready'};
  const statusError = requireInProgress(order);
  if (statusError) return statusError;

  const incompleteItemIds = order.items
    .filter((item) => item.steps.some((step) => step.status !== 'completed'))
    .map((item) => item.id);
  if (incompleteItemIds.length > 0) {
    return {ok: false, error: 'incomplete_items', incompleteItemIds};
  }

  return succeed(
    {...order, status: 'ready'},
    order.items,
    {type: 'order_ready', actorId: command.actorId.trim(), at: command.at},
  );
}

export function cancelProductionOrder(
  order: ProductionOrder,
  command: ReasonedProductionCommand,
): ProductionFlowResult {
  const commandError = validateCommand(order, command);
  if (commandError) return commandError;
  const reason = normalizedReason(command.reason);
  if (!reason) return {ok: false, error: 'cancellation_reason_required'};
  if (order.status === 'cancelled') return {ok: false, error: 'order_already_cancelled'};
  if (order.status === 'completed') return {ok: false, error: 'order_already_completed'};
  if (order.status !== 'in_progress' && order.status !== 'ready') {
    return {ok: false, error: 'order_not_in_progress'};
  }

  return succeed(
    {...order, status: 'cancelled'},
    order.items,
    {type: 'order_cancelled', actorId: command.actorId.trim(), at: command.at, reason},
  );
}

/**
 * A cancelled order can only return to production with a new reason, explicit
 * supervisor confirmation, and a full production-progress reset. This avoids
 * treating food prepared before cancellation as fresh after a reopen.
 */
export function reopenCancelledOrder(
  order: ProductionOrder,
  command: ReopenProductionCommand,
): ProductionFlowResult {
  const commandError = validateCommand(order, command);
  if (commandError) return commandError;
  if (order.status !== 'cancelled') return {ok: false, error: 'order_not_cancelled'};
  const reason = normalizedReason(command.reason);
  if (!reason) return {ok: false, error: 'cancellation_reason_required'};
  if (command.supervisorConfirmed !== true) {
    return {ok: false, error: 'reopen_requires_supervisor_confirmation'};
  }
  if (command.resetProgress !== true) {
    return {ok: false, error: 'reopen_requires_progress_reset'};
  }

  const resetItems = order.items.map((item) => ({
    ...item,
    steps: item.steps.map((step) => ({
      ...step,
      status: 'pending' as const,
      startedAt: null,
      completedAt: null,
    })),
  }));
  return succeed(
    {...order, status: 'in_progress'},
    resetItems,
    {
      type: 'order_reopened',
      actorId: command.actorId.trim(),
      at: command.at,
      reason,
      supervisorConfirmed: true,
      progressReset: true,
    },
  );
}

export function completeProductionOrder(
  order: ProductionOrder,
  command: ProductionCommand,
): ProductionFlowResult {
  const commandError = validateCommand(order, command);
  if (commandError) return commandError;
  if (order.status === 'completed') return {ok: false, error: 'order_already_completed'};
  if (order.status === 'cancelled') return {ok: false, error: 'order_already_cancelled'};
  if (order.status !== 'ready') return {ok: false, error: 'order_not_ready'};

  return succeed(
    {...order, status: 'completed'},
    order.items,
    {type: 'order_completed', actorId: command.actorId.trim(), at: command.at},
  );
}

function validateCommand(
  order: ProductionOrder,
  command: ProductionCommand,
): ProductionFlowResult | null {
  if (
    !isNonBlank(command.actorId) ||
    !isExplicitInstant(command.at) ||
    !Number.isInteger(command.expectedRevision) ||
    command.expectedRevision < 0
  ) {
    return {ok: false, error: 'invalid_command'};
  }
  if (command.expectedRevision !== order.revision) {
    return {
      ok: false,
      error: 'revision_conflict',
      expectedRevision: command.expectedRevision,
      actualRevision: order.revision,
    };
  }
  return null;
}

function requireInProgress(order: ProductionOrder): ProductionFlowResult | null {
  if (order.status === 'cancelled') return {ok: false, error: 'order_already_cancelled'};
  if (order.status === 'completed') return {ok: false, error: 'order_already_completed'};
  if (order.status !== 'in_progress') return {ok: false, error: 'order_not_in_progress'};
  return null;
}

function succeed(
  order: ProductionOrder,
  items: readonly ProductionItem[],
  event: ProductionEvent,
): ProductionFlowResult {
  return {
    ok: true,
    order: {
      ...order,
      revision: order.revision + 1,
      items,
      events: [...order.events, event],
    },
  };
}

function replaceItem(
  items: readonly ProductionItem[],
  index: number,
  replacement: ProductionItem,
): ProductionItem[] {
  return items.map((item, itemIndex) => (itemIndex === index ? replacement : item));
}

function firstIncompleteStep(item: ProductionItem): number {
  const nextIndex = item.steps.findIndex((step) => step.status !== 'completed');
  return nextIndex < 0 ? item.steps.length : nextIndex;
}

function isValidRoute(stations: readonly ProductionStation[]): boolean {
  if (!Array.isArray(stations) || stations.length === 0) return false;
  if (stations[stations.length - 1] !== 'expeditor') return false;
  if (!stations.every(isProductionStation)) return false;
  return new Set(stations).size === stations.length;
}

function isProductionStation(value: unknown): value is ProductionStation {
  return value === 'make_line' || value === 'oven' || value === 'expeditor';
}

function isProductionItemKind(value: unknown): value is ProductionItemKind {
  return (
    value === 'pizza' ||
    value === 'prepared_food' ||
    value === 'drink' ||
    value === 'dessert' ||
    value === 'other'
  );
}

function isNonBlank(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isExplicitInstant(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    return false;
  }
  return Number.isFinite(Date.parse(value));
}

function normalizedReason(reason: unknown): string | null {
  if (typeof reason !== 'string') return null;
  const normalized = reason.trim();
  return normalized.length > 0 ? normalized : null;
}
