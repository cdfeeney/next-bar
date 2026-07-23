/**
 * Weekly cadence — blueprint C1 ("Time for your Next Bar", Thu–Sat).
 *
 * Nightlife cadence is weekly, not daily (daily streaks feel fake — see the
 * blueprint's failure-modes list), so the prompt only exists Thursday
 * through Saturday nights. The small hours belong to the previous night,
 * same 5am rollover as src/lib/intent.ts.
 *
 * Pure module: powers the in-app Tonight surface now; the same predicate
 * gates the web-push notification when VAPID keys land (escalated, D2).
 */

const NIGHT_ROLLOVER_HOUR = 5;

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

/** The Date shifted back so small hours count as the previous night. */
function effectiveNight(date: Date): Date {
  const copy = new Date(date.getTime());
  if (copy.getHours() < NIGHT_ROLLOVER_HOUR) {
    copy.setDate(copy.getDate() - 1);
  }
  return copy;
}

/** True on going-out nights: Thursday, Friday, Saturday (5am rollover). */
export function isWeekendNight(now: Date): boolean {
  const day = effectiveNight(now).getDay();
  return day === THURSDAY || day === FRIDAY || day === SATURDAY;
}

/**
 * The cadence banner copy for tonight, or null midweek — off-nights get
 * no fake urgency.
 */
export function tonightPrompt(now: Date): string | null {
  if (!isWeekendNight(now)) return null;
  const nightName = NIGHT_NAMES[effectiveNight(now).getDay()];
  return `It's ${nightName} — time for your Next Bar.`;
}
