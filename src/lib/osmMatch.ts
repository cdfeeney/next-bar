import { haversineMiles } from '@/lib/distance';

/**
 * Match an OpenStreetMap node to a catalog venue.
 *
 * This is the dangerous step of H3. A wrong match writes ANOTHER BAR'S HOURS
 * onto a venue, and that is strictly worse than having none: no hours renders
 * nothing, wrong hours sends someone across town at 1am to a locked door. So
 * every rule below is built to refuse rather than guess, and ambiguity is never
 * resolved by picking a winner — it is escalated.
 *
 * Two signals must BOTH agree: the name and the location. Name alone matches
 * chains and relocated venues; location alone matches the four other bars in the
 * same building, which in NYC is the common case rather than the exception.
 */

const MILES_TO_METERS = 1609.344;

/**
 * Radii, deliberately tight. OSM pins drift by tens of metres, so some slack is
 * required, but NYC bars can sit 20m apart — generosity here buys false matches,
 * not coverage.
 */
const EXACT_NAME_RADIUS_M = 150;
/** A partial name agreement is weaker evidence, so it must be geographically stronger. */
const SUBSET_NAME_RADIUS_M = 60;

export type OsmVenue = {
  osmId: string;
  name: string;
  lat: number;
  lng: number;
  /** Raw `opening_hours` tag; parsing is osmOpeningHours.ts's job, not ours. */
  openingHours?: string;

  /**
   * Outreach signals OSM already carries. Captured in the SAME Overpass request
   * as the hours — no extra scraping, no extra rate-limit cost, and all of it
   * factual contact data rather than creative work.
   *
   * These are payload, not matching signal: the matcher deliberately ignores
   * them. A shared phone number across two bars in one building would otherwise
   * become false evidence that they are the same venue.
   *
   * `website` doubles as the seed for the official-site hours parser, so a venue
   * found in OSM often needs no URL discovery step at all.
   */
  website?: string;
  phone?: string;
  email?: string;
  instagram?: string;
};

export type CatalogVenue = {
  id: string;
  name: string;
  lat: number;
  lng: number;
};

export type OsmMatch =
  | {
      outcome: 'matched';
      osm: OsmVenue;
      reason: 'exact-name' | 'token-subset';
      meters: number;
    }
  | { outcome: 'ambiguous'; candidates: OsmVenue[]; reason: string }
  | { outcome: 'none'; reason: string };

/** Phrases OSM and we routinely disagree about, longest first so they strip cleanly. */
const CITY_NOISE = ['new york city', 'new york', 'nyc', 'manhattan'];

/**
 * Canonical venue name for comparison.
 *
 * Deliberately conservative about what it removes. Venue-type words are KEPT:
 * "Angel's Share" and "Angel's Share Bar" are plausibly one place, but "Clover
 * Club" and "Clover" are not obviously so, and stripping aggressively invents
 * matches that the distance check then rubber-stamps.
 */
export function normalizeVenueName(name: string): string {
  let out = (name ?? '').toLowerCase();
  // Apostrophes are REMOVED, not spaced, so "mother's" -> "mothers".
  out = out.replace(/['‘’`]/g, '');
  // Expand & before punctuation stripping would eat it.
  out = out.replace(/&/g, ' and ');
  out = out.replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
  out = out.replace(/^the\s+/, '');
  for (const noise of CITY_NOISE) {
    out = out.replace(new RegExp(`(^|\\s)${noise}(\\s|$)`, 'g'), ' ');
  }
  return out.replace(/\s+/g, ' ').trim();
}

function tokens(normalised: string): string[] {
  return normalised === '' ? [] : normalised.split(' ');
}

/** Is one token set wholly contained in the other? */
function isTokenSubset(a: string[], b: string[]): boolean {
  if (a.length === 0 || b.length === 0) return false;
  const [small, large] = a.length <= b.length ? [a, b] : [b, a];
  const set = new Set(large);
  return small.every((t) => set.has(t));
}

export function matchOsmVenue(
  venue: CatalogVenue,
  candidates: readonly OsmVenue[],
): OsmMatch {
  const target = normalizeVenueName(venue.name);
  if (target === '') return { outcome: 'none', reason: 'catalog venue has no usable name' };

  const exact: { osm: OsmVenue; meters: number }[] = [];
  const subset: { osm: OsmVenue; meters: number }[] = [];

  for (const cand of candidates) {
    if (!Number.isFinite(cand.lat) || !Number.isFinite(cand.lng)) continue;
    const candName = normalizeVenueName(cand.name);
    if (candName === '') continue;

    const meters = haversineMiles(venue, cand) * MILES_TO_METERS;

    if (candName === target) {
      if (meters <= EXACT_NAME_RADIUS_M) exact.push({ osm: cand, meters });
      continue;
    }
    if (
      isTokenSubset(tokens(target), tokens(candName)) &&
      meters <= SUBSET_NAME_RADIUS_M
    ) {
      subset.push({ osm: cand, meters });
    }
  }

  // An exact name agreement outranks a partial one, so a venue sitting beside
  // its own annexe resolves cleanly instead of escalating.
  const tier: ['exact-name' | 'token-subset', { osm: OsmVenue; meters: number }[]] =
    exact.length > 0 ? ['exact-name', exact] : ['token-subset', subset];
  const [reason, pool] = tier;

  if (pool.length === 0) {
    return { outcome: 'none', reason: 'no candidate agreed on both name and location' };
  }
  if (pool.length > 1) {
    // Never pick. Several bars share an address across the city, and choosing
    // the nearest or the first is precisely how one venue inherits another's
    // hours. A human decides, or nobody does.
    return {
      outcome: 'ambiguous',
      candidates: pool.map((p) => p.osm),
      reason: `${pool.length} candidates matched on ${reason}; refusing to choose`,
    };
  }

  return { outcome: 'matched', osm: pool[0].osm, reason, meters: pool[0].meters };
}
