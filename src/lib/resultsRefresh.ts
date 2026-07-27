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
