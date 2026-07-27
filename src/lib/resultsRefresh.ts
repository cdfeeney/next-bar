/**
 * QA-6 "Run it again": the refresh affordance on the one results view.
 *
 * Refreshing excludes everything already shown this search, so the next
 * rank yields the NEXT batch. When a page comes back short the pool is
 * (about to be) exhausted — the history wraps to empty instead of ever
 * ranking into a blank list, so refresh cycles forever on small pools.
 */
export function advanceShownIds(
  prevShown: readonly string[],
  lastRanked: readonly string[],
  resultsCount: number,
): string[] {
  if (lastRanked.length < resultsCount) return [];
  return [...prevShown, ...lastRanked];
}
