import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import type { Bar, PlacePatch } from '@/types';
import { applyPlaces, bars } from '@/lib/bars';
import { rawBarCount } from '@/lib/catalog.slim';
import { SERVICE_AREA_BBOX } from '@/lib/constants';

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

  it('passes photo fields through', () => {
    const [out] = applyPlaces([curated], { 'test-bar': { ...photoFields } });
    expect(out.photoRef).toBe(photoFields.photoRef);
    expect(out.photoAttribution).toBe(photoFields.photoAttribution);
  });

  // 2026-07-29: the patch no longer carries coordinates at all. Google permits
  // caching lat/lng for 30 consecutive days and this sidecar is committed to git
  // and shipped to every client, so storing them was non-compliant by
  // construction. Coordinates come from OpenStreetMap via the curated catalog.
  it('NEVER changes a curated coordinate', () => {
    const [out] = applyPlaces([curated], {
      // Cast: lat/lng are gone from PlacePatch. A stale generated sidecar, or a
      // regression in refresh-places.mjs, could still supply them — this proves
      // they would be ignored rather than silently overriding curated data.
      'test-bar': { ...photoFields, lat: 40.99, lng: -73.7 } as PlacePatch,
    });
    expect(out.lat).toBe(curated.lat);
    expect(out.lng).toBe(curated.lng);
  });

  // INVERTED 2026-07-28. This previously asserted that `reviews` were merged
  // through, which is exactly the route by which Google review text reached
  // BarLightbox even after migration 0023 nulled the database column. The merge
  // is gone and the data with it (750 items across 250 sidecar entries), so the
  // test now guards the removal instead of the behaviour.
  it('NEVER merges Google review text, even when a patch supplies it', () => {
    const [out] = applyPlaces([curated], { 'test-bar': { ...photoFields } });
    expect(out.reviews).toBeUndefined();
  });
});

/**
 * The wrong-venue guard MOVED to generation time on 2026-07-29 rather than being
 * deleted. It used to reject any patch whose Google coordinates fell outside the
 * service area, dropping hours and photos with them. Removing the coordinates
 * removed its input, so scripts/refresh-places.mjs now discards an out-of-area
 * match before writing it — the bad data never ships at all.
 *
 * These tests exist because that protection is now enforced in a plain .mjs
 * script with no type checking and no unit tests of its own. Without them the
 * guard could be silently dropped in a future edit and nothing would notice.
 */
describe('wrong-venue guard, now enforced at generation time', () => {
  const GENERATOR = readFileSync(join(process.cwd(), 'scripts/refresh-places.mjs'), 'utf8');

  it('the generator still rejects out-of-area matches', () => {
    expect(GENERATOR).toMatch(/insideServiceArea\(lat,\s*lng\)/);
    expect(GENERATOR).toMatch(/outside-service-area/);
  });

  it("the generator's bbox copy has not drifted from SERVICE_AREA_BBOX", () => {
    // It cannot import the TypeScript constant, so it holds a copy. This is the
    // only thing standing between that copy and silent divergence.
    for (const [key, value] of Object.entries(SERVICE_AREA_BBOX)) {
      const found = new RegExp(`${key}:\\s*(-?\\d+\\.?\\d*)`).exec(GENERATOR);
      expect(found, `generator is missing ${key}`).not.toBeNull();
      expect(Number(found![1]), `generator ${key} disagrees with constants.ts`).toBe(value);
    }
  });

  it('the generator no longer writes coordinates into the sidecar', () => {
    expect(GENERATOR).not.toMatch(/patch\.lat\s*=/);
    expect(GENERATOR).not.toMatch(/patch\.lng\s*=/);
  });

  /**
   * Orphan entries are Google data for venues the app does not have.
   *
   * 29 were removed on 2026-07-29: they matched no row in the catalog files and
   * none in the bars table either, yet each shipped a place_id and 25 of them
   * shipped a photoRef and attribution — 4% of the sidecar, describing venues
   * that do not exist here. applyPlaces looks patches up BY catalog id, so they
   * were unreachable dead weight rather than a rendering bug, which is exactly
   * why nothing surfaced them.
   *
   * This guard is against re-accumulation. It can only see the catalog files, so
   * genuinely DB-only venues are allowlisted by id; keeping that list short is
   * the point.
   */
  it('the sidecar has no orphan entries', () => {
    const DB_ONLY_ALLOWLIST = new Set(['pencil-factory']);

    const sidecar = readFileSync(join(process.cwd(), 'src/lib/bars.places.ts'), 'utf8');
    const sidecarIds = [...sidecar.matchAll(/^ {2}'([^']+)':\s*\{/gm)].map((m) => m[1]);
    expect(sidecarIds.length).toBeGreaterThan(300); // the check must not pass vacuously

    const catalogIds = new Set(bars.map((b) => b.id));
    const orphans = sidecarIds.filter(
      (id) => !catalogIds.has(id) && !DB_ONLY_ALLOWLIST.has(id),
    );
    expect(orphans).toEqual([]);
  });

  it('the generated sidecar contains no coordinates', () => {
    // The compliance assertion, checked against the real artifact rather than
    // the code that produces it.
    const sidecar = readFileSync(join(process.cwd(), 'src/lib/bars.places.ts'), 'utf8');
    expect(sidecar).not.toContain('"lat":');
    expect(sidecar).not.toContain('"lng":');
    // …while place_id, the one field Google exempts from caching, is still there.
    expect(sidecar).toContain('"googlePlaceId":');
  });
});
