import type { Bar, Coords, Neighborhood, Radius, VibeTag } from '@/types';
import { haversineMiles } from '@/lib/distance';
import { groupByAxis } from '@/lib/vibeAxes';

/**
 * findBarFilters — pure filtering logic for the /map "Find Bar" surface
 * (QA2). The chips above the map narrow WHICH BARS RENDER; all filters
 * are optional, and empty selections mean "everything" so the default
 * state is the full catalog.
 *
 * Semantics (drunk-simple):
 *  - Within a category: OR (any selected neighborhood).
 *  - **Vibes: OR within one AXIS, AND across axes** — so "club" restricts to
 *    clubs, and "club + dance + house" requires all three dimensions, while
 *    "wine + beer" (one axis) still means either. See passesVibe.
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

/**
 * OR within one axis, AND across axes.
 *
 * This used to be one flat `.some()` over every selected vibe, which meant
 * asking for a **club** also returned anything merely tagged `dance` or
 * `house` — adding a filter made the result set *wider*, the opposite of what
 * a filter is for. The operator's requirement is the fix: "Club must reliably
 * restrict results to clubs; Club + Dancing + House must require those
 * selected dimensions."
 *
 * The taxonomy already supports this without a new data shape, because `club`
 * (Setting), `dance` (Energy) and `house` (Sound) are three different axes —
 * so requiring every non-empty axis to match reads as "a club, that is
 * dance-y, playing house", while `wine + beer` stays one axis and keeps
 * meaning "either".
 */
function passesVibe(bar: Bar, filters: FindBarFilters): boolean {
  if (filters.vibes.length === 0) return true;
  // Only axes the user actually picked appear here, so an untouched axis
  // imposes no constraint — see groupByAxis on why absent beats empty.
  for (const tagsInAxis of groupByAxis(filters.vibes).values()) {
    if (!tagsInAxis.some((tag) => bar.tags.includes(tag))) return false;
  }
  return true;
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
