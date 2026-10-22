/**
 * Pure, database-independent location dispatch for French restaurant postal
 * codes. This module deliberately does not geocode addresses or infer a store
 * from distance. Service areas and pickup suggestions must be configured by
 * the tenant.
 */

export type DispatchCapacity = {
  /** Current normalized production load, in the same units as maxLoad. */
  currentLoad: number;
  /** Maximum load the location is willing to accept right now. */
  maxLoad: number;
};

export type DispatchLocation = {
  id: string;
  name: string;
  enabled: boolean;
  isOpen: boolean;
  isAcceptingOrders: boolean;
  /** Configured French postal codes served for delivery. */
  deliveryPostalCodes: readonly string[];
  /** Exact location postal code, used only to suggest a pickup site. */
  pickupPostalCode?: string | null;
  /** Higher values break ties between locations with equal utilization. */
  routingPriority?: number;
  capacity: DispatchCapacity;
};

export type DispatchFailureReason =
  | 'location_disabled'
  | 'location_closed'
  | 'not_accepting_orders'
  | 'at_capacity'
  | 'capacity_unconfigured'
  | 'delivery_zone_unconfigured'
  | 'outside_service_area'
  | 'duplicate_location_id'
  | 'unknown_location';

export type LocationDecision = {
  locationId: string;
  locationName: string;
  eligible: boolean;
  reasons: readonly DispatchFailureReason[];
  /** Null when the location has invalid or missing capacity configuration. */
  utilization: number | null;
  routingPriority: number;
};

export type DeliveryRoutingRationale =
  | 'only_eligible_location'
  | 'lowest_load_ratio'
  | 'routing_priority_tiebreak'
  | 'stable_location_id_tiebreak';

export type DeliveryRoutingResult =
  | {
      status: 'invalid_input';
      postalCode: null;
      reasons: readonly ['invalid_postal_code'];
      candidates: readonly [];
    }
  | {
      status: 'unavailable';
      postalCode: string;
      reasons: readonly ['no_eligible_location'];
      candidates: readonly LocationDecision[];
    }
  | {
      status: 'routed';
      postalCode: string;
      selected: LocationDecision;
      rationale: DeliveryRoutingRationale;
      candidates: readonly LocationDecision[];
    };

export type PickupRoutingResult =
  | {
      /** A suggestion is never an implicit pickup-location confirmation. */
      status: 'selection_required';
      postalCode: string | null;
      postalCodeIssue: 'invalid_postal_code' | null;
      suggestions: readonly LocationDecision[];
    }
  | {
      status: 'confirmed';
      postalCode: string | null;
      selected: LocationDecision;
    }
  | {
      status: 'unavailable';
      postalCode: string | null;
      selected: LocationDecision | null;
      reasons: readonly DispatchFailureReason[];
    };

/** Normalize a France-only postal code without converting it to a number. */
export function normalizeFrenchPostalCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return /^\d{5}$/.test(normalized) ? normalized : null;
}

/**
 * Recommend an eligible delivery location. If zones overlap, choose the
 * location with the lowest capacity utilization; routingPriority and then the
 * stable location id break exact ties. A recommendation is not a reservation:
 * the caller must re-check capacity when it accepts/persists the order.
 */
export function routeDelivery(
  customerPostalCode: string,
  locations: readonly DispatchLocation[],
): DeliveryRoutingResult {
  const postalCode = normalizeFrenchPostalCode(customerPostalCode);
  if (!postalCode) {
    return {
      status: 'invalid_input',
      postalCode: null,
      reasons: ['invalid_postal_code'],
      candidates: [],
    };
  }

  const duplicateIds = findDuplicateIds(locations);
  const candidates = locations
    .map((location) => {
      const configuredCodes = location.deliveryPostalCodes
        .map(normalizeFrenchPostalCode)
        .filter((code): code is string => code !== null);
      const reasons = operationalReasons(location);

      if (configuredCodes.length === 0) {
        reasons.push('delivery_zone_unconfigured');
      } else if (!configuredCodes.includes(postalCode)) {
        reasons.push('outside_service_area');
      }
      if (duplicateIds.has(location.id)) reasons.push('duplicate_location_id');

      return makeDecision(location, reasons);
    })
    .sort((a, b) => compareIds(a.locationId, b.locationId));

  const eligible = candidates.filter((candidate) => candidate.eligible);
  if (eligible.length === 0) {
    return {
      status: 'unavailable',
      postalCode,
      reasons: ['no_eligible_location'],
      candidates,
    };
  }

  const ranked = [...eligible].sort(compareRecommendation);
  const selected = ranked[0];
  const rationale = getRationale(ranked);
  return {status: 'routed', postalCode, selected, rationale, candidates};
}

