import type { VibeTag } from '@/types';
import { TAG_VOCABULARY } from '@/lib/catalog';

/**
 * Deterministic venue tagging for `public.bars` (V8 PRD P1: "up to five
 * deterministic customer-facing tags").
 *
 * Measured on staging 2026-08-19: 1667 rows, 132 with no tags at all, 100
 * carrying MORE than five, max cardinality 7. This module is the one place
 * that decides what a row's tags are, so both defects close with one rule.
 *
 * DETERMINISTIC means exactly that: the output is a pure function of the row.
 * No model calls, no randomness, no clock, no iteration over an unordered
 * collection. Re-running over unchanged rows produces an identical result,
 * which is what makes the backfill script's second run a zero-row diff.
 *
 * The vocabulary is `VibeTag` and nothing else — no new tag words (the
 * matcher, the quiz and the bit-mask in catalog.ts all key off that union).
 */

/** PRD cap: a bar shows at most five tags. */
export const MAX_VENUE_TAGS = 5;

/**
 * The drop order for tags six and seven, most-keepable first.
 *
 * Ordered by how much the tag tells a customer choosing a bar tonight:
 *
 *  1. VENUE TYPE — what kind of place it is. The PRD's own examples
 *     ("cocktail, pub, rooftop, nightclub, wine … lounge") are all this
 *     category, so it survives every trim.
 *  2. SOUND — rare and strongly identifying when present; "jazz" is a
 *     reason to pick a bar, and only a handful of rows carry it.
 *  3. PRICE — deliberately ABOVE crowd/texture/energy: the quiz emits price
 *     tags ('cheap', 'pricey', 'splurge' in src/lib/quiz.ts) and matching
 *     scores tag overlap, so trimming price off the 100 over-tagged rows
 *     would quietly degrade their match quality.
 *  4. CROWD — who is there; useful, but largely implied by type + price.
 *  5. TEXTURE — how it feels; the most subjective category.
 *  6. ENERGY — 'chill' / 'buzzy' / 'loud'. The most generic and the most
 *     widely applied, so it is the cheapest thing to lose.
 *
 * Within a category, more specific before more general. This is a TOTAL
 * order over the whole vocabulary, so the trim is never arbitrary and never
 * depends on the order a row happened to store its tags in.
 */
export const TAG_PRIORITY: readonly VibeTag[] = [
  // venue type
  'dive', 'cocktail', 'speakeasy', 'wine', 'beer', 'pub', 'club', 'rooftop',
  'garden', 'dance', 'lounge', 'restaurant-bar',
  // sound
  'jazz', 'live', 'hiphop', 'house', 'indie',
  // price
  'cheap', 'mid', 'pricey', 'splurge',
  // crowd
  'date', 'locals', 'industry', 'post-work', 'tourist',
  // texture
  'old-nyc', 'romantic', 'rough', 'polished', 'trendy', 'instagrammable',
  // energy
  'chill', 'loud', 'buzzy',
];

const PRIORITY_RANK = new Map<VibeTag, number>(
  TAG_PRIORITY.map((tag, index) => [tag, index]),
);

// Module-load invariant, the same house pattern as catalog.ts's bit-position
// check: TAG_PRIORITY must be a PERMUTATION of the vocabulary. A tag missing
// here would rank as `undefined`, and the comparator would then keep or drop
// it depending on where it happened to sit in the input — silent, and exactly
// the "arbitrary drop" this file exists to prevent. Fail at import, not in
// one test, so a future tag added to the union cannot ship half-ranked.
if (
  PRIORITY_RANK.size !== TAG_PRIORITY.length
  || TAG_PRIORITY.length !== TAG_VOCABULARY.length
  || TAG_VOCABULARY.some((tag) => !PRIORITY_RANK.has(tag))
) {
  throw new Error('venueTags: TAG_PRIORITY must be a permutation of TAG_VOCABULARY');
}

const KNOWN_TAGS: ReadonlySet<string> = new Set(TAG_VOCABULARY);

/**
 * Keyword → tags, lifted from `scripts/ingest-bars.ts`'s NAME_TAGS so this
 * backfill agrees with the ingest that produced most of these rows. Patterns
 * are applied in array order against name + blurb; every pattern that matches
 * contributes, and first-seen order is preserved, so the result is a function
 * of this table alone.
 *
 * Four additions over the ingest copy, all still inside the VibeTag union:
 * ingest got 'club'/'dance' from Google's `night_club` type, which the bars
 * TABLE does not store; 'lounge' was folded into the jazz pattern, which
 * mis-tags every non-jazz lounge; and 'restaurant-bar' became first-class
 * vocabulary after that script was written.
 */
