/**
 * Pairwise comparison scoring — v0.5.1 Beli-aggregate model.
 *
 * Each rated bar belongs to a tier (loved / liked / pass) which maps to a
 * fixed band on the 0.0–10.0 scale. Within a tier, the user's pairwise
 * comparisons (A > B answers) produce a per-bar score in that band.
 *
 * The math (PRD-v0.5 §D2 option (c) "Beli aggregate"):
 *   - For each bar in tier T, compute its winrate among comparisons where
 *     both bars are in T.
 *   - score = band.lo + winrate × (band.hi − band.lo).
 *   - A bar with no comparisons defaults to the band midpoint.
 *
 * This is mathematically equivalent to PRD's "average position rescaled to
 * tier band": average position in a 2-bar comparison is `1 + lossrate`, so
 * `1 − lossrate = winrate` and the rescale collapses to the same formula.
 *
 * R8 smoothing — "don't apply >1.0 score change per pairwise event" — is
 * enforced by `applyComparison`, which clamps the per-event delta. Use
 * `computeScoresForTier` when you want the ideal final score; use
 * `applyComparison` when you want the smoothed step shown to the user
 * immediately after answering a comparison.
 *
 * Q2 decision: pairwise prompts are NOT fired for tier='pass' (Pass-vs-Pass
 * ordering is pointless). `pickComparisonTarget` returns null for Pass.
 */

import type { BarRating, PairwiseComparison, Rating } from '@/types/ratings';

export type Tier = Rating;

type Band = { readonly lo: number; readonly hi: number };

/**
 * Score bands per tier. Loved sits above Liked sits above Pass, with a small
 * gap between Liked.hi (7.9) and Loved.lo (8.0) so the tiers stay visually
 * separable on /rankings. Pass tops out at 4.9 for the same reason.
 */
export const TIER_BANDS: Readonly<Record<Tier, Band>> = {
  loved: { lo: 8.0, hi: 10.0 },
  liked: { lo: 5.0, hi: 7.9 },
  pass: { lo: 0.0, hi: 4.9 },
};

/** Maximum |delta| applied to a single bar's score per pairwise event. */
export const MAX_DELTA_PER_EVENT = 1.0;

