import type { Bar, Coords, Neighborhood, Radius, VibeTag } from '@/types';
import { haversineMiles } from '@/lib/distance';

/**
 * findBarFilters — pure filtering logic for the /map "Find Bar" surface
 * (QA2). The chips above the map narrow WHICH BARS RENDER; all filters
 * are optional, and empty selections mean "everything" so the default
 * state is the full catalog.
 *
 * Semantics (drunk-simple):
 *  - Within a category: OR (any selected neighborhood / any selected vibe).
 *  - Across categories: AND (must pass every active category).
 *  - Distance needs a user location; without coords the radius filter is
 *    a no-op (the UI disables the chips, this is the defensive backstop).
 */

export type FindBarFilters = {
  readonly neighborhoods: readonly Neighborhood[];
  /** null = no distance restriction (the "Anywhere" default). */
  readonly radius: Radius | null;
  readonly vibes: readonly VibeTag[];
};

export const EMPTY_FILTERS: FindBarFilters = {
  neighborhoods: [],
  radius: null,
  vibes: [],
};

/** How many filters are active — drives the count badge + Clear button. */
export function countActiveFilters(filters: FindBarFilters): number {
  const radiusActive =
    filters.radius !== null && filters.radius.maxMiles !== null ? 1 : 0;
  return filters.neighborhoods.length + filters.vibes.length + radiusActive;
}

/** Immutable multi-select toggle: returns a NEW array with `value` added or removed. */
export function toggleSelection<T>(selected: readonly T[], value: T): T[] {
  return selected.includes(value)
    ? selected.filter((v) => v !== value)
    : [...selected, value];
}

function passesNeighborhood(bar: Bar, filters: FindBarFilters): boolean {
  if (filters.neighborhoods.length === 0) return true;
  return filters.neighborhoods.includes(bar.neighborhood);
}

function passesVibe(bar: Bar, filters: FindBarFilters): boolean {
  if (filters.vibes.length === 0) return true;
  return filters.vibes.some((tag) => bar.tags.includes(tag));
}

function passesRadius(
  bar: Bar,
  filters: FindBarFilters,
  userCoords: Coords | null,
): boolean {
  if (filters.radius === null || filters.radius.maxMiles === null) return true;
  // No location → distance can't be computed; don't hide anything.
  if (!userCoords) return true;
  const miles = haversineMiles(userCoords, { lat: bar.lat, lng: bar.lng });
  return miles <= filters.radius.maxMiles;
}

/** Narrows the bar list to those passing every active filter (pure — never mutates). */
export function filterBars(
  bars: readonly Bar[],
  filters: FindBarFilters,
  userCoords: Coords | null,
): Bar[] {
  return bars.filter(
    (bar) =>
      passesNeighborhood(bar, filters) &&
      passesVibe(bar, filters) &&
      passesRadius(bar, filters, userCoords),
  );
}
