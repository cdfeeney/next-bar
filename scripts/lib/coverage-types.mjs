/**
 * The Nearby Search type universe.
 *
 * `coverage-search.mjs` models 23 bar types and 9 hybrid types, but those are
 * *interpreters* — they classify the `primaryType`/`types` Google hands back.
 * `places:searchNearby` accepts only the types in the Places API (New) "Table A"
 * taxonomy, and a single unrecognized entry makes the whole request fail with
 * INVALID_ARGUMENT. So the request list is declared explicitly here rather than
 * derived from BAR_TYPES: deriving it would let an interpreter-only string take
 * down every call in the sweep.
 *
 * Anything in BAR_TYPES that is not requestable is covered through diversified
 * Text Search instead (see TEXT_ONLY_TYPE_COVERAGE) — it is never silently
 * dropped.
 */
import { BAR_TYPES, HYBRID_TYPES } from './coverage-search.mjs';

/**
 * Types requested from places:searchNearby. Ordered nightlife-first so the
 * per-call 20-result ranking favors bars when a cell is dense.
 *
 * Google caps includedTypes at 50 entries; this list is well under that.
 */
export const NEARBY_INCLUDED_TYPES = Object.freeze([
  // Core nightlife (the five the sweep previously sent).
  'bar',
  'pub',
  'wine_bar',
  'night_club',
  'bar_and_grill',
  // Nightlife adjacent, Table A, previously missing entirely.
  'karaoke',
  'comedy_club',
  'concert_hall',
  'dance_hall',
  'casino',
  'banquet_hall',
  'event_venue',
  // Hybrid hosts. These carry the venues the sweep is known to miss —
  // Book Club Bar (book_store), Gran Torino / Beco / Zum Schneider
  // (restaurant), rooftop and hotel bars (hotel), Fornino Pier 6 (pizza).
  'restaurant',
  'hotel',
  'book_store',
  'cafe',
  'coffee_shop',
  'food_court',
  'pizza_restaurant',
  'meal_takeaway',
  'tourist_attraction',
]);

/**
 * BAR_TYPES entries that are NOT requestable Table A types. Each is a real
 * nightlife category the sweep must still reach, so each names the text-query
 * family that covers it. Keep this exhaustive: `assertTypeCoverage()` fails the
 * build if a BAR_TYPES entry is neither requestable nor listed here.
 */
export const TEXT_ONLY_TYPE_COVERAGE = Object.freeze({
  irish_pub: 'beer bars pubs and taprooms',
  cocktail_bar: 'cocktail bars',
  lounge_bar: 'nightclubs and lounges',
  hookah_bar: 'hookah lounges',
  sports_bar: 'sports bars',
  dive_bar: 'dive bars',
  karaoke_bar: 'karaoke bars',
  gastropub: 'beer bars pubs and taprooms',
  brewery: 'breweries and taprooms',
  brewpub: 'breweries and taprooms',
  beer_garden: 'beer gardens and biergartens',
  beer_hall: 'beer gardens and biergartens',
  taproom: 'breweries and taprooms',
  distillery: 'distilleries and tasting rooms',
  winery: 'wine bars',
  pool_hall: 'pool halls and billiards bars',
  jazz_club: 'live music bars',
  live_music_venue: 'live music bars',
});

/**
 * Every bar type is reachable by exactly one route. Called by the type test and
 * at sweep start-up so a future edit to BAR_TYPES cannot silently drop a
 * category out of both lanes.
 */
export function assertTypeCoverage() {
  const requestable = new Set(NEARBY_INCLUDED_TYPES);
  const uncovered = [...BAR_TYPES].filter(
    (type) => !requestable.has(type) && !(type in TEXT_ONLY_TYPE_COVERAGE),
  );
  if (uncovered.length > 0) {
    throw new Error(
      `bar types reachable by neither Nearby nor Text Search: ${uncovered.join(', ')}`,
    );
  }
  const stale = Object.keys(TEXT_ONLY_TYPE_COVERAGE).filter(
    (type) => !BAR_TYPES.has(type),
  );
  if (stale.length > 0) {
    throw new Error(`TEXT_ONLY_TYPE_COVERAGE names non-bar types: ${stale.join(', ')}`);
  }
  return { requestable: [...requestable], textOnly: Object.keys(TEXT_ONLY_TYPE_COVERAGE) };
}

/** Hybrid hosts that are also requested from Nearby, for reporting. */
export function hybridTypesRequestedFromNearby() {
  return NEARBY_INCLUDED_TYPES.filter((type) => HYBRID_TYPES.has(type));
}

const INVALID_TYPE_RE = /(?:includedTypes|invalid).*?['"]?([a-z_]+)['"]?/i;

/**
 * Google rejects the entire request when one includedType is unrecognized.
 * Pull the offending type out of the error so the sweep can drop it, record it
 * in the manifest, and retry — instead of failing the whole geography over a
 * taxonomy drift we cannot verify offline.
 */
export function unsupportedTypeFromError(message, requested = NEARBY_INCLUDED_TYPES) {
  const text = String(message ?? '');
  const named = requested.filter((type) => new RegExp(`\\b${type}\\b`).test(text));
  if (named.length > 0) return named;
  const match = text.match(INVALID_TYPE_RE);
  return match && requested.includes(match[1]) ? [match[1]] : [];
}
