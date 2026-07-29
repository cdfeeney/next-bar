import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

/**
 * Guards for migration 0031 (diamond-dogs and rocka-rolla).
 *
 * These two were held back by 0030 because a Nominatim geocode of their address
 * landed far from their OSM node. That arbiter was wrong: for diamond-dogs it
 * could not resolve the hyphenated Queens house number and returned a street
 * centroid 1.2km away. OSM's own addr:* tags match our curated address exactly.
 */

const SQL = readFileSync(
  join(process.cwd(), 'supabase/migrations/0031_diamond_dogs_rocka_rolla_osm.sql'),
  'utf8',
);

const CATALOG = [
  'bars.core.ts',
  'bars.extra.ts',
  'bars.expansion.ts',
  'bars.expansion2.ts',
  'bars.expansion3.ts',
  'bars.expansion4.ts',
  'bars.expansion5.ts',
  'bars.expansion6.ts',
]
  .map((f) => {
    try {
      return readFileSync(join(process.cwd(), 'src/lib', f), 'utf8');
    } catch {
      return '';
    }
  })
  .join('\n');

const EXPECTED = {
  'diamond-dogs': { lat: '40.7630102', lng: '-73.9209969' },
  'rocka-rolla': { lat: '40.7139355', lng: '-73.952822' },
} as const;

describe('migration 0031', () => {
  test('sets exactly the two expected coordinates, guarded', () => {
    for (const [id, { lat, lng }] of Object.entries(EXPECTED)) {
      const stmt = SQL.split(';').find(
        (s) => /update\s+public\.bars/i.test(s) && s.includes(`id = '${id}'`),
      );
      expect(stmt, `no UPDATE for ${id}`).toBeTruthy();
      expect(stmt).toContain(`lat = ${lat}`);
      expect(stmt).toContain(`lng = ${lng}`);
      expect(stmt).toContain('abs(lat -');
    }
  });

  test('both coordinates satisfy the 0019 bbox constraint', () => {
    for (const [id, { lat, lng }] of Object.entries(EXPECTED)) {
      expect(Number(lat), `${id} lat`).toBeGreaterThan(40.45);
      expect(Number(lat), `${id} lat`).toBeLessThan(41.0);
      expect(Number(lng), `${id} lng`).toBeGreaterThan(-74.3);
      expect(Number(lng), `${id} lng`).toBeLessThan(-73.6);
    }
  });

  test('the catalog source files carry the same coordinates', () => {
    for (const [id, { lat, lng }] of Object.entries(EXPECTED)) {
      const idx = CATALOG.indexOf(`id: '${id}'`);
      expect(idx, `${id} missing from catalog`).toBeGreaterThan(-1);
      const block = CATALOG.slice(idx, idx + 400);
      expect(block, `${id} lat`).toContain(`lat: ${lat}`);
      expect(block, `${id} lng`).toContain(`lng: ${lng}`);
    }
  });

  test('records WHY the earlier arbitration was wrong', () => {
    // Without this the next person repeats the geocode and re-holds them.
    expect(SQL).toMatch(/residential/);
    expect(SQL).toMatch(/1,249m/);
    expect(SQL).toMatch(/addr:housenumber=34-04/);
  });

  test('the three genuinely unresolved venues stay held', () => {
    const stmts = SQL.split(';').filter((s) => /update\s+public\.bars/i.test(s));
    for (const held of ['230-fifth-rooftop-bar', 'rivercrest', 'watermark-bar']) {
      expect(stmts.some((s) => s.includes(held)), `${held} must not be updated`).toBe(false);
      expect(SQL, `${held} must be documented`).toContain(held);
    }
  });

  test('is transactional and authored-but-not-applied', () => {
    expect(SQL).toMatch(/^begin;/m);
    expect(SQL).toMatch(/^commit;/m);
    expect(SQL).toMatch(/AUTHORED, NOT APPLIED/);
  });
});
