import { describe, expect, it } from 'vitest';
import { TAG_VOCABULARY } from '@/lib/catalog';
import { bars as staticCatalog } from '@/lib/bars';
import {
  MAX_VENUE_TAGS,
  TAG_PRIORITY,
  venueTags,
  type TaggableRow,
} from '@/lib/venueTags';
import type { VibeTag } from '@/types';

const row = (over: Partial<TaggableRow> = {}): TaggableRow => ({
  name: 'Some Bar',
  blurb: '',
  priceTier: 2,
  tags: [],
  ...over,
});

describe('TAG_PRIORITY', () => {
  it('is a total order over the whole tag vocabulary', () => {
    expect([...TAG_PRIORITY].sort()).toEqual([...TAG_VOCABULARY].sort());
    expect(new Set(TAG_PRIORITY).size).toBe(TAG_PRIORITY.length);
  });

  it('ranks price above crowd, texture and energy so the quiz keeps matching', () => {
    const rank = (tag: VibeTag): number => TAG_PRIORITY.indexOf(tag);
    for (const price of ['cheap', 'mid', 'pricey', 'splurge'] as const) {
      for (const weaker of ['date', 'locals', 'polished', 'chill', 'buzzy'] as const) {
        expect(rank(price)).toBeLessThan(rank(weaker));
      }
    }
  });
});

describe('venueTags — the cap', () => {
  it('never returns more than five tags', () => {
    const seven: VibeTag[] = [
      'chill', 'buzzy', 'date', 'polished', 'cocktail', 'pricey', 'speakeasy',
    ];
    expect(venueTags(row({ tags: seven }))).toHaveLength(MAX_VENUE_TAGS);
  });

  it('drops tags six and seven by priority, not by stored order', () => {
    const seven: VibeTag[] = [
      'chill', 'buzzy', 'date', 'polished', 'cocktail', 'pricey', 'speakeasy',
    ];
    // venue type first (cocktail, speakeasy), then price, then crowd, then
    // texture; 'chill' and 'buzzy' are energy and are what gets dropped.
    expect(venueTags(row({ tags: seven }))).toEqual([
      'cocktail', 'speakeasy', 'pricey', 'date', 'polished',
    ]);
  });

  it('leaves a row at or under the cap exactly as stored', () => {
    const five: VibeTag[] = ['chill', 'buzzy', 'date', 'polished', 'cocktail'];
    expect(venueTags(row({ tags: five }))).toEqual(five);
    expect(venueTags(row({ tags: ['buzzy', 'dive'] }))).toEqual(['buzzy', 'dive']);
  });

  it('trims to the same five whatever order the row stored them in', () => {
    const seven: VibeTag[] = [
      'chill', 'buzzy', 'date', 'polished', 'cocktail', 'pricey', 'speakeasy',
    ];
    const reversed = [...seven].reverse();
    expect(venueTags(row({ tags: reversed }))).toEqual(venueTags(row({ tags: seven })));
  });
});

describe('venueTags — the empty rows', () => {
  it('always returns at least one tag, even with no name signal at all', () => {
    expect(venueTags(row({ name: '', blurb: null, tags: null }))).toEqual(['mid']);
  });

  it('falls back to the price tag for every price tier', () => {
    expect(venueTags(row({ priceTier: 1 }))).toEqual(['cheap']);
    expect(venueTags(row({ priceTier: 2 }))).toEqual(['mid']);
    expect(venueTags(row({ priceTier: 3 }))).toEqual(['pricey']);
    expect(venueTags(row({ priceTier: 4 }))).toEqual(['splurge']);
  });

  it('falls back to mid when price_tier is missing or out of range', () => {
    expect(venueTags(row({ priceTier: null }))).toEqual(['mid']);
    expect(venueTags(row({ priceTier: 9 }))).toEqual(['mid']);
  });

  it('derives from the name', () => {
    expect(venueTags(row({ name: 'The Rooftop at Sixty', priceTier: 3 })))
      .toEqual(['rooftop', 'instagrammable', 'pricey']);
  });

  it('derives from the blurb as well as the name', () => {
    expect(venueTags(row({ name: 'Milady', blurb: 'A no-frills dive with cheap beer.', priceTier: 1 })))
      .toEqual(['dive', 'rough', 'beer', 'buzzy', 'cheap']);
  });

  it('caps a derived row that matched many keywords', () => {
    const tags = venueTags(row({
      name: 'The Hidden Garden Jazz Lounge',
      blurb: 'Rooftop cocktail bar with a beer tap and a dance floor.',
      priceTier: 4,
    }));
    expect(tags).toHaveLength(MAX_VENUE_TAGS);
    expect(new Set(tags).size).toBe(MAX_VENUE_TAGS);
  });
});

