/**
 * socialNight — THE canonical social-night boundary (g-31f36bf8).
 *
 * Before this module the codebase had TWO night boundaries: the
 * server-shared social features (suggestions/RSVPs/pins) rolled over at
 * 6am America/New_York via nightKey.ts, while the device-local personal
 * features (intent, cadence, nightPhase) rolled over at 5am LOCAL time.
 * A user setting intent at 5:30am was on a "new night" for intent but
 * still on "last night" for their circle. This module reconciles that:
 *
 *   - ONE rollover hour: 6. Every night-keyed feature imports
 *     NIGHT_ROLLOVER_HOUR from here. Nights end at 6am, mornings begin
 *     at 6am, everywhere.
 *   - Server-shared features additionally share ONE timezone
 *     (America/New_York — the service area) via socialNightKey().
 *     Device-local personal features (intent/cadence/nightPhase) keep
 *     local-clock semantics deliberately — they describe the USER's
 *     morning, not the venue's — but the hour is this module's.
 *
 * Also owns the pin-presence expiry instant: a "Pin where I am" expires
 * at 6:00 AM America/New_York the morning after its night
 * (socialNightEnd), matching the key rollover exactly.
 *
 * DST-safe: all NYC reads go through Intl in the NYC zone; day math is
 * pure calendar arithmetic via Date.UTC on extracted numbers.
 */

/** The canonical rollover hour — nights end (and mornings begin) at 6. */
export const NIGHT_ROLLOVER_HOUR = 6;

/** The service-area zone every server-shared night key is computed in. */
export const SOCIAL_NIGHT_TIMEZONE = 'America/New_York';

/** User-facing expiry copy for pin confirmations ("… until 6:00 AM"). */
export const SOCIAL_NIGHT_END_LABEL = '6:00 AM';

const nycParts = new Intl.DateTimeFormat('en-US', {
  timeZone: SOCIAL_NIGHT_TIMEZONE,
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  hour12: false,
});

function partsInNyc(now: Date): {
  year: number;
  month: number;
  day: number;
  hour: number;
} {
  const parts = nycParts.formatToParts(now);
  const get = (type: string): number =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);
  // Intl can report midnight as hour 24 in some engines — normalize.
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour') % 24,
  };
}

/**
 * The social-night key: NYC calendar date with the 6am rollover — before
 * 6am America/New_York the key is YESTERDAY's date. 'YYYY-MM-DD' (what
 * Postgres `date` accepts verbatim). This is the single key every
 * server-shared night-scoped feature must use.
 */
export function socialNightKey(now: Date = new Date()): string {
  const { year, month, day, hour } = partsInNyc(now);
  const utcDay = Date.UTC(year, month - 1, day);
  const night = new Date(
    hour < NIGHT_ROLLOVER_HOUR ? utcDay - 24 * 60 * 60 * 1000 : utcDay,
  );
  const y = night.getUTCFullYear();
  const m = String(night.getUTCMonth() + 1).padStart(2, '0');
  const d = String(night.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

const HOUR_MS = 60 * 60 * 1000;

/**
 * The instant a social night ENDS: 6:00 AM America/New_York on the
 * morning after `nightKey`. Pin presence expires here (criterion 10).
 *
 * DST-safe by verification rather than arithmetic: NYC is UTC-4 (EDT) or
 * UTC-5 (EST); try both candidate offsets and keep the one that Intl
 * confirms reads 6am on the expected NYC calendar day.
 */
export function socialNightEnd(nightKey: string): Date {
  const [y, m, d] = nightKey.split('-').map(Number);
  const morningAfterUtcMidnight = Date.UTC(y, m - 1, d + 1);
  const expected = new Date(morningAfterUtcMidnight);
  for (const offsetHours of [4, 5]) {
    const candidate = new Date(
      morningAfterUtcMidnight + (NIGHT_ROLLOVER_HOUR + offsetHours) * HOUR_MS,
    );
    const nyc = partsInNyc(candidate);
    if (
      nyc.hour === NIGHT_ROLLOVER_HOUR &&
      nyc.year === expected.getUTCFullYear() &&
      nyc.month === expected.getUTCMonth() + 1 &&
      nyc.day === expected.getUTCDate()
    ) {
      return candidate;
    }
  }
  // Unreachable for America/New_York (offset is always -4 or -5); fail
  // toward the LATER instant so a pin never outlives 6am NYC.
  return new Date(morningAfterUtcMidnight + (NIGHT_ROLLOVER_HOUR + 5) * HOUR_MS);
}

/**
 * Relative freshness for presence rows ("just now", "12 min ago",
 * "3 hr ago"). Clamped: future or unparseable timestamps read
 * "just now" — a skewed client clock must not render negative ages.
 */
export function relativeTimeLabel(iso: string, now: Date = new Date()): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return 'just now';
  const deltaMs = now.getTime() - then;
  if (deltaMs < 60 * 1000) return 'just now';
  const minutes = Math.floor(deltaMs / (60 * 1000));
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours} hr ago`;
}
