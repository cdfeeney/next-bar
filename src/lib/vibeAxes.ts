import type { VibeTag } from '@/types';

/**
 * vibeAxes — the 33-tag vocabulary grouped into 6 named axes (E0.2).
 * Resolves "more vibe control, fewer buttons": the E2.2 picker shows one
 * axis card at a time (progressive disclosure) instead of a flat chip
 * wall. A tag lives in EXACTLY one axis — vibeAxes.test.ts enforces the
 * partition against TAG_VOCABULARY, so adding a 34th tag without homing
 * it here fails loudly.
 *
 * Scene is deliberately the widest axis (crowd + occasion + texture);
 * if the E2.2 UI needs it thinner, sub-group at the display layer —
 * don't fork the taxonomy.
 */

export type VibeAxis = 'Drink' | 'Energy' | 'Setting' | 'Scene' | 'Sound' | 'Spend';

/** Display order for the E2.2 axis cards. */
export const AXIS_ORDER: readonly VibeAxis[] = [
  'Drink',
  'Energy',
  'Setting',
  'Scene',
  'Sound',
  'Spend',
];

export const VIBE_AXES: Record<VibeAxis, readonly VibeTag[]> = {
  /** What you're drinking. */
  Drink: ['cocktail', 'wine', 'beer'],
  /** How the room feels. */
  Energy: ['chill', 'buzzy', 'loud', 'dance'],
  /** The physical space. */
  Setting: ['dive', 'lounge', 'speakeasy', 'pub', 'rooftop', 'garden', 'club', 'restaurant-bar'],
  /** Who's there and what the night is. */
  Scene: [
    'locals',
    'post-work',
    'date',
    'tourist',
    'industry',
    'romantic',
    'trendy',
    'indie',
    'old-nyc',
    'rough',
    'polished',
    'instagrammable',
  ],
  /** What's playing. */
  Sound: ['hiphop', 'house', 'jazz', 'live'],
  /** The price ladder, ascending (renders as $–$$$$ via tagDisplay). */
  Spend: ['cheap', 'mid', 'pricey', 'splurge'],
};

const TAG_TO_AXIS: ReadonlyMap<VibeTag, VibeAxis> = new Map(
  (Object.entries(VIBE_AXES) as Array<[VibeAxis, readonly VibeTag[]]>).flatMap(
    ([axis, tags]) => tags.map((tag) => [tag, axis] as [VibeTag, VibeAxis]),
  ),
);

/** The axis a tag belongs to (total function over the vocabulary). */
export function axisOf(tag: VibeTag): VibeAxis {
  const axis = TAG_TO_AXIS.get(tag);
  if (!axis) throw new Error(`vibeAxes: unhomed tag ${tag}`);
  return axis;
}