/**
 * Confirm a user-selected pickup location. If no location id was explicitly
 * selected, an exact postal-code match may produce suggestions, but never a
 * confirmed route. Postal codes are not used to guess the nearest location.
 */
export function routePickup(
  selectedLocationId: string | null | undefined,
  customerPostalCode: string | null | undefined,
  locations: readonly DispatchLocation[],
): PickupRoutingResult {
  const normalizedPostalCode = normalizeFrenchPostalCode(customerPostalCode);
  const postalCodeIssue =
    customerPostalCode != null && customerPostalCode.trim() !== '' && !normalizedPostalCode
      ? 'invalid_postal_code'
      : null;
  const postalCode = normalizedPostalCode;
  const selection = selectedLocationId?.trim();

  if (!selection) {
    const duplicateIds = findDuplicateIds(locations);
    const suggestions = postalCode
      ? locations
          .filter(
            (location) =>
              normalizeFrenchPostalCode(location.pickupPostalCode) === postalCode,
          )
          .map((location) => {
            const reasons = operationalReasons(location);
            if (duplicateIds.has(location.id)) reasons.push('duplicate_location_id');
            return makeDecision(location, reasons);
          })
          .sort(compareSuggestion)
      : [];

    return {status: 'selection_required', postalCode, postalCodeIssue, suggestions};
  }

  const matchingLocations = locations.filter((location) => location.id === selection);
  if (matchingLocations.length !== 1) {
    const selected = matchingLocations[0];
    if (!selected) {
      return {
        status: 'unavailable',
        postalCode,
        selected: null,
        reasons: ['unknown_location'],
      };
    }
    const decision = makeDecision(selected, ['duplicate_location_id']);
    return {
      status: 'unavailable',
      postalCode,
      selected: decision,
      reasons: decision.reasons,
    };
  }

  const location = matchingLocations[0];
  const decision = makeDecision(location, operationalReasons(location));
  if (!decision.eligible) {
    return {
      status: 'unavailable',
      postalCode,
      selected: decision,
      reasons: decision.reasons,
    };
  }

  return {status: 'confirmed', postalCode, selected: decision};
}

function operationalReasons(location: DispatchLocation): DispatchFailureReason[] {
  const reasons: DispatchFailureReason[] = [];
  if (!location.enabled) reasons.push('location_disabled');
  if (!location.isOpen) reasons.push('location_closed');
  if (!location.isAcceptingOrders) reasons.push('not_accepting_orders');

  const {currentLoad, maxLoad} = location.capacity;
  if (
    !Number.isFinite(currentLoad) ||
    !Number.isFinite(maxLoad) ||
    currentLoad < 0 ||
    maxLoad <= 0
  ) {
    reasons.push('capacity_unconfigured');
  } else if (currentLoad >= maxLoad) {
    reasons.push('at_capacity');
  }

  return reasons;
}

function makeDecision(
  location: DispatchLocation,
  reasons: readonly DispatchFailureReason[],
): LocationDecision {
  const capacityIsValid =
    Number.isFinite(location.capacity.currentLoad) &&
    Number.isFinite(location.capacity.maxLoad) &&
    location.capacity.currentLoad >= 0 &&
    location.capacity.maxLoad > 0;
  const configuredPriority = location.routingPriority ?? 0;

  return {
    locationId: location.id,
    locationName: location.name,
    eligible: reasons.length === 0,
    reasons: [...reasons],
    utilization: capacityIsValid
      ? location.capacity.currentLoad / location.capacity.maxLoad
      : null,
    routingPriority: Number.isFinite(configuredPriority) ? configuredPriority : 0,
  };
}

function compareRecommendation(a: LocationDecision, b: LocationDecision): number {
  const loadDifference = (a.utilization ?? 1) - (b.utilization ?? 1);
  if (loadDifference !== 0) return loadDifference;
  if (a.routingPriority !== b.routingPriority) {
    return b.routingPriority - a.routingPriority;
  }
  return compareIds(a.locationId, b.locationId);
}

function compareSuggestion(a: LocationDecision, b: LocationDecision): number {
  if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
  if (a.eligible) return compareRecommendation(a, b);
  return compareIds(a.locationId, b.locationId);
}

function getRationale(
  ranked: readonly LocationDecision[],
): DeliveryRoutingRationale {
  if (ranked.length === 1) return 'only_eligible_location';

  const selected = ranked[0];
  const other = ranked[1];
  if (selected.utilization !== other.utilization) return 'lowest_load_ratio';
  if (selected.routingPriority !== other.routingPriority) {
    return 'routing_priority_tiebreak';
  }
  return 'stable_location_id_tiebreak';
}

function findDuplicateIds(locations: readonly DispatchLocation[]): Set<string> {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const location of locations) {
    if (seen.has(location.id)) duplicates.add(location.id);
    seen.add(location.id);
  }
  return duplicates;
}

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
