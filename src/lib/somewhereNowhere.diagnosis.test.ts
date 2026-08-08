import { describe, expect, test, afterEach, vi } from 'vitest';
import { bars } from '@/lib/bars';
import { resolveMedia, resolveFallbackMedia } from '@/lib/mediaPolicy';
import { barImageUrls } from '@/lib/barVisual';
import { rowsToCatalog, type BarsTableRow } from '@/lib/catalogServer';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Item 7 (goal g-bfb6937a) — why does the Somewhere Nowhere card show no photos?
 *
 * This pins the LOCAL half of the diagnosis as executable evidence rather
 * than prose, so the conclusion cannot rot. It deliberately asserts the
 * DATA is complete on every layer, because "the data is missing" is the
 * conclusion a careless check reaches: the DB row spells the field
 * `photo_count` (snake_case), and a `photoCount` lookup against that row
 * returns `undefined`.
 *
 * Nothing here touches Staging or invokes a live Google widget.
 */

const ID = 'somewhere-nowhere-nyc';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('Item 7 — catalog data for Somewhere Nowhere is COMPLETE', () => {
  test('the static catalog (after applyPlaces) carries place id, photoCount and photoRef', () => {
    const bar = bars.find((b) => b.id === ID);
    expect(bar, 'bar missing from the static catalog').toBeDefined();
    // Criterion 1 + 2.
    expect(bar!.name).toBe('Somewhere Nowhere NYC');
    expect(bar!.googlePlaceId).toHaveLength(27);
    expect(bar!.photoCount).toBe(3);
    expect(bar!.photoRef).toBeTruthy();
    expect(bar!.photoAttributions).toHaveLength(3);
  });

  test('the DB-shaped row maps through rowsToCatalog with no snake/camel loss', () => {
    // Criterion 7: the boundary, checked at the layer that actually crosses it.
    const rows = JSON.parse(
      readFileSync(
        path.join(__dirname, '..', '..', 'e2e', 'fixtures', 'catalog-rows.json'),
        'utf8',
      ),
    ) as BarsTableRow[];
    const row = rows.find((r) => r.id === ID);
    expect(row, 'bar missing from the catalog fixture').toBeDefined();

    // The row really is snake_case, and the camelCase read really is undefined.
    // This is the trap that would produce a false "data is missing" verdict.
    expect(row!.photo_count).toBe(3);
    expect((row as unknown as Record<string, unknown>).photoCount).toBeUndefined();
    expect((row as unknown as Record<string, unknown>).googlePlaceId).toBeUndefined();

    // One shared mapper does the conversion, and BOTH the server loader and
    // the client-side CatalogRefresh swap import it — so there is no second
    // place for the boundary to drift. The whole fixture is passed because
    // rowsToCatalog applies a size sanity guard and returns null for a
    // suspiciously small result, so a one-row call would prove nothing.
    const catalog = rowsToCatalog(rows, bars.length);
    expect(catalog, 'rowsToCatalog rejected the fixture as too small').not.toBeNull();
    const mapped = catalog!.find((b) => b.id === ID);
    expect(mapped, 'bar dropped by the mapper').toBeDefined();
    expect(mapped!.googlePlaceId).toHaveLength(27);
    expect(mapped!.photoCount).toBe(3);

    // CROSS-SOURCE IDENTITY, not just a length check.
    //
    // Asserting only `toHaveLength(27)` on each source independently would
    // still pass if the two sources named DIFFERENT venues — swap either for
    // any other 27-char place id and nothing here would notice, while the card
    // would request the wrong bar. Pinning them equal is what makes "the data
    // is internally consistent" mean something. (santa: Codex.)
    //
    // It still does NOT establish that this id is the correct id for the real
    // Somewhere Nowhere, or that Google currently holds photos for it. Both are
    // attended steps 2-3; see the diagnosis document.
    const staticBar = bars.find((b) => b.id === ID)!;
    expect(mapped!.googlePlaceId).toBe(staticBar.googlePlaceId);
    expect(row!.place_id).toBe(staticBar.googlePlaceId);
    expect(row!.photo_count).toBe(staticBar.photoCount);
  });
});

describe('Item 7 — what each media tier resolves to for this bar', () => {
  const bar = () => bars.find((b) => b.id === ID)!;

  test('BOTH flags off (the shipped default) resolves to glyph — no photos, by design', () => {
    vi.stubEnv('NEXT_PUBLIC_GOOGLE_MEDIA', '');
    vi.stubEnv('NEXT_PUBLIC_LEGACY_PHOTOS', '');
    // This is the whole answer to "shows no photos" in a default build:
    // both Google tiers are fail-closed, and this bar has no owned photos.
    expect(resolveMedia(bar()).source).toBe('glyph');
  });

  test('google-live ON resolves to the widget with the real place id', () => {
    vi.stubEnv('NEXT_PUBLIC_GOOGLE_MEDIA', '1');
    const decision = resolveMedia(bar());
    expect(decision.source).toBe('google-live');
    expect(
      decision.source === 'google-live' ? decision.placeId : null,
    ).toBe(bar().googlePlaceId);
  });

  test('legacy ON resolves to three /bar-photos files that exist on disk', () => {
    vi.stubEnv('NEXT_PUBLIC_GOOGLE_MEDIA', '');
    vi.stubEnv('NEXT_PUBLIC_LEGACY_PHOTOS', '1');
    const decision = resolveMedia(bar());
    expect(decision.source).toBe('legacy-google-cached');
    const urls = decision.source === 'legacy-google-cached' ? decision.urls : [];
    expect(urls).toEqual([
      '/bar-photos/somewhere-nowhere-nyc.webp',
      '/bar-photos/somewhere-nowhere-nyc-2.webp',
      '/bar-photos/somewhere-nowhere-nyc-3.webp',
    ]);
    // The files are really there — so a 404-then-glyph carousel failure is
    // NOT the mechanism either.
    for (const u of urls) {
      expect(() =>
        readFileSync(path.join(__dirname, '..', '..', 'public', u)),
      ).not.toThrow();
    }
  });

  test('the widget fallback can never be a re-hosted Google photo', () => {
    vi.stubEnv('NEXT_PUBLIC_GOOGLE_MEDIA', '1');
    vi.stubEnv('NEXT_PUBLIC_LEGACY_PHOTOS', '1');
    // resolveFallbackMedia forces BOTH Google tiers off, so the widget's
    // failure branch cannot quietly serve the legacy files.
    expect(resolveFallbackMedia(bar()).source).toBe('glyph');
  });

  test('barImageUrls derives its URLs from photoCount, not photoRef', () => {
    // Documents why a missing photoRef would NOT have suppressed the legacy
    // tier for this bar: the multi-photo branch never consults photoRef.
    expect(barImageUrls({ id: ID, photoCount: 3 })).toHaveLength(3);
    expect(barImageUrls({ id: ID, photoCount: 0, photoRef: 'x' })).toEqual([
      '/bar-photos/somewhere-nowhere-nyc.webp',
    ]);
    expect(barImageUrls({ id: ID, photoCount: 0 })).toEqual([]);
  });
});
