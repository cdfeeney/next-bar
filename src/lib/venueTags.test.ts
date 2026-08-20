import { describe, expect, it } from 'vitest';
import { TAG_VOCABULARY } from '@/lib/catalog';
import { bars as staticCatalog } from '@/lib/bars';
import { MAX_VENUE_TAGS, TAG_PRIORITY, topVenueTags } from '@/lib/tagDisplay';
import { venueTags, type TaggableRow } from '@/lib/venueTags';
import type { VibeTag } from '@/types';

const row = (over: Partial<TaggableRow> = {}): TaggableRow => ({
  name: 'Some Bar',
  blurb: '',
  priceTier: 2,
  tags: [],
  ...over,
});

describe('venueTags — one ordering, shared with the lightbox', () => {
  const SEVEN: VibeTag[] = [
    'chill', 'buzzy', 'date', 'polished', 'cocktail', 'pricey', 'speakeasy',
  ];

  it('keeps the row’s own ordering among the survivors', () => {
    // Little Branch, from the real catalog: it leads with 'speakeasy' and must
    // still lead with it after the trim.
    const littleBranch: VibeTag[] = [
      'speakeasy', 'cocktail', 'jazz', 'date', 'pricey', 'lounge', 'romantic',
    ];
    expect(venueTags(row({ tags: littleBranch, priceTier: 3 })))
      .toEqual(['speakeasy', 'cocktail', 'jazz', 'lounge', 'romantic']);
  });

  it('stores the five tags the lightbox would have rendered from the full set', () => {
    // The regression this suite exists to prevent: trimming for STORAGE used to
    // keep a price tag, which topVenueTags() drops, so an over-cap venue
    // rendered four chips after the backfill where it rendered five before.
    expect(topVenueTags(venueTags(row({ tags: SEVEN })))).toEqual(topVenueTags(SEVEN));
    expect(topVenueTags(venueTags(row({ tags: SEVEN })))).toHaveLength(MAX_VENUE_TAGS);
  });

  it('ranks by tagDisplay TAG_PRIORITY, so price is what a trim gives up', () => {
    const rank = (tag: VibeTag): number => TAG_PRIORITY[tag];
    for (const price of ['cheap', 'mid', 'pricey', 'splurge'] as const) {
      for (const displayable of ['date', 'locals', 'polished', 'chill', 'buzzy'] as const) {
        expect(rank(price)).toBeGreaterThan(rank(displayable));
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
    // WHICH five survive is tagDisplay's order — venue types lead, price ranks
    // last of all, so 'pricey' and 'date' are what get dropped. The ORDER of
    // the survivors is the row's own, because barVisual() reads tags[0].
    expect(venueTags(row({ tags: seven }))).toEqual([
      'chill', 'buzzy', 'polished', 'cocktail', 'speakeasy',
    ]);
  });

  it('leaves a row at or under the cap exactly as stored', () => {
    const five: VibeTag[] = ['chill', 'buzzy', 'date', 'polished', 'cocktail'];
    expect(venueTags(row({ tags: five }))).toEqual(five);
    expect(venueTags(row({ tags: ['buzzy', 'dive'] }))).toEqual(['buzzy', 'dive']);
  });

  it('drops the same two whatever order the row stored them in', () => {
    // WHICH five survive is a function of the SET, never of the input order —
    // that is criterion 4. The order they come back in is the row's own, so
    // compare the sets, not the sequences.
    const seven: VibeTag[] = [
      'chill', 'buzzy', 'date', 'polished', 'cocktail', 'pricey', 'speakeasy',
    ];
    const reversed = [...seven].reverse();
    expect([...venueTags(row({ tags: reversed }))].sort())
      .toEqual([...venueTags(row({ tags: seven }))].sort());
    expect(venueTags(row({ tags: reversed })))
      .toEqual(['speakeasy', 'cocktail', 'polished', 'buzzy', 'chill']);
  });
});

describe('venueTags — the empty rows', () => {
  it('always returns at least one DISPLAYABLE tag, with no name signal at all', () => {
    // A price-only row satisfies "has a tag" in the table and renders nothing
    // at all in the lightbox, which is the defect this pass exists to close.
    expect(venueTags(row({ name: '', blurb: null, tags: null }))).toEqual(['cocktail', 'mid']);
    expect(topVenueTags(venueTags(row({ name: '', blurb: null, tags: null })))).not.toEqual([]);
  });

  it('falls back to the price tag for every price tier', () => {
    expect(venueTags(row({ priceTier: 1 }))).toEqual(['cocktail', 'cheap']);
    expect(venueTags(row({ priceTier: 2 }))).toEqual(['cocktail', 'mid']);
    expect(venueTags(row({ priceTier: 3 }))).toEqual(['cocktail', 'pricey']);
    expect(venueTags(row({ priceTier: 4 }))).toEqual(['cocktail', 'splurge']);
  });

  it('falls back to mid when price_tier is missing or out of range', () => {
    expect(venueTags(row({ priceTier: null }))).toEqual(['cocktail', 'mid']);
    expect(venueTags(row({ priceTier: 9 }))).toEqual(['cocktail', 'mid']);
  });

  it('does not add the default when a keyword already gave a displayable tag', () => {
    expect(venueTags(row({ name: 'The Rooftop at Sixty', priceTier: 3 })))
      .not.toContain('cocktail');
  });

  it('derives from the row when every stored tag is a price tag', () => {
    // A price-only row is as good as untagged: keeping it and prepending the
    // generic default would label a rooftop bar a cocktail bar.
    expect(venueTags(row({ name: 'The Rooftop at Sixty', priceTier: 3, tags: ['pricey'] })))
      .toEqual(['rooftop', 'instagrammable', 'pricey']);
  });

  it('falls back to the default only when derivation is also price-only', () => {
    expect(venueTags(row({ name: 'Nowhere', priceTier: 2, tags: ['pricey'] })))
      .toEqual(['cocktail', 'mid']);
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
      .toEqual(['cocktail', 'pricey']);
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

  it('leaves no venue without a tag the lightbox will actually render', () => {
    expect(tagged.filter((bar) => topVenueTags(bar.tags).length === 0).map((bar) => bar.id))
      .toEqual([]);
  });

  it('keeps every venue’s primary tag, which barVisual() paints it from', () => {
    // barVisual() reads tags[0] as the venue's identity, so a trim that
    // re-ordered survivors would silently repaint the catalog.
    const repainted = staticCatalog.filter((bar) => {
      const after = venueTags({
        name: bar.name, blurb: bar.blurb, priceTier: bar.priceTier, tags: bar.tags,
      });
      return (bar.tags ?? []).length > 0 && after[0] !== bar.tags[0];
    });
    expect(repainted.map((bar) => bar.id)).toEqual([]);
  });

  it('never costs an already-tagged venue a chip it renders today', () => {
    // The storage trim and the display trim must agree: for every venue that
    // already has tags, what the lightbox shows after this pass is exactly what
    // it showed before it.
    const regressed = staticCatalog
      .filter((bar) => (bar.tags ?? []).length > 0)
      .filter((bar) => {
        const after = venueTags({
          name: bar.name, blurb: bar.blurb, priceTier: bar.priceTier, tags: bar.tags,
        });
        const before = topVenueTags(bar.tags);
        const rendered = topVenueTags(after);
        return rendered.length !== before.length
          || rendered.some((tag, i) => tag !== before[i]);
      });
    expect(regressed.map((bar) => bar.id)).toEqual([]);
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
