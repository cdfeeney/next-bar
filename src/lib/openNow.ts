import type { Bar, WeeklyHours } from '@/types';

/**
 * Compute whether a bar is open at `now`, entirely client-side, from its stored
 * weekly hours + the current time in America/New_York. "Open now" is derived
 * here on every render — never a live API call.
 *
 * Returns `null` when hours are unknown (the UI should show nothing rather than
 * a misleading "closed").
 *
 * PROVENANCE (2026-07-27): hours whose source is Google are marked
 * `hoursConfidence: 'unverified'`. Google's Places policy permits storing the
 * place_id indefinitely and nothing else beyond narrow exceptions; opening
 * hours are not covered. So unverified hours must not DRIVE a hard filter —
 * see hasTrustworthyHours / excludeClosedBars below.
 */
export function isOpenNow(hours: WeeklyHours | undefined, now: Date): boolean | null {
  if (!hours) return null;

  const { day, minutes } = nycNow(now);
  const yesterday = (day + 6) % 7;

  // A window on `day` that closes after it opens is same-day; one that closes
  // before it opens runs past midnight, so its evening portion counts today.
  for (const r of hours[day] ?? []) {
    const open = toMinutes(r.open);
    const close = toMinutes(r.close);
    if (close > open) {
      if (minutes >= open && minutes < close) return true;
    } else if (minutes >= open) {
      return true; // overnight window, evening portion
    }
  }

  // Yesterday's overnight window can still be open in the early morning today.
  for (const r of hours[yesterday] ?? []) {
    const open = toMinutes(r.open);
    const close = toMinutes(r.close);
    if (close <= open && minutes < close) return true; // overnight window, morning portion
  }

  return false;
}

/**
 * Is a closed bar OPENING within `withinMinutes` of `now`? Checks
 * today's later windows and — when the lookahead crosses midnight —
 * tomorrow's early windows. False for open bars (callers ask only after
 * an isOpenNow(...) === false answer) and for unknown hours.
 */
export function opensSoon(
  hours: WeeklyHours | undefined,
  now: Date,
  withinMinutes: number,
): boolean {
  if (!hours) return false;
  const { day, minutes } = nycNow(now);
  for (const r of hours[day] ?? []) {
    const open = toMinutes(r.open);
    if (open > minutes && open - minutes <= withinMinutes) return true;
  }
  // >= 0: at exactly 23:00 with a 60-min window, a midnight opener sits
  // ON the boundary and qualifies — same inclusive rule as the same-day
  // branch (review HIGH: `> 0` silently dropped it).
  const overflow = minutes + withinMinutes - 24 * 60;
  if (overflow >= 0) {
    const tomorrow = (day + 1) % 7;
    for (const r of hours[tomorrow] ?? []) {
      if (toMinutes(r.open) <= overflow) return true;
    }
  }
  return false;
}

/**
 * E3.3 hard filter: drop bars that are KNOWN closed at `now` (or gone for
 * good) — UNLESS they open within `opensSoonWithinMin` (operator
 * 2026-07-26: day drinkers search before doors; those bars stay and
 * their badge honestly reads "Opens 5 PM"). Bars without hours data
 * stay — unknown must never read as closed, so a missing ingest can't
 * false-negative a bar out of existence. Pure; callers on live surfaces
 * decide when to apply it.
 */
export function excludeClosedBars(
  bars: Bar[],
  now: Date,
  opensSoonWithinMin = 0,
): Bar[] {
  return bars.filter((bar) => {
    if (bar.businessStatus === 'CLOSED_PERMANENTLY') return false;
    // Unverified hours never CLOSE a bar. Dropping a venue on the strength
    // of data we are not entitled to rely on is the wrong error to make:
    // it hides a real, probably-open bar from the user.
    if (!hasTrustworthyHours(bar)) return true;
    if (isOpenNow(bar.hours, now) !== false) return true;
    return opensSoonWithinMin > 0 && opensSoon(bar.hours, now, opensSoonWithinMin);
  });
}

/**
 * Hours we are entitled to act on: first-party verified, or venue/user
 * reported. Google-derived hours ('unverified') are NOT trustworthy for
 * filtering — we may display them live, we may not persist and rely on them.
 *
 * Absent provenance on a bar that HAS hours is treated as unverified (the
 * legacy Google rows), while a bar with no hours at all is simply unknown.
 */
export function hasTrustworthyHours(
  bar: Pick<Bar, 'hours' | 'hoursConfidence'>,
): boolean {
  if (!bar.hours) return false;
  return bar.hoursConfidence === 'verified' || bar.hoursConfidence === 'reported';
}

/**
 * The line shown beneath a venue's hours, naming where they came from.
 *
 * Provenance-accurate on purpose. "Hours confirmed with the venue" was true when
 * the only trustworthy source was a venue report, and became a LIE the moment
 * OpenStreetMap rows existed — OSM contributors are not the venue.
 *
 * This also discharges the ODbL attribution obligation for OSM-derived hours, in
 * the place the data is actually rendered, which is where attribution belongs.
 */
