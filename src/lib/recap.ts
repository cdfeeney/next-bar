import type { Bar } from '@/types';
import type { NightRecord } from '@/lib/nightLog';

/**
 * recap — pure composition of the morning-after story (E4.2). Zero
 * input: everything derives from the Night object the app captured on
 * its own. No photo uploads — the captured data IS the artifact.
 */

export type Recap = {
  nightKey: string;
  /** Visited bars in route order (consecutive dedup happened at record
   *  time; a genuine return visit stays). Unknown ids — catalog changes
   *  between night and morning — are dropped, never guessed. */
  bars: Bar[];
  /** The bar Loved that night (first Loved rating that maps), or null. */
  loved: Bar | null;
  /** Distinct visited bars with no rating from that night — the
   *  "rank them while you remember" hook. */
  unratedBarIds: string[];
};

/**
 * Compose the recap for a night, or null when there is nothing to show
 * (no visits — the home phase keeps its plain placeholder card then).
 */
export function composeRecap(
  night: NightRecord,
  catalog: Bar[],
): Recap | null {
  if (night.visits.length === 0) return null;
  const byId = new Map(catalog.map((b) => [b.id, b]));
  const bars = night.visits
    .map((v) => byId.get(v.barId))
    .filter((b): b is Bar => b !== undefined);
  if (bars.length === 0) return null;

  const ratedIds = new Set(night.ratings.map((r) => r.barId));
  // The Loved pick must be part of the VISITED route (review HIGH): a
  // rating tapped on some results-list bar you never went to would
  // otherwise headline a bar that appears nowhere in the card.
  const routeIds = new Set(bars.map((b) => b.id));
  const lovedRating = night.ratings.find(
    (r) => r.rating === 'loved' && routeIds.has(r.barId),
  );
  const loved = lovedRating ? (byId.get(lovedRating.barId) ?? null) : null;

  const unratedBarIds = Array.from(
    new Set(bars.map((b) => b.id).filter((id) => !ratedIds.has(id))),
  );

  return { nightKey: night.nightKey, bars, loved, unratedBarIds };
}
