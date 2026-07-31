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

/**
 * Bucket a flat tag selection by axis. This is what turns the wire format
 * (a flat `VibeTag[]`) into the filter semantics the product wants:
 * **OR within one axis, AND across axes.**
 *
 * Why that falls out of the existing taxonomy rather than needing a new one:
 * `club` is a Setting, `dance` is an Energy, `house` is a Sound. So
 * "Club + Dancing + House" is already three separate axes, and requiring every
 * non-empty axis to match gives exactly "must be a club AND dance-y AND playing
 * house" — while "wine + beer" stays a single Drink axis and keeps meaning
 * "either".
 *
 * An axis nobody picked is **absent from the map**, never present-but-empty.
 * That distinction is load-bearing: absent is the only unambiguous way to say
 * "no constraint on this axis", and it is why the selection stays a flat array
 * rather than becoming a record keyed by axis (where `{Drink: []}` and a missing
 * `Drink` key would both need a meaning, and every consumer would have to agree
 * on which).
 */
export function groupByAxis(tags: readonly VibeTag[]): Map<VibeAxis, VibeTag[]> {
  const out = new Map<VibeAxis, VibeTag[]>();
  for (const tag of tags) {
    const axis = axisOf(tag);
    const bucket = out.get(axis);
    if (bucket) bucket.push(tag);
    else out.set(axis, [tag]);
  }
  return out;
}
