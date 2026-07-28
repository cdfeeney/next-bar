import { describe, it, expect } from 'vitest';
import type { Bar, PlacePatch } from '@/types';
import { applyPlaces, bars } from '@/lib/bars';
import { rawBarCount } from '@/lib/catalog.slim';

// Normalize a bar name for duplicate detection: fold case, punctuation, and the
// filler words that let the same venue slip in twice under slightly different
// spellings ("Freddy's" vs "Freddy's Bar", "Death & Co" vs "Death and Co").
function normName(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\band\b/g, '')
    .replace(/\bthe\b/g, '')
    .replace(/[^a-z0-9]/g, '');
}

describe('bars catalog integrity', () => {
  it('has no duplicate ids', () => {
    const seen = new Map<string, number>();
    for (const b of bars) seen.set(b.id, (seen.get(b.id) ?? 0) + 1);
    const dupes = [...seen.entries()].filter(([, n]) => n > 1).map(([id]) => id);
    expect(dupes).toEqual([]);
  });

  it('has no duplicate venues (same normalized name in the same neighborhood)', () => {
    const seen = new Map<string, string[]>();
    for (const b of bars) {
      const key = `${normName(b.name)}|${b.neighborhood}`;
      seen.set(key, [...(seen.get(key) ?? []), b.name]);
    }
    const dupes = [...seen.entries()].filter(([, names]) => names.length > 1);
    // Surface the offending names so a failure is actionable.
    expect(dupes.map(([, names]) => names)).toEqual([]);
  });

  it('every bar has valid coords inside the service bbox', () => {
    const BBOX = { minLat: 40.64, maxLat: 40.885, minLng: -74.03, maxLng: -73.89 };
    const outOfBox = bars.filter(
      (b) => b.lat < BBOX.minLat || b.lat > BBOX.maxLat || b.lng < BBOX.minLng || b.lng > BBOX.maxLng,
    );
    expect(outOfBox.map((b) => `${b.name} (${b.lat},${b.lng})`)).toEqual([]);
  });

  it('the slim edge-catalog view merges the SAME expansion files as bars.ts', () => {
    // catalog.slim.ts exists so the share OG edge function skips the
    // Places sidecar (1MB edge limit). tsc cannot catch a forgotten
    // spread there — this count cross-check can.
    expect(rawBarCount).toBe(bars.length);
  });
});

describe('applyPlaces wrong-venue guard', () => {
  const curated: Bar = {
    id: 'test-bar',
    name: 'Test Bar',
    neighborhood: 'LES',
    address: '1 Test St',
    lat: 40.7188,
    lng: -73.9913,
    priceTier: 2,
    tags: ['dive'],
    blurb: 'test',
    lastVerified: '2026-04-01',
  };

  const photoFields: PlacePatch = {
    photoRef: 'places/abc/photos/def',
    photoAttribution: 'A Google User',
    reviews: [{ text: 'Great spot', author: 'Reviewer', rating: 5 }],
  };

  it('passes photo fields through for an in-area patch', () => {
    const [out] = applyPlaces([curated], {
      'test-bar': { lat: 40.72, lng: -73.99, ...photoFields },
    });
    expect(out.lat).toBe(40.72);
    expect(out.photoRef).toBe(photoFields.photoRef);
    expect(out.photoAttribution).toBe(photoFields.photoAttribution);
  });

  // INVERTED 2026-07-28. This previously asserted that `reviews` were merged
  // through, which is exactly the route by which Google review text reached
  // BarLightbox even after migration 0023 nulled the database column. The merge
  // is gone and the data with it (750 items across 250 sidecar entries), so the
  // test now guards the removal instead of the behaviour.
  it('NEVER merges Google review text, even when a patch supplies it', () => {
    const [out] = applyPlaces([curated], {
      'test-bar': { lat: 40.72, lng: -73.99, ...photoFields },
    });
    expect(out.reviews).toBeUndefined();
  });

  it('drops photo + review fields together with rejected out-of-area coords', () => {
    // Nassau County coords → wrong venue → NOTHING in the patch is trusted:
    // the photo and reviews belong to that other place too.
    const [out] = applyPlaces([curated], {
      'test-bar': { lat: 40.7, lng: -73.6, ...photoFields },
    });
    expect(out).toEqual(curated);
    expect(out.photoRef).toBeUndefined();
    expect(out.reviews).toBeUndefined();
  });
});
