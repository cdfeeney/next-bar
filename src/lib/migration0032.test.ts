import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

/**
 * Guards for migration 0032 (124 coordinates from OSM address geocodes).
 *
 * The weakest instrument used so far: these venues have no OSM node, so the only
 * OSM-derived option is geocoding their own address. Geocoding has been wrong
 * three times in this work, so the filter — house-level precision AND within
 * 100m of the position already held — is the thing worth pinning.
 */

const SQL = readFileSync(
  join(process.cwd(), 'supabase/migrations/0032_geocode_remaining_from_osm.sql'),
  'utf8',
);

const ROWS = [
  ...SQL.matchAll(/\('([a-z0-9-]+)',\s*(-?\d+\.\d+),\s*(-?\d+\.\d+),\s*'([^']+)',\s*(\d+)\)/g),
].map((m) => ({ id: m[1], lat: +m[2], lng: +m[3], type: m[4], moves: +m[5] }));

describe('migration 0032', () => {
  test('carries 124 geocoded coordinates, all distinct', () => {
    expect(ROWS).toHaveLength(124);
    expect(new Set(ROWS.map((r) => r.id)).size).toBe(124);
  });

  test('every replacement satisfies the 0019 bbox constraint', () => {
    for (const r of ROWS) {
      expect(r.lat, `${r.id} lat`).toBeGreaterThan(40.45);
      expect(r.lat, `${r.id} lat`).toBeLessThan(41.0);
      expect(r.lng, `${r.id} lng`).toBeGreaterThan(-74.3);
      expect(r.lng, `${r.id} lng`).toBeLessThan(-73.6);
    }
  });

  test('NOTHING relocates — the 100m filter holds', () => {
    for (const r of ROWS) {
      expect(r.moves, `${r.id} moves ${r.moves}m`).toBeLessThanOrEqual(100);
    }
    // Enforced at apply time too, not only here.
    expect(SQL).toMatch(/exceeds 100m/);
  });

  test('is overwhelmingly a no-op in position terms', () => {
    const tiny = ROWS.filter((r) => r.moves <= 25).length;
    expect(tiny / ROWS.length).toBeGreaterThan(0.9);
  });

  test('the systematic geocoder failure is documented, not just the venues', () => {
    // 10 of the 16 held back share one cause: Nominatim cannot read hyphenated
    // Queens house numbers. Someone re-running this must not rediscover it.
    expect(SQL).toMatch(/HYPHENATED QUEENS HOUSE NUMBERS/);
    expect(SQL).toMatch(/place_rank 26|type=road/);
    expect(SQL).toContain('bar-sixtyfive');
  });

  test('the two credible disagreements are held for a human, not adopted', () => {
    const ids = ROWS.map((r) => r.id);
    // House-level geocodes that put the venue 739m / 312m from where we have it.
    // Unlike the low-confidence group, the geocode here is credible — which is
    // exactly why it must not be applied silently either way.
    expect(ids).not.toContain('jacobs-pickles');
    expect(ids).not.toContain('sea-wolf');
    expect(SQL).toMatch(/WORTH A HUMAN/);
    expect(SQL).toMatch(/739m/);
  });

  test('records that the shipped sidecar is still the real exposure', () => {
    expect(SQL).toMatch(/still SHIP Google lat\/lng|continues to SHIP Google lat\/lng/);
  });

  test('is transactional and authored-but-not-applied', () => {
    expect(SQL).toMatch(/^begin;/m);
    expect(SQL).toMatch(/^commit;/m);
    expect(SQL).toMatch(/AUTHORED, NOT APPLIED/);
  });
});
