/**
 * "Sample night" seeder — gives the signed-out demo user a ready-made set of
 * their OWN ratings so /rankings is populated and they show up as a real
 * participant ("You") in consensus, without hand-rating a dozen bars first.
 *
 * Writes through the same localStorage libs the live app uses, so the seeded
 * data is byte-identical to data the user would have produced by rating bars
 * one at a time. Clearing it is just clearing ratings.
 *
 * The user's picks deliberately overlap with the demo curators (see
 * friends.ts) so the consensus demo has non-empty intersections.
 */

import type { BarRating } from '@/types/ratings';
import { loadRatings, writeRatings } from '@/lib/ratings';

const SEED_FLAG = 'next-bar:demo:seeded:v1';
// The exact barIds the seeder ADDED (only ones the user didn't already have). Removal touches only these,
// so a genuine user rating is never overwritten on seed nor deleted on clear (data-loss fix, Codex review).
const SEED_IDS = 'next-bar:demo:seeded-ids:v1';

const mk = (
  barId: string,
  score: number,
  ratedAt: string,
): BarRating => ({
  barId,
  rating: score >= 8.0 ? 'loved' : score >= 5.0 ? 'liked' : 'pass',
  ratedAt,
  score,
});

/** The signed-in user's seeded "night out" — overlaps with the curators. */
export const SAMPLE_NIGHT: BarRating[] = [
  mk('death-and-co', 9.2, '2026-05-27T02:30:00.000Z'),
  mk('employees-only', 8.8, '2026-05-23T03:15:00.000Z'),
  mk('attaboy', 8.5, '2026-05-20T03:00:00.000Z'),
  mk('little-branch', 8.2, '2026-05-17T04:00:00.000Z'),
  mk('smalls-jazz-club', 8.0, '2026-05-14T05:10:00.000Z'),
  mk('buvette', 7.4, '2026-05-09T23:30:00.000Z'),
  mk('holiday-cocktail-lounge', 6.9, '2026-05-05T02:20:00.000Z'),
  mk('white-horse-tavern', 6.2, '2026-05-02T01:40:00.000Z'),
  mk('the-frying-pan', 3.9, '2026-04-28T22:50:00.000Z'),
];

export function isDemoSeeded(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(SEED_FLAG) === '1';
  } catch {
    return false;
  }
}

function readSeededIds(): Set<string> {
  try {
    const raw = window.localStorage.getItem(SEED_IDS);
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

/**
 * Seed the sample night. ADDITIVE ONLY — adds sample ratings for bars the user has NOT already rated, and
 * NEVER overwrites a genuine rating. Records exactly which barIds it added so removal is precise.
 * Idempotent: a no-op once seeded.
 */
export function seedSampleNight(): void {
  if (typeof window === 'undefined') return;
  if (isDemoSeeded()) return; // already seeded — don't re-add or clobber the added-ids record
  const existing = loadRatings();
  const existingIds = new Set(existing.map((r) => r.barId));
  const toAdd = SAMPLE_NIGHT.filter((r) => !existingIds.has(r.barId));
  writeRatings([...existing, ...toAdd]);
  try {
    window.localStorage.setItem(SEED_FLAG, '1');
    window.localStorage.setItem(SEED_IDS, JSON.stringify(toAdd.map((r) => r.barId)));
  } catch {
    // non-fatal
  }
}

/**
 * Remove the sample night. Deletes ONLY the ratings the seeder itself added and the user hasn't since
 * changed — a genuine (pre-existing OR re-rated) rating is always preserved. No user data is ever lost.
 */
export function clearSampleNight(): void {
  if (typeof window === 'undefined') return;
  const existing = loadRatings();
  const addedIds = readSeededIds();
  const sampleById = new Map(SAMPLE_NIGHT.map((r) => [r.barId, r]));
  writeRatings(
    existing.filter((r) => {
      if (!addedIds.has(r.barId)) return true; // not seeder-added → keep
      const seeded = sampleById.get(r.barId);
      // The user re-rated it since seeding (score differs) → keep; else it is pure seed data → drop.
      return seeded ? r.score !== seeded.score : true;
    }),
  );
  try {
    window.localStorage.removeItem(SEED_FLAG);
    window.localStorage.removeItem(SEED_IDS);
  } catch {
    // non-fatal
  }
}