/** Quantize a 0–10 score to one decimal place, matching what /rankings shows. */
export function roundScore(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Midpoint of a tier's band — the default score before any comparisons.
 * Exposed so call sites can show a "tentative" score for newly-rated bars.
 */
export function tierMidpoint(tier: Tier): number {
  const b = TIER_BANDS[tier];
  return roundScore((b.lo + b.hi) / 2);
}

/**
 * Clamp a value into [lo, hi]. Inclusive on both ends.
 */
function clamp(value: number, lo: number, hi: number): number {
  if (value < lo) return lo;
  if (value > hi) return hi;
  return value;
}

/**
 * Pick the bar the user should be asked to compare against after rating
 * `justRatedBarId` into `tier`.
 *
 * Returns null when:
 *   - tier is 'pass' (Q2 — no Pass-vs-Pass ordering)
 *   - no other rated bar exists in this tier
 *
 * Selection rule: among same-tier peers (excluding the just-rated bar),
 * prefer those with the fewest existing comparisons so the comparison
 * graph stays balanced. Random tiebreak so the same neighbor isn't asked
 * about repeatedly.
 *
 * `random` is injectable for deterministic tests; defaults to Math.random.
 */
export function pickComparisonTarget(
  ratings: ReadonlyArray<BarRating>,
  comparisons: ReadonlyArray<PairwiseComparison>,
  justRatedBarId: string,
  tier: Tier,
  random: () => number = Math.random,
): string | null {
  if (tier === 'pass') return null;

  const peers = ratings.filter(
    (r) => r.rating === tier && r.barId !== justRatedBarId,
  );
  if (peers.length === 0) return null;

  const counts = new Map<string, number>();
  for (const c of comparisons) {
    counts.set(c.winnerBarId, (counts.get(c.winnerBarId) ?? 0) + 1);
    counts.set(c.loserBarId, (counts.get(c.loserBarId) ?? 0) + 1);
  }

  let minCount = Infinity;
  for (const peer of peers) {
    const count = counts.get(peer.barId) ?? 0;
    if (count < minCount) minCount = count;
  }

  const eligible = peers.filter(
    (peer) => (counts.get(peer.barId) ?? 0) === minCount,
  );

  const idx = Math.floor(random() * eligible.length);
  return eligible[idx]?.barId ?? null;
}

/**
 * Compute the "ideal" 0–10 score for every bar in `tier`, ignoring any
 * R8 smoothing. Bars with no comparisons get the tier midpoint.
 *
 * Only comparisons where BOTH endpoints are in the requested tier count
 * — a Loved-vs-Liked comparison (if one ever happened) is irrelevant to
 * Loved's internal ordering.
 */
export function computeScoresForTier(
  ratings: ReadonlyArray<BarRating>,
  comparisons: ReadonlyArray<PairwiseComparison>,
  tier: Tier,
): Map<string, number> {
  const band = TIER_BANDS[tier];
  const span = band.hi - band.lo;
  const inTier = new Set(
    ratings.filter((r) => r.rating === tier).map((r) => r.barId),
  );

  const wins = new Map<string, number>();
  const losses = new Map<string, number>();
  for (const c of comparisons) {
    if (!inTier.has(c.winnerBarId) || !inTier.has(c.loserBarId)) continue;
    wins.set(c.winnerBarId, (wins.get(c.winnerBarId) ?? 0) + 1);
    losses.set(c.loserBarId, (losses.get(c.loserBarId) ?? 0) + 1);
  }

  const midpoint = (band.lo + band.hi) / 2;
  const result = new Map<string, number>();
  for (const barId of inTier) {
    const w = wins.get(barId) ?? 0;
    const l = losses.get(barId) ?? 0;
    const total = w + l;
    if (total === 0) {
      result.set(barId, roundScore(midpoint));
      continue;
    }
    const winrate = w / total;
    result.set(barId, roundScore(band.lo + winrate * span));
  }
  return result;
}

/**
 * Apply a single new comparison to the current rating set and return the
 * updated BarRating[] with smoothed scores.
 *
 * "Smoothed" per R8: the score for each affected bar moves toward its new
 * ideal but by at most MAX_DELTA_PER_EVENT in this step. Unaffected bars
 * (different tier, or not involved in the comparison's tier graph) are
 * returned untouched — preserves referential equality where possible.
 *
 * Invariant: never mutates input. Returns a fresh BarRating[].
 */
export function applyComparison(
  ratings: ReadonlyArray<BarRating>,
  priorComparisons: ReadonlyArray<PairwiseComparison>,
  newComparison: PairwiseComparison,
): BarRating[] {
  const winner = ratings.find((r) => r.barId === newComparison.winnerBarId);
  const loser = ratings.find((r) => r.barId === newComparison.loserBarId);

  // If either bar isn't rated, the comparison is a no-op on scores. This
  // shouldn't happen via the UI but we don't trust callers blindly.
  if (!winner || !loser) return ratings.slice();
  // Mixed-tier comparisons don't affect either bar's tier-internal score.
  if (winner.rating !== loser.rating) return ratings.slice();

  const tier = winner.rating;
  const combined: PairwiseComparison[] = [...priorComparisons, newComparison];
  const idealScores = computeScoresForTier(ratings, combined, tier);

  return ratings.map((r) => {
    if (r.rating !== tier) return r;
    const ideal = idealScores.get(r.barId);
    if (ideal === undefined) return r;

    // Bars in this tier that weren't part of this comparison still have
    // their ideal score updated by the new graph state — but smoothing only
    // applies to the two bars actually involved in the comparison. The
    // others move freely so passive recompute doesn't lag behind.
    const involved =
      r.barId === newComparison.winnerBarId ||
      r.barId === newComparison.loserBarId;

    if (!involved) return { ...r, score: ideal };

    const prev = typeof r.score === 'number' ? r.score : tierMidpoint(tier);
    const delta = clamp(ideal - prev, -MAX_DELTA_PER_EVENT, MAX_DELTA_PER_EVENT);
    return { ...r, score: roundScore(prev + delta) };
  });
}

/**
 * Sort ratings for /rankings:
 *   - Bars with a score sort by score desc.
 *   - Bars without a score fall through to tier-then-recency (current v0.4
 *     behavior) and rank below all scored bars in the same tier.
 *
 * Returns a new array; does not mutate input.
 */
export function sortRatingsByScore(
  ratings: ReadonlyArray<BarRating>,
): BarRating[] {
  const tierRank: Record<Tier, number> = { loved: 0, liked: 1, pass: 2 };
  return ratings
    .slice()
    .sort((a, b) => {
      const aHasScore = typeof a.score === 'number';
      const bHasScore = typeof b.score === 'number';

      if (aHasScore && bHasScore) return (b.score as number) - (a.score as number);
      if (aHasScore) return -1;
      if (bHasScore) return 1;

      const tierDelta = tierRank[a.rating] - tierRank[b.rating];
      if (tierDelta !== 0) return tierDelta;
      // Recency tiebreak within tier — newer first.
      return Date.parse(b.ratedAt) - Date.parse(a.ratedAt);
    });
}
