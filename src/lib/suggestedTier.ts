/**
 * How many bars get the prominent "suggested" marker, given the size of the
 * cohort actually on screen (goal g-44007df6, acceptance criterion 3).
 *
 * Why this exists at all. Prominence used to be computed from the saved quiz
 * profile over the WHOLE catalog, so the glowing markers had nothing to do with
 * what the user had just filtered for. Feeding the active map intent in fixes
 * that — but it introduces a new failure the old code could not have: once
 * ranking runs over the FILTERED set, a hard filter can leave eight bars, and
 * marking the top ten of eight makes every marker glow. The tier would convey
 * least exactly when the user had narrowed hardest.
 *
 * So the count is a function of the cohort, with two guards:
 *
 *  - **A floor on the cohort.** Below `MIN_COHORT_FOR_TIERS` there is no
 *    suggested tier at all. With three bars on screen the user can see all of
 *    them; ranking them adds noise, not signal.
 *  - **A cap.** Never more than `SUGGESTED_CAP`, so a loose filter over ~975
 *    bars does not turn the map into a wall of accent dots.
 *
 * Between those, a strict minority (~30%), so "suggested" always means "fewer
 * than the rest" — the property that makes it readable at a glance.
 */

/** Matches the map's existing suggestion budget. */
export const SUGGESTED_CAP = 10;

/**
 * Below this many eligible bars, show no suggested tier. Four is the smallest
 * cohort where "some of these" is a distinction a person can act on.
 */
export const MIN_COHORT_FOR_TIERS = 4;

/** Share of the cohort to promote, before the cap and floor apply. */
const SHARE = 0.3;

/**
 * How far down the current ranking a previously-highlighted bar may fall and
 * still keep its slot, as a multiple of the budget. 3 means "top 3x the budget":
 * generous enough that ordinary re-rank jitter does not blink the highlights,
 * tight enough that a bar which genuinely stopped being a good answer loses the
 * slot without waiting for a hard filter to remove it.
 */
export const STABILITY_WINDOW = 3;

export function suggestedCount(cohortSize: number): number {
  if (!Number.isFinite(cohortSize) || cohortSize < MIN_COHORT_FOR_TIERS) return 0;
  return Math.min(SUGGESTED_CAP, Math.max(1, Math.floor(cohortSize * SHARE)));
}

/**
 * Keep the highlighted set STABLE as the user narrows.
 *
 * Ranking inside the filtered cohort fixed relevance but broke something the
 * old whole-catalog ranking got right for free, and two independent reviewers
 * found it: because the ranker re-solves against whatever the filter left, two
 * adjacent filter states can swap most of the highlighted pins. Concretely —
 * "Wine" leaves 32 bars and lights 10; adding one more axis drops the cohort to
 * 9 and the budget to 2, so ten glowing pins collapse to two that need not even
 * be among the previous ten. The user was tracking a pin; it goes dark and two
 * unrelated ones light up, for an action that should only ever REMOVE bars.
 *
 * So: prefer the bars that were already highlighted and still qualify, in their
 * existing order, then top up from the freshly-ranked cohort. Highlights then
 * only ever go dark as you narrow — monotone and legible — while a shortfall is
 * still filled so you are not stuck at two when ten would fit.
 *
 * @param previous ids highlighted before this filter change, in rank order
 * @param ranked   ids ranked within the CURRENT cohort, best first
 * @param budget   how many to highlight now (from `suggestedCount`)
 */
export function stableSuggestions(
  previous: readonly string[],
  ranked: readonly string[],
  budget: number,
  window: number = STABILITY_WINDOW,
): string[] {
  if (budget <= 0) return [];
  // Eligibility is a WINDOW near the top of the current ranking, not simple
  // cohort membership.
  //
  // The first version of this used `new Set(ranked)` — i.e. "still passes the
  // hard filter, at any rank". That over-corrected: once the caller started
  // ranking the whole cohort, a highlighted bar kept its slot no matter how far
  // its score fell, so it could glow indefinitely. The repro a reviewer built:
  // open /map before geolocation resolves, a bar 3 miles away scores into the
  // top on tag affinity alone and gets highlighted; geolocation lands, proximity
  // should now dominate — but the far bar is still a cohort member, so it holds
  // its slot ahead of genuinely closer bars until some unrelated hard filter
  // happens to exclude it.
  //
  // A window fixes both failure modes at once: a survivor is preserved while it
  // remains plausibly good, and drops out once it falls far enough down the new
  // ranking — no hard filter required.
  const eligible = new Set(ranked.slice(0, Math.max(budget, budget * window)));
  // Survivors keep their previous relative order — that ordering is what the
  // user's eye has already learned. Dedupe as we go: `previous` is caller-
  // supplied and a repeated id would otherwise consume two slots and render the
  // same marker twice.
  const have = new Set<string>();
  const kept: string[] = [];
  for (const id of previous) {
    if (kept.length === budget) break;
    if (eligible.has(id) && !have.has(id)) {
      kept.push(id);
      have.add(id);
    }
  }
  if (kept.length === budget) return kept;
  for (const id of ranked) {
    if (kept.length === budget) break;
    if (!have.has(id)) {
      kept.push(id);
      have.add(id);
    }
  }
  return kept;
}
