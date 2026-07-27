import { describe, it, expect } from 'vitest';
import type { VibeTag } from '@/types';
import { TAG_VOCABULARY } from '@/lib/catalog';
import { barVisual, barImageUrl,
  barImageUrls, TAG_GLYPH } from '@/lib/barVisual';

// Minimal bar factory — barVisual only reads name/tags/priceTier and
// barImageUrl only reads id/photoRef, so tests pass exactly those.
function visualInput(overrides: {
  name?: string;
  tags?: VibeTag[];
  priceTier?: 1 | 2 | 3 | 4;
} = {}) {
  return {
    name: overrides.name ?? 'Test Bar',
    tags: overrides.tags ?? (['dive'] as VibeTag[]),
    priceTier: overrides.priceTier ?? 2,
  } as const;
}

describe('barVisual', () => {
  it('is deterministic: identical input produces identical output across calls', () => {
    const bar = visualInput({ name: 'Attaboy', tags: ['cocktail', 'speakeasy'], priceTier: 3 });
    const a = barVisual(bar);
    const b = barVisual(bar);
    expect(a).toEqual(b);
    // And a structurally-equal (not same-reference) input agrees too.
    const c = barVisual(visualInput({ name: 'Attaboy', tags: ['cocktail', 'speakeasy'], priceTier: 3 }));
    expect(a).toEqual(c);
  });

  it('covers every VibeTag in the vocabulary with a non-empty glyph', () => {
    // TAG_GLYPH is Record<VibeTag, string> so tsc enforces exhaustiveness;
    // this asserts the runtime values are real glyphs, not empty strings.
    for (const tag of TAG_VOCABULARY) {
      expect(TAG_GLYPH[tag], `glyph for ${tag}`).toBeTruthy();
      const v = barVisual(visualInput({ tags: [tag] }));
      expect(v.glyph).toBe(TAG_GLYPH[tag]);
      expect(v.bg).toMatch(/^hsl\(/);
      expect(v.fg).toMatch(/^hsl\(/);
    }
  });

  it('uses the FIRST tag as the primary vibe tag', () => {
    const v = barVisual(visualInput({ tags: ['jazz', 'dive', 'cheap'] }));
    expect(v.glyph).toBe(TAG_GLYPH.jazz);
  });

  it('distinct primary tags produce distinct backgrounds (same tier)', () => {
    const bgs = new Set(
      TAG_VOCABULARY.map((tag) => barVisual(visualInput({ tags: [tag] })).bg),
    );
    expect(bgs.size).toBe(TAG_VOCABULARY.length);
  });

  it('priceTier shifts the background but keeps the glyph', () => {
    const tiers = [1, 2, 3, 4] as const;
    const visuals = tiers.map((priceTier) => barVisual(visualInput({ tags: ['wine'], priceTier })));
    expect(new Set(visuals.map((v) => v.bg)).size).toBe(4);
    expect(new Set(visuals.map((v) => v.glyph)).size).toBe(1);
  });

  it('falls back to a 2-letter monogram when a bar has no tags', () => {
    const twoWords = barVisual(visualInput({ name: 'Dead Rabbit', tags: [] }));
    expect(twoWords.glyph).toBe('DR');
    const oneWord = barVisual(visualInput({ name: 'Attaboy', tags: [] }));
    expect(oneWord.glyph).toBe('AT');
    // Punctuated names take word initials, skipping non-alphanumerics.
    const punctuated = barVisual(visualInput({ name: "P.J. Clarke's", tags: [] }));
    expect(punctuated.glyph).toBe('PC');
    // Monogram path is deterministic too.
    expect(barVisual(visualInput({ name: 'Dead Rabbit', tags: [] }))).toEqual(twoWords);
  });
});

describe('barImageUrl', () => {
  it('returns the local photo path when photoRef is present', () => {
    expect(barImageUrl({ id: 'attaboy', photoRef: 'places/abc/photos/def' }))
      .toBe('/bar-photos/attaboy.webp');
  });

  it('returns null when photoRef is absent', () => {
    expect(barImageUrl({ id: 'attaboy' })).toBeNull();
    expect(barImageUrl({ id: 'attaboy', photoRef: undefined })).toBeNull();
  });
});

describe('barImageUrls (carousel)', () => {
  it('maps photoCount to legacy-first file names', () => {
    expect(
      barImageUrls({ id: 'attaboy', photoRef: 'places/x/photos/a', photoCount: 3 }),
    ).toEqual([
      '/bar-photos/attaboy.webp',
      '/bar-photos/attaboy-2.webp',
      '/bar-photos/attaboy-3.webp',
    ]);
  });

  it('falls back to the single legacy photo pre-ingest, and [] with none', () => {
    expect(
      barImageUrls({ id: 'attaboy', photoRef: 'places/x/photos/a' }),
    ).toEqual(['/bar-photos/attaboy.webp']);
    expect(barImageUrls({ id: 'attaboy', photoRef: undefined })).toEqual([]);
  });
});