const KEYWORD_TAGS: ReadonlyArray<readonly [RegExp, readonly VibeTag[]]> = [
  [/rooftop|sky ?bar|terrace/i, ['rooftop', 'instagrammable']],
  [/wine|vinyl|enoteca|vino/i, ['wine', 'chill']],
  [/jazz|blue note/i, ['jazz', 'live']],
  [/lounge/i, ['lounge', 'chill']],
  [/tavern|ale house|public house|\bpub\b/i, ['pub', 'old-nyc', 'beer']],
  [/speakeasy|hidden|secret|parlou?r/i, ['speakeasy', 'cocktail']],
  [/\bdive\b/i, ['dive', 'rough']],
  [/cocktail|apothecary|bitters/i, ['cocktail', 'polished']],
  [/beer|brew|hops|\btap\b/i, ['beer', 'buzzy']],
  [/garden|biergarten|backyard|patio/i, ['garden', 'chill']],
  [/night ?club|discotheque|\bdisco\b/i, ['club', 'dance', 'loud']],
  [/karaoke|dance floor|\bdj\b/i, ['dance', 'loud']],
  [/kitchen|restaurant|trattoria|osteria|bistro/i, ['restaurant-bar']],
];

/** price_tier 1–4 → the matching price tag. */
const PRICE_TAGS: Readonly<Record<number, VibeTag>> = {
  1: 'cheap', 2: 'mid', 3: 'pricey', 4: 'splurge',
};

/** The price tag for a row whose price_tier is missing or out of range. */
const DEFAULT_PRICE_TAG: VibeTag = 'mid';

/** The columns of a `bars` row that tagging is allowed to look at. */
export type TaggableRow = {
  name: string;
  blurb?: string | null;
  /** `price_tier`; the table constrains it to 1–4, but this is a boundary. */
  priceTier?: number | null;
  /** `tags` as stored — unknown words are dropped, not trusted. */
  tags?: readonly string[] | null;
};

function priceTag(priceTier: number | null | undefined): VibeTag {
  return (typeof priceTier === 'number' && PRICE_TAGS[priceTier]) || DEFAULT_PRICE_TAG;
}

/**
 * Tags for a row that has none: keyword hits over name + blurb, plus the
 * price tag. The price tag ALWAYS fires, which is why this can never return
 * an empty list and why every bar ends up with at least one tag.
 */
function deriveTags(row: TaggableRow): VibeTag[] {
  const text = `${row.name ?? ''} ${row.blurb ?? ''}`;
  const derived: VibeTag[] = [];
  const seen = new Set<VibeTag>();
  const add = (tag: VibeTag): void => {
    if (seen.has(tag)) return;
    seen.add(tag);
    derived.push(tag);
  };
  for (const [pattern, tags] of KEYWORD_TAGS) {
    if (!pattern.test(text)) continue;
    for (const tag of tags) add(tag);
  }
  add(priceTag(row.priceTier));
  return derived;
}

/**
 * The tags a bar row should carry: between 1 and MAX_VENUE_TAGS, drawn only
 * from the VibeTag vocabulary, and a pure function of the row.
 *
 * A row that already has usable tags keeps them, in their stored order — the
 * point of this pass is the 132 empty rows and the 100 over-cap ones, not a
 * rewrite of ~1,400 rows that are already correct. Only a row over the cap is
 * re-ordered, and then by TAG_PRIORITY.
 */
export function venueTags(row: TaggableRow): VibeTag[] {
  const stored: VibeTag[] = [];
  const seen = new Set<string>();
  for (const tag of row.tags ?? []) {
    if (!KNOWN_TAGS.has(tag) || seen.has(tag)) continue;
    seen.add(tag);
    stored.push(tag as VibeTag);
  }
  const tags = stored.length > 0 ? stored : deriveTags(row);
  if (tags.length <= MAX_VENUE_TAGS) return tags;
  return [...tags]
    .sort((a, b) => (PRIORITY_RANK.get(a) as number) - (PRIORITY_RANK.get(b) as number))
    .slice(0, MAX_VENUE_TAGS);
}
