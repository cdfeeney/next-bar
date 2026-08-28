import { NIGHT_ROLLOVER_HOUR } from '@/lib/nightKey';

/**
 * Night Out media — the third lifetime (V8-R-NO-008), and the private archive
 * it can be saved into (V8-R-NO-009, V8-R-ACC-002).
 *
 * THREE LIFETIMES, and they are deliberately different:
 *
 *   Story          24 hours from CAPTURE
 *   Feed post      until the author deletes it
 *   Night Out      24 hours from the SCHEDULED NIGHT OUT START  ← this module
 *
 * The distinction is the requirement, not an implementation detail: V8-R-NO-008
 * names it "a third and distinct lifetime" and excludes measuring from capture.
 *
 * WHAT "THE SCHEDULED START" IS HERE. `public.night_outs` schedules a plan
 * against a `night` DATE — there is no start time in the schema — and a night
 * begins at 4:00 AM America/New_York (V8-R-PRE-005 / D-C-39). So the start of a
 * Night Out is the start of the night it is scheduled for, and the window closes
 * 24 hours later. That is the only reading available that invents no number:
 * `created_at` would be when the plan was MADE (a plan made three days ahead
 * would expire before the night began) and any chosen evening hour would be a
 * product decision this lane has no authority to mint.
 *
 * ⚠ CONSEQUENCE, FLAGGED RATHER THAN BURIED: because a night starts at 4:00 AM
 * and people go out in the evening, a photo taken at 11pm is readable for about
 * five hours, not twenty-four. The arithmetic is exactly "24 hours from the
 * scheduled start"; it is the SCHEDULE that is coarse. If a longer tail is
 * wanted the fix is a real start time on the plan and one call site here.
 *
 * THE CLIENT NEVER DECIDES THE WINDOW. `get_night_out_media` applies it in SQL
 * and returns nothing once it has closed, because V8-R-NO-008's failure clause
 * is "a skewed device clock must not hide media the server still serves" — and
 * its mirror, that a skewed clock must not SHOW media the server has stopped
 * serving, only holds if the server is the one filtering. What is here is for
 * WORDING the window ("the window is stated in words"), not for gating it.
 */

/** The lifetime, in hours. The requirement's own number. */
export const NIGHT_OUT_MEDIA_WINDOW_HOURS = 24;

/**
 * When media for a Night Out on `night` stops being served.
 *
 * Mirrors `public.night_out_media_expires_at(date)` in migration 0068. Both
 * sides resolve the same boundary from the same constant, so the words the
 * client shows and the rows the server serves cannot disagree.
 *
 * Returns null for a night key that is not a date — an unparseable night has no
 * window, and guessing one would be the surface inventing a deadline.
 */
export function nightOutMediaExpiry(night: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(night);
  if (match === null) return null;
  const [, year, month, day] = match;

  // The night's own start, in New York, then 24 hours. `Date` cannot be given a
  // zone directly, so the offset is measured rather than assumed: DST means the
  // same wall-clock hour is 08:00Z in July and 09:00Z in January, and hardcoding
  // either would be wrong for half the year.
  const startUtcGuess = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    NIGHT_ROLLOVER_HOUR,
  );
  if (!Number.isFinite(startUtcGuess)) return null;
  const start = startUtcGuess + newYorkOffsetMs(startUtcGuess);
  return new Date(start + NIGHT_OUT_MEDIA_WINDOW_HOURS * 3_600_000);
}

/** True while the window is open. `now` is injectable so this is testable. */
export function isNightOutMediaLive(
  night: string,
  now: Date = new Date(),
): boolean {
  const expiry = nightOutMediaExpiry(night);
  // NO WINDOW MEANS NOT LIVE. An unparseable night must not read as "open
  // forever" — that is the direction that shows media the server has stopped
  // serving.
  return expiry !== null && now.getTime() < expiry.getTime();
}

/**
 * The window in words (V8-R-NO-008: "the window is stated in words"), e.g.
 * "Photos from this night stay here until 4:00 AM Sunday."
 *
 * Null when there is no window to state, so the caller renders nothing rather
 * than a sentence with a hole in it.
 */
export function describeNightOutMediaWindow(night: string): string | null {
  const expiry = nightOutMediaExpiry(night);
  if (expiry === null) return null;
  const when = new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/New_York',
  }).format(expiry);
  return `Photos from this night stay here until ${when} New York time.`;
}

/** One photo attached to a Night Out, as a member is allowed to see it. */
export type NightOutMediaItem = {
  destinationId: string;
  mediaId: string;
  authorId: string;
  storagePath: string;
  createdAt: string;
  /** When the whole night's media stops being served. Same for every item. */
  expiresAt: string;
};

/** One card in Saved Nights Out (V8-R-ACC-002). */
export type SavedNightCard = {
  id: string;
  title: string | null;
  night: string;
  /** The metadata line's numbers. Snapshotted at archive time. */
  barCount: number;
  photoCount: number;
  archivedAt: string;
  /**
   * Media ids, in archive order, so the card can lead with photos in one round
   * trip. Ids rather than storage paths: the boundary route is keyed on the id,
   * and deriving one from an object key is string surgery that fails silently.
   */
  coverMediaIds: readonly string[];
};

/** One opened archived night (V8-R-ACC-002). */
export type SavedNight = {
  id: string;
  title: string | null;
  night: string;
  barCount: number;
  archivedAt: string;
  photos: ReadonlyArray<{ mediaId: string; storagePath: string }>;
};

/**
 * The metadata line V8-R-ACC-002 asks for: "name, date, bar count, photo count",
 * one quiet line.
 *
 * A night with no name is described by its date rather than by a placeholder —
 * "Untitled" is a label nobody chose, and the date is a true thing we know.
 */
export function savedNightSummary(card: {
  title: string | null;
  night: string;
  barCount: number;
  photoCount: number;
}): string {
  const parts = [
    formatNightDate(card.night),
    `${card.barCount} ${card.barCount === 1 ? 'bar' : 'bars'}`,
    `${card.photoCount} ${card.photoCount === 1 ? 'photo' : 'photos'}`,
  ];
  return parts.join(' · ');
}

/** "Friday, July 24" from a night key. The key back if it is unparseable. */
export function formatNightDate(night: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(night);
  if (match === null) return night;
  const [, year, month, day] = match;
  // UTC on purpose, matching the night-key convention: the key is a calendar
  // day, not an instant, so letting the device's zone shift it would name the
  // wrong weekday for anyone west of the line.
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(Number(year), Number(month) - 1, Number(day))));
}

/**
 * How far `America/New_York` is from UTC at a given instant, in milliseconds.
 *
 * Measured through `Intl` rather than tabulated, so DST is the platform's
 * problem and not a table here that goes stale when a rule changes. Same
 * technique `nycNightKey` uses for the same reason.
 */
function newYorkOffsetMs(utcMs: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(utcMs));
  const field = (type: string): number =>
    Number(parts.find((part) => part.type === type)?.value ?? '0');
  const asUtc = Date.UTC(
    field('year'),
    field('month') - 1,
    field('day'),
    field('hour'),
    field('minute'),
    field('second'),
  );
  return utcMs - asUtc;
}
