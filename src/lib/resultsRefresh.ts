import type { Radius } from '@/types';
import { RADIUS_ANYWHERE, RADIUS_CAB } from '@/lib/constants';

/**
 * QA-6 "Run it again": the refresh affordance on the one results view.
 *
 * Refreshing excludes everything already shown this search, so the next
 * rank yields the NEXT batch. When a page comes back short the pool is
 * (about to be) exhausted — the history wraps to empty so refresh cycles
 * forever on small pools. A pool that is an EXACT multiple of the page
 * size can't be detected here (the last full page looks like any other);
 * the surface backstops that case by wrapping whenever the rank comes
 * back empty (WhereNextFlow's onRanked handler).
 *
 * Idempotent under repeat calls with the same page (review MED: two taps
 * faster than the post-commit onRanked effect must not double-append).
 */
/**
 * Operator fix (2026-07-27 morning): the home surfaces open on Walkable —
 * closest bars first — and only WIDEN one honest step at a time when the
 * current radius yields zero results (walking → cab → anywhere; the chip
 * state updates visibly). Never fires once the user has touched the
 * distance chips themselves.
 */
export function nextWiderRadius(prev: Radius): Radius {
  if (prev.kind === 'walking') return { kind: 'cab', maxMiles: RADIUS_CAB };
  if (prev.kind === 'cab') {
    return { kind: 'anywhere', maxMiles: RADIUS_ANYWHERE };
  }
  return prev;
}

/**
 * Widening detection for the fresh-hand rule (g-d3f8d912): a WIDER tap
 * keeps the shown history as a soft "seen" preference (arrangeWidenedHand),
 * while narrowing keeps the long-pinned clear-and-redeal semantics
 * (distance-widening.spec.ts pins the narrow path).
 */
const RADIUS_ORDER: Record<Radius['kind'], number> = {
  walking: 0,
  cab: 1,
  anywhere: 2,
};

export function isWiderRadius(next: Radius, prev: Radius): boolean {
  return RADIUS_ORDER[next.kind] > RADIUS_ORDER[prev.kind];
}

export function advanceShownIds(
  prevShown: readonly string[],
  lastRanked: readonly string[],
  resultsCount: number,
): readonly string[] {
  if (lastRanked.length < resultsCount) return [];
  if (lastRanked.some((id) => prevShown.includes(id))) {
    return prevShown;
  }
  return [...prevShown, ...lastRanked];
}
