import type { Bar, VibeTag } from '@/types';
import type { BarRating } from '@/types/ratings';

/**
 * Untappd/Strava-style badges + explorer score, derived purely from ratings
 * and the catalog. Every rating (any tier, Pass included) counts as a visit —
 * you still went. Off-catalog ratings count as visits but can't contribute
 * neighborhood/tag progress.
 */

export type Badge = {
  id: string;
  label: string;
  description: string;
  earned: boolean;
  progress: { current: number; target: number };
};

export type BadgeReport = {
  badges: Badge[];
  /** visits + 3 per distinct neighborhood visited. */
  explorerScore: number;
  /** Consecutive weekends (Fri–Sun) with ≥1 rating, ending at the last weekend. */
  weekendStreakCount: number;
};

const DAY_MS = 86_400_000;

/** Map a Fri/Sat/Sun date to its weekend's Saturday (UTC date string), else null. */
function saturdayKeyOf(date: Date): string | null {
  const day = date.getUTCDay(); // Sun=0 … Sat=6
  let offsetDays: number;
  if (day === 5) offsetDays = 1; // Fri → tomorrow's Sat
  else if (day === 6) offsetDays = 0; // Sat
  else if (day === 0) offsetDays = -1; // Sun → yesterday's Sat
  else return null;
  const sat = new Date(date.getTime() + offsetDays * DAY_MS);
  return sat.toISOString().slice(0, 10);
}

/** Saturday key of the current-or-most-recent weekend relative to `now`. */
function anchorSaturday(now: Date): string {
  const day = now.getUTCDay();
  if (day === 5 || day === 6 || day === 0) {
    return saturdayKeyOf(now) as string;
  }
  // Mon(1)–Thu(4) → previous Saturday is (day + 1) days back.
  const sat = new Date(now.getTime() - (day + 1) * DAY_MS);
  return sat.toISOString().slice(0, 10);
}

/**
 * Consecutive weekends with at least one rating, anchored to the most recent
 * weekend. If the user skipped the last weekend entirely, the streak is 0 —
 * weekly cadence, never daily (nightlife is not a daily habit).
 */
export function weekendStreak(ratings: BarRating[], now: Date): number {
  const weekendKeys = new Set<string>();
  for (const r of ratings) {
    const key = saturdayKeyOf(new Date(r.ratedAt));
    if (key !== null) weekendKeys.add(key);
  }
  if (weekendKeys.size === 0) return 0;

  let cursor = anchorSaturday(now);
  if (!weekendKeys.has(cursor)) return 0;

  let streak = 0;
  while (weekendKeys.has(cursor)) {
    streak += 1;
    cursor = new Date(new Date(`${cursor}T00:00:00Z`).getTime() - 7 * DAY_MS)
      .toISOString()
      .slice(0, 10);
  }
  return streak;
}

function countTag(ratings: BarRating[], barById: Map<string, Bar>, tag: VibeTag): number {
  let n = 0;
  for (const r of ratings) {
    const bar = barById.get(r.barId);
    if (bar && bar.tags.includes(tag)) n += 1;
  }
  return n;
}

function badge(
  id: string,
  label: string,
  description: string,
  current: number,
  target: number,
): Badge {
  return {
    id,
    label,
    description,
    earned: current >= target,
    progress: { current: Math.min(current, target), target },
  };
}

export function deriveBadges(
  ratings: BarRating[],
  bars: Bar[],
  now: Date,
): BadgeReport {
  const barById = new Map(bars.map((b) => [b.id, b]));

  const visits = ratings.length;
  const neighborhoods = new Set<string>();
  for (const r of ratings) {
    const bar = barById.get(r.barId);
    if (bar) neighborhoods.add(bar.neighborhood);
  }

  const streak = weekendStreak(ratings, now);

  const badges: Badge[] = [
    badge('first-night', 'First Night Out', 'Rate your first bar', visits, 1),
    badge('regular', 'Regular', 'Rate 10 bars', visits, 10),
    badge('fixture', 'Fixture', 'Rate 25 bars', visits, 25),
    badge('hood-hopper', 'Hood Hopper', 'Hit 3 neighborhoods', neighborhoods.size, 3),
    badge('city-wide', 'City-Wide', 'Hit 8 neighborhoods', neighborhoods.size, 8),
    badge('hidden-doors', 'Hidden Doors', '5 speakeasies', countTag(ratings, barById, 'speakeasy'), 5),
    badge('rooftop-rookie', 'Rooftop Rookie', '3 rooftops', countTag(ratings, barById, 'rooftop'), 3),
    badge('dive-circuit', 'Dive Circuit', '5 dive bars', countTag(ratings, barById, 'dive'), 5),
    badge('weekend-streak', 'Weekend Streak', '2 weekends in a row', streak, 2),
  ];

  return {
    badges,
    explorerScore: visits + 3 * neighborhoods.size,
    weekendStreakCount: streak,
  };
}
