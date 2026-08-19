import { nycNightDay, nycNightKey } from '@/lib/nightKey';
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

/**
 * Shift a YYYY-MM-DD night key by whole calendar days. Pure Date.UTC math on
 * the parsed parts — the key is a calendar date, so adding milliseconds to an
 * instant would drag a timezone back into an answer that has none.
 */
function shiftNightKey(key: string, days: number): string {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/**
 * Map a Fri/Sat/Sun NIGHT to its weekend's Saturday, else null.
 *
 * Which night a rating belongs to is nightKey.ts's call and nobody else's. This
 * used to ask `date.getUTCDay()`, so a Sunday 9pm ET rating (Monday 01:00Z) was
 * a Monday and got dropped from the weekend entirely — the streak read as
 * broken for someone who went out Sunday night (round-2 panel, Claude).
 */
function saturdayKeyOf(date: Date): string | null {
  // Intl throws on an invalid Date where getUTCDay() merely returned NaN, so
  // this guard is load-bearing, not defensive: ratedAt comes from localStorage
  // and loadRatings only checks that it is a string. Without it one corrupt
  // timestamp turns a skipped rating into a crash while Settings renders its
  // badges (round-3 panel, both lanes). Same guard nightLog.ts:133 already uses.
  if (Number.isNaN(date.getTime())) return null;
  const day = nycNightDay(date); // Sun=0 … Sat=6, on the 6am NYC rollover
  let offsetDays: number;
  if (day === 5) offsetDays = 1; // Fri night → tomorrow's Sat
  else if (day === 6) offsetDays = 0; // Sat night
  else if (day === 0) offsetDays = -1; // Sun night → yesterday's Sat
  else return null;
  return shiftNightKey(nycNightKey(date), offsetDays);
}

/** Saturday key of the current-or-most-recent weekend relative to `now`. */
function anchorSaturday(now: Date): string {
  const day = nycNightDay(now);
  if (day === 5 || day === 6 || day === 0) {
    return saturdayKeyOf(now) as string;
  }
  // Mon(1)–Thu(4) → previous Saturday is (day + 1) days back.
  return shiftNightKey(nycNightKey(now), -(day + 1));
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
    cursor = shiftNightKey(cursor, -7);
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
