/**
 * How long the media itself is still readable — the input to the server's TTL
 * decision (V8-R-STO-015: "A minted URL must not outlive the media's own window
 * or survive its deletion").
 *
 * The window is a property of the media's LIVE DESTINATIONS, not of the bytes:
 * one object may be shown by several destinations, and it stays readable while
 * any of them still shows it. So the window closes with the LAST one — a `max`,
 * not a `min`. Taking the min would expire a photo the moment its shortest-lived
 * destination ended, while another destination was still displaying it.
 *
 * `archive` is excluded throughout: it retains bytes, it does not show them.
 */

export type DestinationWindow = {
  kind: string;
  /** When this destination stops showing the media; null = no expiry of its own. */
  expiresAt: string | null;
};

export type MediaWindow =
  /** No live destination: the media is gone and nothing may be minted. */
  | { readable: false }
  /**
   * Readable until `expiresAt`, or with no expiry of its own when null — in
   * which case only the signed-URL ceiling bounds a mint.
   */
  | { readable: true; expiresAt: string | null };

/**
 * Resolve the window from this media's live destinations.
 *
 * Pure, so the rule is testable without a database. Every branch below is a
 * clause of the requirement rather than a convenience.
 */
export function resolveMediaWindow(
  destinations: readonly DestinationWindow[],
): MediaWindow {
  // An `archive` row is a RETENTION HOLD, not a destination. It keeps the bytes
  // alive for Saved Nights Out; it does not show them to anybody, and it has no
  // expiry of its own. Counting it as a window would make it the one branch
  // below that reads "no expiry" — so after "delete everywhere" the author,
  // whose every real destination is gone, would still be minted a URL for media
  // that nothing displays. V8-R-CMP-016's end state is audience: nobody, and a
  // retention hold must not be mistaken for an audience of one.
  const shown = destinations.filter((d) => d.kind !== 'archive');
  if (shown.length === 0) return { readable: false };

  // A destination with no expiry of its own keeps the media readable
  // indefinitely, so no finite window can bound it.
  if (shown.some((d) => d.expiresAt === null)) {
    return { readable: true, expiresAt: null };
  }

  let latestMs = Number.NEGATIVE_INFINITY;
  let latest: string | null = null;

  for (const destination of shown) {
    const parsed = Date.parse(destination.expiresAt as string);
    // An unparseable timestamp is not treated as "no expiry" — that would turn
    // corrupt data into an unbounded read. It is skipped, and if every
    // destination is unparseable the media reads as not readable.
    if (!Number.isFinite(parsed)) continue;
    if (parsed > latestMs) {
      latestMs = parsed;
      latest = destination.expiresAt;
    }
  }

  if (latest === null) return { readable: false };
  return { readable: true, expiresAt: latest };
}
