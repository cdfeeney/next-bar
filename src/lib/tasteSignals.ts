import type { Bar, VibeTag } from '@/types';

/**
 * tasteSignals — derive per-tag taste weights from a user's rating
 * history (g-7de10fce, matcher quality v1.1).
 *
 * Replaces the FLATTENED Loved-tag union weakness: a tag present in
 * five Loved bars carried exactly the same weight as one Loved once.
 * These builders are pure and deterministic — no ML, no persistence,
 * no network — and both outputs are consumed as OPTIONAL matcher
 * inputs, so omitting them reproduces today's behavior bit-for-bit.
 *
 * CAUTION RULES for the negative signal (spec: "cautious tag-level
 * negative preference"):
 *   - a tag only becomes an avoid-signal when it appears in at least
 *     MIN_PASSED_BARS_FOR_AVOID different Passed bars (one bad night
 *     at one dive is not a verdict on dives);
 *   - a tag the user has EVER Loved is never penalized, no matter how
 *     many Passed bars carry it (positive evidence wins);
 *   - the penalty magnitude applied downstream is a tie-breaker-scale
 *     nudge (NEG_TAG_PENALTY), never a filter — a strong vibe match
 *     still surfaces.
 */

export const MIN_PASSED_BARS_FOR_AVOID = 2;

/**
 * Weighted Loved affinity needs the same caution as the avoid signal:
 * with a SINGLE Loved bar, every one of its tags gets weight 1.0 and
 * the affinity term echo-chambers the hand around one venue — the
 * corpus measured a real top-5 entropy drop (2.137→2.055) in the
 * cold-start scenarios (GLM consult 2026-08-04, eval-confirmed).
 * Below this floor the builder returns an EMPTY map and the matcher
 * falls back to the flat-union affinity, i.e. exact pre-v1.1 behavior.
 */
export const MIN_LOVED_BARS_FOR_WEIGHTS = 2;

export type TagWeights = ReadonlyMap<VibeTag, number>;

/**
 * Frequency-weighted Loved-tag map: weight(tag) = share of the user's
 * Loved bars whose tag list includes it, in (0, 1]. Loving five
 * cocktail bars says more about "cocktail" than loving one.
 */
export function buildLovedTagWeights(
  lovedBarIds: readonly string[],
  bars: readonly Bar[],
): TagWeights {
  const loved = new Set(lovedBarIds);
  if (loved.size === 0) return new Map();
  const counts = new Map<VibeTag, number>();
  let lovedBarCount = 0;
  for (const bar of bars) {
    if (!loved.has(bar.id)) continue;
    lovedBarCount += 1;
    for (const tag of new Set(bar.tags)) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  if (lovedBarCount < MIN_LOVED_BARS_FOR_WEIGHTS) return new Map();
  const weights = new Map<VibeTag, number>();
  for (const [tag, count] of counts) {
    weights.set(tag, count / lovedBarCount);
  }
  return weights;
}

/**
 * Cautious avoid-tag map from Pass history. weight(tag) = share of the
 * user's Passed bars carrying it, but ONLY for tags that clear the
 * caution rules above. Empty map = no negative signal (the default for
 * light histories).
 */
export function buildAvoidTagWeights(
  passedBarIds: readonly string[],
  lovedBarIds: readonly string[],
  bars: readonly Bar[],
): TagWeights {
  const passed = new Set(passedBarIds);
  if (passed.size === 0) return new Map();

  const lovedTags = new Set<VibeTag>();
  const lovedSet = new Set(lovedBarIds);
  for (const bar of bars) {
    if (!lovedSet.has(bar.id)) continue;
    for (const tag of bar.tags) lovedTags.add(tag);
  }

  const counts = new Map<VibeTag, number>();
  let passedBarCount = 0;
  for (const bar of bars) {
    if (!passed.has(bar.id)) continue;
    passedBarCount += 1;
    for (const tag of new Set(bar.tags)) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  if (passedBarCount === 0) return new Map();

  const weights = new Map<VibeTag, number>();
  for (const [tag, count] of counts) {
    if (count < MIN_PASSED_BARS_FOR_AVOID) continue; // one bad night ≠ verdict
    if (lovedTags.has(tag)) continue; // positive evidence wins
    weights.set(tag, count / passedBarCount);
  }
  return weights;
}

/**
 * Weighted taste coverage in [0, 1]: how much of the user's
 * demonstrated (frequency-weighted) taste this bar's tags cover.
 * Extra bar tags are NOT penalized here — breadth policing is the
 * vibe (Jaccard) term's job; this term answers only "does this bar
 * look like what they keep loving?".
 */
export function weightedTagCoverage(
  barTags: readonly VibeTag[],
  weights: TagWeights,
): number {
  if (weights.size === 0) return 0;
  let total = 0;
  let matched = 0;
  const barSet = new Set(barTags);
  for (const [tag, weight] of weights) {
    total += weight;
    if (barSet.has(tag)) matched += weight;
  }
  if (total === 0) return 0;
  return matched / total;
}
