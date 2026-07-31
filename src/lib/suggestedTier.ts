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

export function suggestedCount(cohortSize: number): number {
  if (!Number.isFinite(cohortSize) || cohortSize < MIN_COHORT_FOR_TIERS) return 0;
  return Math.min(SUGGESTED_CAP, Math.max(1, Math.floor(cohortSize * SHARE)));
}
