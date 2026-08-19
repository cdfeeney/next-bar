import type { VibeTag } from '@/types';
import { TAG_VOCABULARY } from '@/lib/catalog';
import { MAX_VENUE_TAGS, PRICE_TAG_GLYPHS, TAG_PRIORITY } from '@/lib/tagDisplay';

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

/**
 * The cap and the drop order both come from `tagDisplay.ts`, which already
 * declares itself "the single source of truth ... there is no second ordering
 * anywhere". An earlier draft of this file minted its own TAG_PRIORITY that
 * ranked price third; because `topVenueTags()` DROPS price chips (the lightbox
 * renders price from `priceTier`), storing a price tag inside the five cost the
 * venue a visible chip. One ordering, so the five that are stored are the five
 * that render.
 *
 * The trade that buys: an over-cap row no longer keeps its price tag, so its
 * quiz price overlap in `jaccard(quizTags, bar.tags)` is lost. That term is a
 * cold-start prior, not a permanent weighted one, and `bars.price_tier` still
 * carries the price — a chip a customer sees on every view is worth more.
 */
export { MAX_VENUE_TAGS };

/** Price tags never render as chips, so they can never satisfy "has a tag". */
const isPriceTag = (tag: VibeTag): boolean => Object.hasOwn(PRICE_TAG_GLYPHS, tag);

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

/**
 * The venue tag for a row that produced no displayable tag at all — same
 * fallback, and the same reasoning, as `scripts/ingest-bars.ts`'s
 * `if (tags.size === 0) tags.add('cocktail')`.
 */
const DEFAULT_VENUE_TAG: VibeTag = 'cocktail';

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
 * price tag. The price tag ALWAYS fires, so this is never empty — but a row
 * that matched no keyword comes back price-only, which renders as no chips at
 * all. venueTags() below is where that is made displayable.
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
 * re-ordered, and then by tagDisplay's TAG_PRIORITY, so `topVenueTags()` over
 * the result renders exactly what it rendered over the untrimmed row.
 */
export function venueTags(row: TaggableRow): VibeTag[] {
  const stored: VibeTag[] = [];
  const seen = new Set<string>();
  for (const tag of row.tags ?? []) {
    if (!KNOWN_TAGS.has(tag) || seen.has(tag)) continue;
    seen.add(tag);
    stored.push(tag as VibeTag);
  }
  const derived = stored.length > 0 ? stored : deriveTags(row);
  // "At least one tag" has to mean at least one tag a customer SEES.
  // topVenueTags() filters every price tag out, so a price-only row renders an
  // empty chip row and the backfill would report it fixed while it is not.
  const tags = derived.some((tag) => !isPriceTag(tag))
    ? derived
    : [DEFAULT_VENUE_TAG, ...derived];
  if (tags.length <= MAX_VENUE_TAGS) return tags;
  // Price ranks last in TAG_PRIORITY, so the survivors are the highest-ranked
  // displayable tags — the same five, in the same order, the lightbox picks.
  return [...tags]
    .sort((a, b) => TAG_PRIORITY[a] - TAG_PRIORITY[b])
    .slice(0, MAX_VENUE_TAGS);
}
