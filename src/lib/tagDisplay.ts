import type { VibeTag } from '@/types';

/**
 * tagDisplay — THE single place a VibeTag becomes user-visible text
 * (E0.1, locked decision 2). The 33-tag data vocabulary is untouched;
 * this is display only. Price tags render as the glyph ladder — the
 * word "pricey" must never reach the UI. Components render tags ONLY
 * through displayTag(); tagDisplay.test.ts enforces that with a source
 * grep, so new render sites can't quietly regress to raw enums.
 */

export const PRICE_TAG_GLYPHS = {
  cheap: '$',
  mid: '$$',
  pricey: '$$$',
  splurge: '$$$$',
} as const satisfies Partial<Record<VibeTag, string>>;

export const TAG_DISPLAY: Record<VibeTag, string> = {
  dive: 'Dive',
  cocktail: 'Cocktails',
  wine: 'Wine',
  beer: 'Beer',
  dance: 'Dancing',
  lounge: 'Lounge',
  speakeasy: 'Speakeasy',
  pub: 'Pub',
  rooftop: 'Rooftop',
  garden: 'Garden',
  chill: 'Chill',
  buzzy: 'Buzzy',
  loud: 'Loud',
  locals: 'Locals',
  'post-work': 'Post-work',
  date: 'Date spot',
  tourist: 'Touristy',
  industry: 'Industry',
  rough: 'Rough edges',
  polished: 'Polished',
  romantic: 'Romantic',
  instagrammable: 'Photogenic',
  'old-nyc': 'Old New York',
  trendy: 'Trendy',
  indie: 'Indie',
  hiphop: 'Hip-hop',
  house: 'House music',
  jazz: 'Jazz',
  live: 'Live music',
  club: 'Club',
  'restaurant-bar': 'Restaurant bar',
  ...PRICE_TAG_GLYPHS,
};

/** The one lookup components are allowed to render a tag through. */
export function displayTag(tag: VibeTag): string {
  return TAG_DISPLAY[tag];
}

// ---------------------------------------------------------------------------
// Venue tag priority (V8-5; PRD §"P1: venue presentation", checklist §2).
//
// A venue carries more tags than the lightbox shows, so WHICH five survive
// must be a function of the tag SET alone — never of the order the catalog
// happened to return them in. This total ranking over the whole vocabulary is
// the single source of truth for that; there is no second ordering anywhere.
//
// Order: the PRD-named useful types lead, then the remaining venue types,
// then what you'll hear, character, energy, and crowd — broadest first, so a
// venue that carries seven tags still leads with what kind of place it is.
// The PRD also names `sports`, `gay bar` and `reservation-led`, which have no
// tag in the data vocabulary; adding one is out of scope for this goal.
//
// Price tags rank last AND topVenueTags() drops them: the lightbox already
// renders price from `bar.priceTier`, so a "$$" chip would only repeat the
// eyebrow. They stay ranked so the ordering is total over VibeTag.
//
// Record<VibeTag, number> makes tsc enforce that every tag has exactly one
// rank and no unknown tag sneaks in (same guard TAG_BIT_INDEX uses).
// ---------------------------------------------------------------------------
export const TAG_PRIORITY: Record<VibeTag, number> = {
  // PRD-named useful types
  cocktail: 0,
  pub: 1,
  rooftop: 2,
  club: 3,
  wine: 4,
  'restaurant-bar': 5,
  lounge: 6,
  // remaining venue types
  dive: 7,
  speakeasy: 8,
  beer: 9,
  dance: 10,
  garden: 11,
  // what you'll hear
  jazz: 12,
  live: 13,
  house: 14,
  hiphop: 15,
  indie: 16,
  // character
  'old-nyc': 17,
  romantic: 18,
  polished: 19,
  rough: 20,
  trendy: 21,
  instagrammable: 22,
  // energy
  chill: 23,
  buzzy: 24,
  loud: 25,
  // crowd
  locals: 26,
  date: 27,
  'post-work': 28,
  industry: 29,
  tourist: 30,
  // price — ranked for totality, never rendered as a chip (see above)
  cheap: 31,
  mid: 32,
  pricey: 33,
  splurge: 34,
};

// Module-load invariant (mirrors catalog.ts): a copy-pasted duplicate rank
// would compile fine and make the sort below order-dependent again.
if (new Set(Object.values(TAG_PRIORITY)).size !== Object.keys(TAG_PRIORITY).length) {
  throw new Error('tagDisplay: TAG_PRIORITY ranks must be distinct');
}

/** At most this many tags render per venue (PRD §P1, checklist §2). */
export const MAX_VENUE_TAGS = 5;

/**
 * The tags a venue shows, highest priority first, capped at `limit`.
 *
 * Deterministic by construction: duplicates collapse, price tags and any tag
 * the server catalog invents outside the vocabulary drop out, and the
 * survivors are ordered by TAG_PRIORITY — which is total, so the result
 * depends only on the tag set, not on its input order.
 */
export function topVenueTags(
  tags: readonly VibeTag[],
  limit: number = MAX_VENUE_TAGS,
): VibeTag[] {
  return [...new Set(tags)]
    .filter((tag) => tag in TAG_PRIORITY && !(tag in PRICE_TAG_GLYPHS))
    .sort((a, b) => TAG_PRIORITY[a] - TAG_PRIORITY[b])
    .slice(0, limit);
}
