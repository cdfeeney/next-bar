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
  ...PRICE_TAG_GLYPHS,
};

/** The one lookup components are allowed to render a tag through. */
export function displayTag(tag: VibeTag): string {
  return TAG_DISPLAY[tag];
}
