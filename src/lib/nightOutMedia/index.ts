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
 * THE CLIENT DOES NOT COMPUTE THE WINDOW AT ALL — round 2, both gates.
 *
 * This module used to mirror `public.night_out_media_expires_at(date)` in
 * TypeScript, with its own DST offset measurement, and the recap gated its
 * add-photo and archive controls on the result. Two defects came out of that one
 * decision:
 *
 *   * a device clock running fast hid controls the server would still have
 *     honoured — precisely what V8-R-NO-008's failure clause forbids ("a skewed
 *     device clock must not hide media the server still serves");
 *   * the offset was measured at the GUESSED instant, so on a DST-transition
 *     night the two sides disagreed by an hour even with a correct clock.
 *
 * Both are gone by deletion rather than by repair: `night_out_media_window`
 * (migration 0068, section 5d) answers when the window closes and whether it is
 * still open, from the DATABASE's clock. What remains here is WORDING — turning
 * the instant the server gave us into a sentence, which V8-R-NO-008 requires
 * under accessibility ("the window is stated in words").
 */

/** The lifetime, in hours. The requirement's own number, for wording only. */
export const NIGHT_OUT_MEDIA_WINDOW_HOURS = 24;

/**
 * The server's window for one Night Out's media (`night_out_media_window`).
 *
 * `isOpen` is the DATABASE's answer, never a comparison made here.
 */
export type NightOutMediaWindow = {
  /** ISO instant the window closes. */
  expiresAt: string;
  isOpen: boolean;
};

/**
 * The window in words (V8-R-NO-008: "the window is stated in words"), e.g.
 * "Photos from this night stay here until 9:00 PM Saturday New York time."
 *
 * Takes the SERVER's `expires_at`, so the sentence and the rows cannot disagree.
 * Null when the instant is unparseable, so the caller renders nothing rather
 * than a sentence with a hole in it.
 */
export function describeNightOutMediaWindow(expiresAt: string): string | null {
  const expiry = new Date(expiresAt);
  if (Number.isNaN(expiry.getTime())) return null;
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

