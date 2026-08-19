/**
 * Weekly cadence — blueprint C1 ("Time for your Next Bar", Thu–Sat).
 *
 * Nightlife cadence is weekly, not daily (daily streaks feel fake — see the
 * blueprint's failure-modes list), so the prompt only exists Thursday
 * through Saturday nights. The small hours belong to the previous night —
 * the ONE rollover, from src/lib/nightKey.ts. This module used to declare its
 * own NIGHT_ROLLOVER_HOUR = 5 (local time) and claim in this comment that it
 * matched intent.ts; both were a different night than the database's.
 *
 * Pure module: powers the in-app Tonight surface now; the same predicate
 * gates the web-push notification when VAPID keys land (escalated, D2).
 */

import { nycNightDay } from '@/lib/nightKey';

const THURSDAY = 4;
const FRIDAY = 5;
const SATURDAY = 6;

const NIGHT_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

/** True on going-out nights: Thursday, Friday, Saturday (NYC 6am rollover). */
export function isWeekendNight(now: Date): boolean {
  const day = nycNightDay(now);
  return day === THURSDAY || day === FRIDAY || day === SATURDAY;
}

/**
 * The cadence banner copy for tonight, or null midweek — off-nights get
 * no fake urgency.
 */
export function tonightPrompt(now: Date): string | null {
  if (!isWeekendNight(now)) return null;
  const nightName = NIGHT_NAMES[nycNightDay(now)];
  return `It's ${nightName} — time for your Next Bar.`;
}
