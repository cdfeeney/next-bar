/**
 * Pairwise comparison scoring — B0.2 rank-order model.
 *
 * Each rated bar belongs to a tier (loved / liked / pass) which maps to a
 * fixed band on the 0.0–10.0 scale. Within a tier, the user's pairwise
 * comparisons (A > B answers) produce a per-bar score in that band.
 *
 * Rank-order replay rules:
 *   - Replay same-tier comparisons into a deterministic ordered list.
 *   - Interpolate each compared bar's list index across the tier band.
 *   - A bar with no comparisons defaults to the band midpoint.
 *
 * Replaying the same transcript always reconstructs the same order and score.
 *
 * `applyComparison` replays the complete transcript so incremental updates
 * and a cold replay produce exactly the same result.
 *
 * Q2 decision: pairwise prompts are NOT fired for tier='pass' (Pass-vs-Pass
 * ordering is pointless). `pickComparisonTarget` returns null for Pass.
 */

import type { BarRating, PairwiseComparison, Rating } from '@/types/ratings';

export type Tier = Rating;

type Band = { readonly lo: number; readonly hi: number };

/** Fixed score bands agreed for the rank-order model. */
export const TIER_BANDS: Readonly<Record<Tier, Band>> = {
  loved: { lo: 8.0, hi: 10.0 },
  liked: { lo: 5.0, hi: 8.0 },
  pass: { lo: 0.0, hi: 5.0 },
};

/** @deprecated Rank-order replay no longer smooths transcript-derived scores. */
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

export type TierRankOrder = {
  /** Compared bars from highest to lowest within the tier. */
  orderedBarIds: string[];
  /** Score for every bar in the tier; unscored bars are at the midpoint. */
  scores: Map<string, number>;
  /** Number of valid same-tier transcript rows involving each bar. */
  comparisonCounts: Map<string, number>;
};

/**
 * Replay a tier's append-only transcript into a deterministic ordered list.
 *
 * A bar first seen against an existing peer is inserted immediately above or
 * below that peer. When both endpoints are already present, the endpoint that
 * entered the transcript later remains the insertion candidate and moves to
 * satisfy the latest answer. If they first appeared together, the winner is
 * the deterministic tiebreak candidate. Removing and reinserting one endpoint
 * keeps every uninvolved bar's relative order intact.
 */
export function buildRankOrderForTier(
  ratings: ReadonlyArray<BarRating>,
  comparisons: ReadonlyArray<PairwiseComparison>,
  tier: Tier,
): TierRankOrder {
  const inTier = new Set(
    ratings.filter((rating) => rating.rating === tier).map((rating) => rating.barId),
  );
  const orderedBarIds: string[] = [];
  const firstSeenAt = new Map<string, number>();
  const comparisonCounts = new Map<string, number>();
  for (const barId of inTier) comparisonCounts.set(barId, 0);

  for (const [transcriptIndex, comparison] of comparisons.entries()) {
    const winnerId = comparison.winnerBarId;
    const loserId = comparison.loserBarId;
    if (
      winnerId === loserId ||
      !inTier.has(winnerId) ||
      !inTier.has(loserId)
    ) {
      continue;
    }

    comparisonCounts.set(winnerId, (comparisonCounts.get(winnerId) ?? 0) + 1);
    comparisonCounts.set(loserId, (comparisonCounts.get(loserId) ?? 0) + 1);

    const winnerIndex = orderedBarIds.indexOf(winnerId);
    const loserIndex = orderedBarIds.indexOf(loserId);
    if (winnerIndex === -1 && loserIndex === -1) {
      firstSeenAt.set(winnerId, transcriptIndex);
      firstSeenAt.set(loserId, transcriptIndex);
      orderedBarIds.push(winnerId, loserId);
      continue;
    }
    if (winnerIndex === -1) {
      firstSeenAt.set(winnerId, transcriptIndex);
      orderedBarIds.splice(loserIndex, 0, winnerId);
      continue;
    }
    if (loserIndex === -1) {
      firstSeenAt.set(loserId, transcriptIndex);
      orderedBarIds.splice(winnerIndex + 1, 0, loserId);
      continue;
    }

    const winnerFirstSeen = firstSeenAt.get(winnerId) ?? -1;
    const loserFirstSeen = firstSeenAt.get(loserId) ?? -1;
    const movingId =
      winnerFirstSeen >= loserFirstSeen ? winnerId : loserId;
    const anchorId = movingId === winnerId ? loserId : winnerId;
    const movingWins = movingId === winnerId;

    orderedBarIds.splice(orderedBarIds.indexOf(movingId), 1);
    const anchorIndex = orderedBarIds.indexOf(anchorId);
    orderedBarIds.splice(anchorIndex + (movingWins ? 0 : 1), 0, movingId);
  }

  const band = TIER_BANDS[tier];
  const scores = new Map<string, number>();
  for (const barId of inTier) scores.set(barId, tierMidpoint(tier));
  if (orderedBarIds.length > 1) {
    const step = (band.hi - band.lo) / (orderedBarIds.length - 1);
    orderedBarIds.forEach((barId, index) => {
      scores.set(barId, roundScore(band.hi - index * step));
    });
  }

  return { orderedBarIds, scores, comparisonCounts };
}

/**
 * Compute the transcript-derived 0–10 score for every bar in `tier`.
 * Bars with no comparisons get the tier midpoint.
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
  return buildRankOrderForTier(ratings, comparisons, tier).scores;
}

/**
 * Apply a single new comparison to the current rating set and return the
 * updated BarRating[] with scores from the complete transcript replay.
 * Other tiers remain untouched to preserve referential equality.
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
  const scores = computeScoresForTier(ratings, combined, tier);

  return ratings.map((r) => {
    if (r.rating !== tier) return r;
    const score = scores.get(r.barId);
    return score === undefined ? r : { ...r, score };
  });
}

/**
 * Sort ratings for /rankings:
 *   - Tier precedence is absolute: Loved, then Liked, then Pass.
 *   - Within a tier, bars sort by score desc; unscored bars use the midpoint.
 *   - Equal effective scores fall through to recency.
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
      const tierDelta = tierRank[a.rating] - tierRank[b.rating];
      if (tierDelta !== 0) return tierDelta;

      const aScore = typeof a.score === 'number' ? a.score : tierMidpoint(a.rating);
      const bScore = typeof b.score === 'number' ? b.score : tierMidpoint(b.rating);
      const scoreDelta = bScore - aScore;
      if (scoreDelta !== 0) return scoreDelta;

      // Recency tiebreak within tier — newer first.
      return Date.parse(b.ratedAt) - Date.parse(a.ratedAt);
    });
}
