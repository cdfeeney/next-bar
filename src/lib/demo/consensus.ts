/**
 * Group Favorites ("Where should we go?") computation.
 *
 * FOUNDER RULE, 2026-08-19: a bar is a GROUP FAVORITE when every participant
 * has a numeric personal score for it AND every one of those scores is at
 * least GROUP_FAVORITE_MIN_SCORE.
 *
 * There is no veto. This supersedes the PRD-v0.5 Q5 rule, under which one
 * `pass` tier removed a bar from BOTH lists for the whole group even when
 * everyone else loved it. A low score now simply fails the unanimity test,
 * exactly as a 7.5 does — nothing is hidden, the bar just is not a Group
 * Favorite.
 *
 * A missing score is neither approval nor a veto: it means "not YET". Scores
 * are read from `ratings.score` directly and a rating without one casts no
 * vote. The legacy loved/liked/pass tiers survive elsewhere during the V8
 * migration but are NOT the signal here, so no tier midpoint is imputed.
 *
 * A secondary "also consider" list carries the near-misses — bars that 2+ (but
 * not all) participants scored at or above the threshold — so a group with no
 * unanimous pick still has something to look at.
 *
 * Pure module: no storage, no React. `participants[].ratings` is whatever the
 * caller has on hand (demo friend data, the user's localStorage, etc.).
 */

import type { BarRating } from '@/types/ratings';

/**
 * The personal score every group member must meet or beat for a bar to be a
 * Group Favorite. Explicit product constant (founder, 2026-08-19) — do not
 * change it silently.
 */
export const GROUP_FAVORITE_MIN_SCORE = 8.0;

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
  /** The participant's numeric personal score. Never imputed. */
  score: number;
};

export type ConsensusEntry = {
  barId: string;
  /** Mean of participant scores (only those who scored it). */
  avgScore: number;
  /** How many participants scored this bar. */
  ratedBy: number;
  votes: ConsensusVote[];
};

export type ConsensusResult = {
  /** Group Favorites: every participant scored it >= the threshold. Avg desc. */
  overlap: ConsensusEntry[];
  /** Near-misses: 2+ (but not all) participants scored it >= the threshold. */
  alsoConsider: ConsensusEntry[];
};

/** A person the picker can select. `ratings` may legitimately be empty. */
export type SelectablePerson = {
  id: string;
  label: string;
  ratings: ReadonlyArray<BarRating>;
};

/**
 * Build the unanimity DENOMINATOR from the picker's selection.
 *
 * This lives here, beside the rule it feeds, so it can be tested as the SAME
 * code that ships — the lesson `deriveInviteeIds` was extracted for. The
 * defect it exists to prevent (panel, Codex MEDIUM; founder item 6) was that
 * the page built participants from the RATING-QUALIFIED people only, so a
 * selected circle member with zero ranked bars never entered `total`. Under
 * the founder rule "every member scored it >= 8.0", omitting them lets a bar
 * qualify without the score the rule demands of that person — the table's
 * "9.0 / no score = Not YET a Group Favorite" row, silently reversed.
 *
 * `unratedPeople` is a separate REQUIRED parameter rather than something the
 * caller may forget to concatenate: that omission is the whole bug.
 */
export function deriveConsensusParticipants({
  selected,
  you,
  ratedPeople,
  unratedPeople,
}: {
  /** Ids currently selected in the picker. */
  selected: ReadonlySet<string>;
  /** The signed-in user, or null when they have nothing to contribute. */
  you: SelectablePerson | null;
  /** Selectable people who have ranked at least one bar. */
  ratedPeople: ReadonlyArray<SelectablePerson>;
  /** Selectable people who have ranked NOTHING. They still count. */
  unratedPeople: ReadonlyArray<SelectablePerson>;
}): ConsensusParticipant[] {
  const list: ConsensusParticipant[] = [];
  if (you && selected.has(you.id)) {
    list.push({ id: you.id, label: you.label, ratings: you.ratings });
  }
  for (const p of [...ratedPeople, ...unratedPeople]) {
    if (selected.has(p.id)) {
      list.push({ id: p.id, label: p.label, ratings: p.ratings });
    }
  }
  return list;
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

/**
 * Compute the group's picks.
 *
 * Participants with fewer than 2 entries are still allowed (a user who only
 * rated one bar can still participate), but a result needs at least 2
 * participants to be meaningful — callers should gate the UI on that.
 */
export function computeConsensus(
  participants: ReadonlyArray<ConsensusParticipant>,
): ConsensusResult {
  // Map barId -> votes from every participant that SCORED it. A rating with
  // no numeric score casts no vote: that member has simply not scored the bar
  // yet, which is neither approval nor a veto.
  const byBar = new Map<string, ConsensusVote[]>();

  for (const p of participants) {
    for (const rating of p.ratings) {
      if (typeof rating.score !== 'number') continue;
      const votes = byBar.get(rating.barId) ?? [];
      votes.push({ id: p.id, label: p.label, score: rating.score });
      byBar.set(rating.barId, votes);
    }
  }

  const total = participants.length;
  const overlap: ConsensusEntry[] = [];
  const alsoConsider: ConsensusEntry[] = [];

  for (const [barId, votes] of byBar) {
    const favorable = votes.filter((v) => v.score >= GROUP_FAVORITE_MIN_SCORE);
    const isGroupFavorite = votes.length === total && favorable.length === total;
    if (!isGroupFavorite && favorable.length < 2) continue;

    const entry: ConsensusEntry = {
      barId,
      avgScore: round1(
        votes.reduce((sum, v) => sum + v.score, 0) / votes.length,
      ),
      ratedBy: votes.length,
      votes: votes.slice().sort((a, b) => b.score - a.score),
    };

    if (isGroupFavorite) overlap.push(entry);
    else alsoConsider.push(entry);
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
