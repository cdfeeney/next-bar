import type { WeeklyHours } from '@/types';

/**
 * Parse an OpenStreetMap `opening_hours` tag into our WeeklyHours shape.
 *
 * OSM's grammar is enormous — month ranges, week selectors, sunrise/sunset
 * offsets, holiday selectors, fallback rules, comments. We implement a
 * CONSERVATIVE SUBSET and return null for anything else, so an exotic spec
 * becomes human review instead of a confident wrong answer. That is the whole
 * point: a venue whose hours we cannot parse is a venue we say nothing about.
 *
 * Rather than blocklist the syntax we do not support — a list that would rot as
 * OSM grows — every rule must MATCH a strict shape. Anything unrecognised fails
 * closed for free, including forms nobody has thought of yet.
 *
 * Supported:
 *   24/7
 *   Mo-Fr 17:00-02:00
 *   Sa,Su 12:00-04:00           (day lists)
 *   Mo-Su 17:00-02:00           (ranges wrap the week)
 *   Mo 12:00-15:00,17:00-23:00  (several windows in a day)
 *   Mo-Sa 17:00-02:00; Su off   (multiple rules; later rules override earlier)
 *
 * Day numbering matches WeeklyHours and JS getDay(): 0 = Sunday … 6 = Saturday.
 */

const DAY_INDEX: Record<string, number> = {
  su: 0,
  mo: 1,
  tu: 2,
  we: 3,
  th: 4,
  fr: 5,
  sa: 6,
};

type Interval = { open: string; close: string };

/** A rule is a day selector, whitespace, then either times or a closed marker. */
const RULE_RE =
  /^([a-z]{2}(?:-[a-z]{2})?(?:,[a-z]{2}(?:-[a-z]{2})?)*)\s+(.+)$/;

const SPAN_RE = /^([01]\d|2[0-3]):([0-5]\d)-([01]\d|2[0-3]):([0-5]\d)$/;

/** Holiday selectors carry no weekday meaning — see parse() for why we skip. */
const HOLIDAY_RULE_RE = /^(ph|sh)\b/;

/**
 * Expand `mo-su` style ranges, wrapping at the week boundary so `sa-su` is two
 * days and `mo-su` is seven.
 */
function expandDayRange(start: number, end: number): number[] {
  const out: number[] = [];
  let d = start;
  for (let guard = 0; guard < 7; guard++) {
    out.push(d);
    if (d === end) break;
    d = (d + 1) % 7;
  }
  return out;
}

/** `mo-fr`, `sa,su`, `mo` → day indices, or null if any token is not a day. */
function parseDaySelector(selector: string): number[] | null {
  const days: number[] = [];
  for (const part of selector.split(',')) {
    const [from, to] = part.split('-');
    const start = DAY_INDEX[from];
    if (start === undefined) return null;
    if (to === undefined) {
      days.push(start);
      continue;
    }
    const end = DAY_INDEX[to];
    if (end === undefined) return null;
    days.push(...expandDayRange(start, end));
  }
  return days;
}

/** `17:00-02:00,20:00-23:00` → intervals, or null if any span is malformed. */
function parseTimeSelector(selector: string): Interval[] | null {
  const intervals: Interval[] = [];
  for (const span of selector.split(',')) {
    const m = SPAN_RE.exec(span.trim());
    if (!m) return null;
    intervals.push({ open: `${m[1]}:${m[2]}`, close: `${m[3]}:${m[4]}` });
  }
  return intervals.length > 0 ? intervals : null;
}

export function parseOsmOpeningHours(spec: string | undefined | null): WeeklyHours | null {
  if (typeof spec !== 'string') return null;
  const normalised = spec.trim().toLowerCase().replace(/\s+/g, ' ');
  if (normalised === '') return null;

  if (normalised === '24/7') {
    const always: Record<number, Interval[]> = {};
    for (let d = 0; d < 7; d++) always[d] = [{ open: '00:00', close: '00:00' }];
    return always as unknown as WeeklyHours;
  }

  const days: Record<number, Interval[]> = {};

  for (const raw of normalised.split(';')) {
    const rule = raw.trim();
    if (rule === '') continue;

    // Skip holiday rules rather than rejecting the whole spec. Ignoring `PH off`
    // can only overclaim "open" on a public holiday, which is the safe direction
    // here — the same asymmetry the open-now badge uses. Rejecting outright would
    // discard otherwise-good weekday hours for a very common tag.
    if (HOLIDAY_RULE_RE.test(rule)) continue;

    const m = RULE_RE.exec(rule);
    if (!m) return null;

    const selectedDays = parseDaySelector(m[1]);
    if (selectedDays === null) return null;

    const timePart = m[2].trim();

    // Later rules override earlier ones for the same day — OSM semantics, and
    // the reason this assigns rather than merges.
    if (timePart === 'off' || timePart === 'closed') {
      for (const d of selectedDays) delete days[d];
      continue;
    }

    const intervals = parseTimeSelector(timePart);
    if (intervals === null) return null;
    for (const d of selectedDays) days[d] = intervals;
  }

  // A spec that parsed cleanly but leaves the venue closed all week tells us
  // nothing usable, and must not be written as hours.
  return Object.keys(days).length > 0 ? (days as unknown as WeeklyHours) : null;
}