export function hoursProvenanceNote(
  bar: Pick<Bar, 'hours' | 'hoursSource' | 'hoursConfidence'>,
): string {
  if (!hasTrustworthyHours(bar)) {
    return 'Hours not verified — confirm before a special trip.';
  }
  switch (bar.hoursSource) {
    case 'osm':
      return 'Hours via OpenStreetMap contributors (ODbL).';
    case 'official_site':
      return 'Hours from the venue’s own website.';
    case 'user':
      return 'Hours reported by a Next Bar user.';
    case 'venue':
    case 'nextbar':
      return 'Hours confirmed with the venue.';
    default:
      // Trustworthy confidence with an unrecognised source should never happen
      // (the DB constraint forbids google here), but claiming provenance we
      // cannot name is worse than admitting we cannot.
      return 'Hours not verified — confirm before a special trip.';
  }
}

/**
 * STRICT "Open now" (the explicit user toggle): only bars we can actually
 * vouch for. A venue with unverified hours is excluded rather than guessed
 * at — the user asked a precise question and deserves a precise answer.
 */
export function openNowStrict(
  bars: Bar[],
  now: Date,
  opensSoonWithinMin = 0,
): Bar[] {
  // Composed rather than reimplemented: this replaces excludeClosedBars at
  // the same call site, so it must inherit that filter's opens-soon grace
  // window. Dropping unverified venues FIRST is what makes it strict; the
  // untrustworthy-hours early return inside excludeClosedBars is then
  // unreachable, which is intended.
  return excludeClosedBars(
    bars.filter((bar) => hasTrustworthyHours(bar)),
    now,
    opensSoonWithinMin,
  );
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map((n) => parseInt(n, 10));
  return h * 60 + m;
}

/** "17:00" → "5 PM", "17:30" → "5:30 PM", "00:00" → "midnight". */
export function formatClockTime(hhmm: string): string {
  const [h, m] = hhmm.split(':').map((n) => parseInt(n, 10));
  if (h === 0 && m === 0) return 'midnight';
  if (h === 12 && m === 0) return 'noon';
  const suffix = h < 12 ? 'AM' : 'PM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${hour12} ${suffix}` : `${hour12}:${String(m).padStart(2, '0')} ${suffix}`;
}

/**
 * U2-1: the human line for a card — "Open · until 2 AM", "Opens 5 PM",
 * "Closed today". Null when hours are unknown (show nothing, never guess).
 * Same overnight-window semantics as isOpenNow.
 *
 * KNOWN LIMITATION (accepted, DeepSeek review): windows touching the DST
 * spring-forward gap (2-3 AM, one night/year) can mislabel for that hour —
 * minutes-from-midnight math has no gap awareness. Not worth the
 * complexity for bar hours.
 */
export function todayHoursLine(
  hours: WeeklyHours | undefined,
  now: Date,
): string | null {
  if (!hours) return null;
  const { day, minutes } = nycNow(now);
  const yesterday = (day + 6) % 7;

  // Currently inside yesterday's overnight tail?
  for (const r of hours[yesterday] ?? []) {
    const open = toMinutes(r.open);
    const close = toMinutes(r.close);
    if (close <= open && minutes < close) {
      return `Open · until ${formatClockTime(r.close)}`;
    }
  }

  const todays = [...(hours[day] ?? [])].sort(
    (a, b) => toMinutes(a.open) - toMinutes(b.open),
  );
  for (const r of todays) {
    const open = toMinutes(r.open);
    const close = toMinutes(r.close);
    // open === close is the 24-hour encoding — "until midnight" would tell
    // users a never-closing bar is about to close (DeepSeek review).
    if (open === close) return 'Open 24 hours';
    const openNow = close > open ? minutes >= open && minutes < close : minutes >= open;
    if (openNow) return `Open · until ${formatClockTime(r.close)}`;
    if (minutes < open) return `Opens ${formatClockTime(r.open)}`;
  }
  if (todays.length === 0) return 'Closed today';
  // Only claim "opens tomorrow" after CHECKING tomorrow (DeepSeek review:
  // a Sunday-closed venue must not promise a Sunday opening on Saturday
  // night).
  const tomorrow = (day + 1) % 7;
  return (hours[tomorrow] ?? []).length > 0 ? 'Closed · opens tomorrow' : 'Closed';
}

const WEEK_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

export type WeekHoursRow = { day: string; hours: string; isToday: boolean };

/**
 * U2-1: full weekly schedule, Monday-first, for the detail/lightbox view.
 * Null when unknown. Days with no windows read "Closed".
 */
export function weekHoursRows(
  hours: WeeklyHours | undefined,
  now: Date,
): WeekHoursRow[] | null {
  if (!hours) return null;
  const { day: today } = nycNow(now);
  // Monday-first ordering feels like a printed schedule.
  const order = [1, 2, 3, 4, 5, 6, 0];
  return order.map((d) => {
    const windows = [...(hours[d] ?? [])].sort(
      (a, b) => toMinutes(a.open) - toMinutes(b.open),
    );
    return {
      day: WEEK_LABELS[d],
      hours:
        windows.length === 0
          ? 'Closed'
          : windows
              .map((r) =>
                r.open === r.close
                  ? 'Open 24 hours'
                  : `${formatClockTime(r.open)} – ${formatClockTime(r.close)}`,
              )
              .join(', '),
      isToday: d === today,
    };
  });
}

/** Day-of-week (0=Sun) and minutes-since-midnight in America/New_York for `now`. */
function nycNow(now: Date): { day: number; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const DAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const hour = parseInt(get('hour'), 10) % 24; // some engines emit "24" at midnight
  const minute = parseInt(get('minute'), 10);
  return { day: DAYS[get('weekday')] ?? 0, minutes: hour * 60 + minute };
}
