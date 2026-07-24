/**
 * NYC "night" key for night-scoped social features (bar suggestions).
 *
 * A night out spans midnight: 1am Saturday still belongs to "Friday
 * night". The key is the NYC calendar date with a 6am rollover — before
 * 6am America/New_York, the night key is YESTERDAY's date. Returned as
 * 'YYYY-MM-DD' (what Postgres `date` accepts verbatim).
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

export function nycNightKey(now: Date = new Date()): string {
  const parts = nycParts.formatToParts(now);
  const get = (type: string): number =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);
  // Intl can report midnight as hour 24 in some engines — normalize.
  const hour = get('hour') % 24;

  const utcDay = Date.UTC(get('year'), get('month') - 1, get('day'));
  const night = new Date(
    hour < NIGHT_ROLLOVER_HOUR ? utcDay - 24 * 60 * 60 * 1000 : utcDay,
  );
  const y = night.getUTCFullYear();
  const m = String(night.getUTCMonth() + 1).padStart(2, '0');
  const d = String(night.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