describe('venueTags — vocabulary and hygiene', () => {
  it('only ever emits tags from the VibeTag vocabulary', () => {
    const known = new Set<string>(TAG_VOCABULARY);
    const rows = [
      row({ name: 'Rooftop Wine Jazz Pub Dive Cocktail Brew Garden Nightclub Kitchen' }),
      row({ name: '', priceTier: 1 }),
      row({ tags: ['dive', 'cocktail'] }),
    ];
    for (const r of rows) {
      for (const tag of venueTags(r)) expect(known.has(tag)).toBe(true);
    }
  });

  it('drops tag words that are not in the vocabulary', () => {
    expect(venueTags(row({ tags: ['dive', 'sports', 'gay-bar'] }))).toEqual(['dive']);
  });

  it('derives when every stored tag is unknown, rather than returning nothing', () => {
    expect(venueTags(row({ name: 'Nowhere', tags: ['sports'], priceTier: 3 })))
      .toEqual(['pricey']);
  });

  it('de-duplicates repeated stored tags', () => {
    expect(venueTags(row({ tags: ['dive', 'dive', 'cheap'] }))).toEqual(['dive', 'cheap']);
  });
});

describe('venueTags — the PRD invariant over the real catalog', () => {
  // Acceptance criteria 1 and 2 as an assertion rather than a claim: run the
  // derivation over every venue the repo actually ships and check the two
  // counts the goal names. The staging TABLE is a superset of this catalog and
  // the function is the same one the backfill script calls, so a violation
  // here is a violation there.
  const tagged = staticCatalog.map((bar) => ({
    id: bar.id,
    tags: venueTags({
      name: bar.name, blurb: bar.blurb, priceTier: bar.priceTier, tags: bar.tags,
    }),
  }));

  it('reads a non-trivial catalog, so the counts below mean something', () => {
    expect(tagged.length).toBeGreaterThan(300);
  });

  it('leaves no venue untagged', () => {
    expect(tagged.filter((bar) => bar.tags.length === 0).map((bar) => bar.id)).toEqual([]);
  });

  it('leaves no venue over the five-tag cap', () => {
    expect(tagged.filter((bar) => bar.tags.length > MAX_VENUE_TAGS).map((bar) => bar.id))
      .toEqual([]);
  });

  it('emits only vocabulary tags, with no duplicates within a venue', () => {
    const known = new Set<string>(TAG_VOCABULARY);
    for (const bar of tagged) {
      expect(new Set(bar.tags).size).toBe(bar.tags.length);
      for (const tag of bar.tags) expect(known.has(tag)).toBe(true);
    }
  });
});

describe('venueTags — determinism', () => {
  const cases: TaggableRow[] = [
    row({ name: 'The Rooftop at Sixty', priceTier: 3 }),
    row({ name: '', blurb: null, priceTier: null, tags: null }),
    row({ name: 'Milady', blurb: 'A no-frills dive with cheap beer.', priceTier: 1 }),
    row({ tags: ['chill', 'buzzy', 'date', 'polished', 'cocktail', 'pricey', 'speakeasy'] }),
    row({ tags: ['dive', 'cheap'] }),
  ];

  it('returns an identical result on repeated calls', () => {
    for (const r of cases) {
      const first = venueTags(r);
      for (let i = 0; i < 5; i += 1) expect(venueTags(r)).toEqual(first);
    }
  });

  it('is idempotent: feeding the output back in changes nothing', () => {
    // This is the property the backfill script's zero-row second run rests on.
    for (const r of cases) {
      const once = venueTags(r);
      expect(venueTags({ ...r, tags: once })).toEqual(once);
    }
  });

  it('is idempotent over the whole real catalog, not just synthetic rows', () => {
    // The zero-row second pass the backfill script promises, exercised against
    // the 400+ real venues the repo ships rather than five hand-written ones.
    for (const bar of staticCatalog) {
      const once = venueTags({
        name: bar.name, blurb: bar.blurb, priceTier: bar.priceTier, tags: bar.tags,
      });
      expect(venueTags({
        name: bar.name, blurb: bar.blurb, priceTier: bar.priceTier, tags: once,
      })).toEqual(once);
    }
  });

  it('does not mutate the row it was given', () => {
    const tags: VibeTag[] = [
      'chill', 'buzzy', 'date', 'polished', 'cocktail', 'pricey', 'speakeasy',
    ];
    const input = row({ tags });
    venueTags(input);
    expect(tags).toEqual([
      'chill', 'buzzy', 'date', 'polished', 'cocktail', 'pricey', 'speakeasy',
    ]);
    expect(input.tags).toBe(tags);
  });
});
