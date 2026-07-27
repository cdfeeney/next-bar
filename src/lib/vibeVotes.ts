import type { VibeTag } from '@/types';

/**
 * UX-E "Tonight's vibe" nightly poll — pure logic (design:
 * docs/UXE-VIBE-VOTE-DESIGN.md). Server surface is migration 0017
 * (AUTHORED, dark until applied).
 */

/**
 * The curated poll options — a glanceable 8, not the full 33-tag
 * vocabulary (minimum-reading principle; the axis surface stays the
 * personal-search tool). Server stores any tag-shaped text, so this set
 * can evolve without a migration.
 */
export const VOTE_OPTIONS: readonly VibeTag[] = [
  'dance',
  'live',
  'chill',
  'dive',
  'cocktail',
  'beer',
  'rooftop',
  'speakeasy',
];

/** One circle member's vote for a night. */
export type VibeVote = {
  userId: string;
  handle: string | null;
  displayName: string | null;
  tag: string;
  /** ISO timestamp of the (latest) cast — the server updates it on a
   *  re-vote, so tie-breaks read "who settled on this vibe first". */
  createdAt: string;
};

export type VibeTally = {
  /** tag → vote count, insertion-ordered by first appearance. */
  counts: ReadonlyMap<string, number>;
  /** Winning tag, or null when there are no votes. Ties break to the tag
   *  whose earliest vote landed first — deterministic across renders and
   *  devices (a jittering winner reads as broken). */
  winner: string | null;
};

export function tallyVibeVotes(votes: readonly VibeVote[]): VibeTally {
  const counts = new Map<string, number>();
  const earliest = new Map<string, string>();
  for (const v of votes) {
    counts.set(v.tag, (counts.get(v.tag) ?? 0) + 1);
    const prior = earliest.get(v.tag);
    if (prior === undefined || v.createdAt < prior) {
      earliest.set(v.tag, v.createdAt);
    }
  }
  let winner: string | null = null;
  for (const [tag, count] of counts) {
    if (winner === null) {
      winner = tag;
      continue;
    }
    const winnerCount = counts.get(winner) ?? 0;
    if (
      count > winnerCount ||
      (count === winnerCount &&
        (earliest.get(tag) ?? '') < (earliest.get(winner) ?? ''))
    ) {
      winner = tag;
    }
  }
  return { counts, winner };
}

/**
 * Seed Group Favorites with the winning vibe: entries whose bar carries
 * the winner tag float above those that don't, original order preserved
 * within each partition (stable — no score surgery, fully reversible).
 */
export function boostByWinningVibe<T>(
  entries: readonly T[],
  winner: string | null,
  tagsOf: (entry: T) => readonly string[],
): T[] {
  if (winner === null) return [...entries];
  const matching: T[] = [];
  const rest: T[] = [];
  for (const entry of entries) {
    if (tagsOf(entry).includes(winner)) {
      matching.push(entry);
    } else {
      rest.push(entry);
    }
  }
  return [...matching, ...rest];
}
