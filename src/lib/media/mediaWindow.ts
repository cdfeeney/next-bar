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
  if (destinations.length === 0) return { readable: false };

  // A destination with no expiry of its own keeps the media readable
  // indefinitely, so no finite window can bound it.
  if (destinations.some((d) => d.expiresAt === null)) {
    return { readable: true, expiresAt: null };
  }

  let latestMs = Number.NEGATIVE_INFINITY;
  let latest: string | null = null;

  for (const destination of destinations) {
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
