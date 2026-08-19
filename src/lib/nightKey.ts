/**
 * THE definition of "which night is it" — one rollover, one timezone, one
 * place. Every night-scoped surface (cadence, intent, matching, night log,
 * suggestions, votes, night_outs) resolves through this module.
 *
 * A night out spans midnight: 1am Saturday still belongs to "Friday
 * night". The key is the NYC calendar date with a 6am rollover — before
 * 6am America/New_York, the night key is YESTERDAY's date. Returned as
 * 'YYYY-MM-DD' (what Postgres `date` accepts verbatim).
 *
 * WHY 6am NYC, and why nothing else. `supabase/migrations/0053` is the
 * authority: it swept the SQL side to `public.nyc_night_key()` ("a night is
 * the NYC calendar date with a **6am rollover** … which is what
 * src/lib/nightKey.ts implements") after a UTC `current_date` comparison made
 * tonight's invitation read as expired from 8pm onward. Three client modules
 * used to carry their own rollover — cadence.ts and intent.ts each declared a
 * *5am LOCAL* NIGHT_ROLLOVER_HOUR. Local time is the runner's/user's zone, not
 * New York's, so those disagreed with the database by an hour AND by a zone.
 * They are deleted, not kept in sync by comment: this file is the only copy.
 *
 * DST-safe: the hour and calendar date both come from Intl in the NYC
 * zone; the day-subtraction is pure calendar math via Date.UTC on the
 * extracted numbers (no local-zone arithmetic anywhere).
 */

const NIGHT_ROLLOVER_HOUR = 6;

const nycParts = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  hour12: false,
});

/**
 * The night containing `now`, as a UTC-midnight Date carrying that night's
 * calendar y/m/d. Internal: callers take a key or a weekday, never this Date
 * — its only correct readers are the getUTC* accessors below.
 */
function nycNight(now: Date): Date {
  const parts = nycParts.formatToParts(now);
  const get = (type: string): number =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);
  // Intl can report midnight as hour 24 in some engines — normalize.
  const hour = get('hour') % 24;

  const utcDay = Date.UTC(get('year'), get('month') - 1, get('day'));
  return new Date(
    hour < NIGHT_ROLLOVER_HOUR ? utcDay - 24 * 60 * 60 * 1000 : utcDay,
  );
}

export function nycNightKey(now: Date = new Date()): string {
  const night = nycNight(now);
  const y = night.getUTCFullYear();
  const m = String(night.getUTCMonth() + 1).padStart(2, '0');
  const d = String(night.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Day of week of the night containing `now` (0 = Sunday … 6 = Saturday) —
 * the weekly-rhythm read of the same rollover, for callers that ask "which
 * night of the week is this?" rather than "which date?".
 *
 * getUTCDay, never getDay: nycNight() returns a UTC-midnight instant, and in
 * any negative-offset zone (New York included) its LOCAL day is the previous
 * one. That mistake would move every weekday answer back a day west of UTC.
 */
export function nycNightDay(now: Date = new Date()): number {
  return nycNight(now).getUTCDay();
}
