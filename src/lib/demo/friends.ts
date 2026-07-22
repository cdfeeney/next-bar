/**
 * Seeded "curator" friends for the demo / social layer.
 *
 * PRD-v0.5 R1 mitigation: the first real user has zero friends, so the
 * Friends tab would be dead-empty. We seed a small set of curator profiles
 * (distinct bar personalities) that everyone is auto-suggested to follow.
 * These are also what makes the Friends + Consensus demo legible to a client
 * without anyone having to hand-rate a dozen bars first.
 *
 * Scores follow the same tier bands as the real pairwise model
 * (loved 8.0–10.0, liked 5.0–7.9, pass 0–4.9 — see src/lib/pairwise.ts) so
 * a friend's list is indistinguishable from one a user would actually build.
 *
 * Bar IDs reference the static dataset in src/lib/bars.ts. Keep them in sync:
 * a typo here surfaces as a silently-dropped row, not a crash.
 */

import type { BarRating } from '@/types/ratings';

export type DemoFriend = {
  /** URL-safe handle, no leading @ — used in /u/[handle]. */
  handle: string;
  displayName: string;
  /** 1–2 letters shown in the avatar chip. */
  initials: string;
  /** Short vibe label, mirrors the quiz archetypes. */
  archetype: string;
  /** One-line bio. */
  blurb: string;
  /** Followers the friend reports — purely cosmetic social proof. */
  followers: number;
  ratings: BarRating[];
};

// Seeded timestamps are fixed (not Date.now()) so the data is deterministic
// across renders, tests, and snapshot diffs.
const r = (barId: string, score: number, ratedAt: string): BarRating => ({
  barId,
  rating: score >= 8.0 ? 'loved' : score >= 5.0 ? 'liked' : 'pass',
  ratedAt,
  score,
});

export const demoFriends: DemoFriend[] = [
  {
    handle: 'maya',
    displayName: 'Maya R.',
    initials: 'MR',
    archetype: 'Cocktail Romantic',
    blurb: 'Will cross town for a perfect Negroni and a quiet corner.',
    followers: 214,
    ratings: [
      r('death-and-co', 9.4, '2026-05-30T02:10:00.000Z'),
      r('employees-only', 9.1, '2026-05-22T03:05:00.000Z'),
      r('bemelmans-bar', 8.9, '2026-05-10T01:40:00.000Z'),
      r('attaboy', 8.6, '2026-05-18T03:30:00.000Z'),
      r('little-branch', 8.3, '2026-04-28T02:55:00.000Z'),
      r('buvette', 7.6, '2026-05-02T23:20:00.000Z'),
      r('pdt', 8.1, '2026-04-19T02:15:00.000Z'),
      r('holiday-cocktail-lounge', 6.8, '2026-05-14T02:00:00.000Z'),
      r('the-frying-pan', 4.2, '2026-05-25T22:45:00.000Z'),
    ],
  },
  {
    handle: 'dev',
    displayName: 'Dev P.',
    initials: 'DP',
    archetype: 'Dive Loyalist',
    blurb: 'Cheap beer, a jukebox, and zero pretense. That is the whole pitch.',
    followers: 138,
    ratings: [
      r('169-bar', 9.2, '2026-05-29T04:00:00.000Z'),
      r('jimmys-corner', 8.9, '2026-05-21T03:10:00.000Z'),
      r('welcome-johnsons', 8.4, '2026-05-12T03:50:00.000Z'),
      r('ace-bar', 8.1, '2026-05-04T02:30:00.000Z'),
      r('subway-inn', 7.2, '2026-04-30T03:15:00.000Z'),
      r('dive-bar-uws', 6.6, '2026-04-22T02:40:00.000Z'),
      r('white-horse-tavern', 6.1, '2026-05-08T01:25:00.000Z'),
      r('mr-purple', 3.8, '2026-05-16T03:00:00.000Z'),
    ],
  },
  {
    handle: 'sasha',
    displayName: 'Sasha L.',
    initials: 'SL',
    archetype: 'Rooftop & Scene',
    blurb: 'If there is a skyline and a DJ, I am already on the list.',
    followers: 392,
    ratings: [
      r('mr-purple', 9.0, '2026-05-31T03:30:00.000Z'),
      r('le-bain', 8.7, '2026-05-24T04:10:00.000Z'),
      r('bar-sixtyfive', 8.5, '2026-05-15T02:50:00.000Z'),
      r('pier-a', 7.3, '2026-05-06T23:55:00.000Z'),
      r('the-frying-pan', 7.0, '2026-05-20T22:30:00.000Z'),
      r('the-tippler', 6.4, '2026-04-26T02:20:00.000Z'),
      r('attaboy', 8.2, '2026-05-11T03:40:00.000Z'),
      r('169-bar', 4.0, '2026-05-03T03:05:00.000Z'),
    ],
  },
  {
    handle: 'jordan',
    displayName: 'Jordan K.',
    initials: 'JK',
    archetype: 'Jazz & Late Nights',
    blurb: 'Last call is a suggestion. Live music is non-negotiable.',
    followers: 176,
    ratings: [
      r('smalls-jazz-club', 9.3, '2026-05-28T05:00:00.000Z'),
      r('rum-house', 8.8, '2026-05-19T03:20:00.000Z'),
      r('bemelmans-bar', 8.6, '2026-05-09T02:45:00.000Z'),
      r('little-branch', 8.3, '2026-05-01T04:30:00.000Z'),
      r('prohibition', 7.4, '2026-04-25T03:35:00.000Z'),
      r('death-and-co', 8.0, '2026-05-13T03:15:00.000Z'),
      r('caledonia-bar', 6.7, '2026-04-29T02:10:00.000Z'),
    ],
  },
];

/**
 * Handles followed by default on a fresh device. A populated subset (not all)
 * so the demo feed is alive immediately while a live Follow button remains.
 */
export const DEFAULT_FOLLOWS: readonly string[] = ['maya', 'jordan'];

export function findDemoFriend(handle: string): DemoFriend | undefined {
  return demoFriends.find((f) => f.handle === handle.toLowerCase());
}
