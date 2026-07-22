/**
 * Consensus ("Where should we go?") computation — PRD-v0.5 §G5 / §D6.
 *
 * Given 2+ participants (friends and/or the signed-in user), find the bars
 * the group should go to together.
 *
 * D6 decision: strict intersection for the primary list — only bars EVERY
 * participant has rated, ranked by the group's average score. Q5 decision:
 * a bar any participant Passed is excluded outright (a hard veto), even if
 * everyone else loved it — a group pick has to be one nobody objects to.
 *
 * A secondary "also consider" list (loose union) surfaces bars that 2+ —
 * but not all — participants rated highly, so the empty-state for a group
 * with no perfect overlap still has something to offer.
 *
 * Pure module: no storage, no React. `participants[].ratings` is whatever
 * the caller has on hand (demo friend data, the user's localStorage, etc.).
 */

import type { BarRating, Rating } from '@/types/ratings';

export type ConsensusParticipant = {
  /** Stable id — handle for friends, 'you' for the signed-in user. */
  id: string;
  /** Display label shown in attribution chips. */
  label: string;
  ratings: ReadonlyArray<BarRating>;
};

export type ConsensusVote = {
  id: string;
  label: string;
  rating: Rating;
  /** Personal score if known; falls back to the tier midpoint. */
  score: number;
};

export type ConsensusEntry = {
  barId: string;
  /** Mean of participant scores (only those who rated it). */
  avgScore: number;
  /** How many participants rated this bar. */
  ratedBy: number;
  votes: ConsensusVote[];
};

export type ConsensusResult = {
  /** Bars every participant rated, none vetoed (Passed). Ranked by avg desc. */
  overlap: ConsensusEntry[];
  /** Bars 2+ (not all) participants liked/loved, none vetoed. Ranked by avg. */
  alsoConsider: ConsensusEntry[];
};

// Tier midpoints, duplicated as plain numbers to keep this module free of a
// dependency cycle with pairwise.ts. Kept in sync with TIER_BANDS there.
const TIER_MIDPOINT: Record<Rating, number> = {
  loved: 9.0,
  liked: 6.45,
  pass: 2.45,
};

function scoreOf(rating: BarRating): number {
  return typeof rating.score === 'number'
    ? rating.score
    : TIER_MIDPOINT[rating.rating];
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

/**
 * Compute the group's consensus picks.
 *
 * Participants with fewer than 2 entries are still allowed (a user who only
 * rated one bar can still participate), but a result needs at least 2
 * participants to be meaningful — callers should gate the UI on that.
 */
export function computeConsensus(
  participants: ReadonlyArray<ConsensusParticipant>,
): ConsensusResult {
  // Map barId -> votes from every participant that rated it.
  const byBar = new Map<string, ConsensusVote[]>();
  // Track vetoes: a bar any participant Passed is removed from both lists.
  const vetoed = new Set<string>();

  for (const p of participants) {
    for (const rating of p.ratings) {
      if (rating.rating === 'pass') {
        vetoed.add(rating.barId);
      }
      const votes = byBar.get(rating.barId) ?? [];
      votes.push({
        id: p.id,
        label: p.label,
        rating: rating.rating,
        score: scoreOf(rating),
      });
      byBar.set(rating.barId, votes);
    }
  }

  const total = participants.length;
  const overlap: ConsensusEntry[] = [];
  const alsoConsider: ConsensusEntry[] = [];

  for (const [barId, allVotes] of byBar) {
    if (vetoed.has(barId)) continue;
    // Drop pass votes from the displayed attribution (there are none left
    // after the veto filter, but be explicit).
    const votes = allVotes.filter((v) => v.rating !== 'pass');
    if (votes.length === 0) continue;

    const avgScore = round1(
      votes.reduce((sum, v) => sum + v.score, 0) / votes.length,
    );
    const entry: ConsensusEntry = {
      barId,
      avgScore,
      ratedBy: votes.length,
      votes: votes.slice().sort((a, b) => b.score - a.score),
    };

    if (votes.length === total) {
      overlap.push(entry);
    } else if (votes.length >= 2) {
      alsoConsider.push(entry);
    }
  }

  const byAvgDesc = (a: ConsensusEntry, b: ConsensusEntry): number => {
    if (b.avgScore !== a.avgScore) return b.avgScore - a.avgScore;
    if (b.ratedBy !== a.ratedBy) return b.ratedBy - a.ratedBy;
    return a.barId.localeCompare(b.barId);
  };

  overlap.sort(byAvgDesc);
  alsoConsider.sort(byAvgDesc);

  return { overlap, alsoConsider };
}
