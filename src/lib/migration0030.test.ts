import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

/**
 * Guards for migration 0030 (259 coordinates re-sourced from OpenStreetMap).
 *
 * Unlike 0029 this is NOT an accuracy fix — every venue here was classed AGREE,
 * meaning OSM already sat near both our position and Google's. It is a
 * provenance change: Google permits caching lat/lng for at most 30 consecutive
 * days, OSM carries no such clock. The risk to guard is therefore the opposite
 * of 0029's — not "did we correct enough" but "did we move something we
 * shouldn't have".
 */

const SQL = readFileSync(
  join(process.cwd(), 'supabase/migrations/0030_resource_coordinates_from_osm.sql'),
  'utf8',
);

const ROWS = [
  ...SQL.matchAll(/\('([a-z0-9-]+)',\s*(-?\d+\.\d+),\s*(-?\d+\.\d+),\s*'([^']+)',\s*(\d+)\)/g),
].map((m) => ({
  id: m[1],
  lat: Number(m[2]),
  lng: Number(m[3]),
  osmRef: m[4],
  moves: Number(m[5]),
}));

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

describe('migration 0030', () => {
  test('carries 259 re-sourced coordinates, all distinct', () => {
    expect(ROWS).toHaveLength(259);
    expect(new Set(ROWS.map((r) => r.id)).size).toBe(259);
  });

  test('every replacement satisfies the 0019 bbox constraint', () => {
    for (const r of ROWS) {
      expect(r.lat, `${r.id} lat`).toBeGreaterThan(40.45);
      expect(r.lat, `${r.id} lat`).toBeLessThan(41.0);
      expect(r.lng, `${r.id} lng`).toBeGreaterThan(-74.3);
      expect(r.lng, `${r.id} lng`).toBeLessThan(-73.6);
    }
  });

  test('NOTHING moves beyond the matcher radius', () => {
    // The inverse of 0029's guard. These venues were already in agreement, so a
    // large jump would mean the input was built from the wrong sweep and we are
    // relocating a correct venue to buy provenance.
    for (const r of ROWS) {
      expect(r.moves, `${r.id} moves ${r.moves}m`).toBeLessThanOrEqual(150);
    }
    // …and the SQL enforces it at apply time too, not just here.
    expect(SQL).toMatch(/exceeds the 150m matcher radius/);
  });

  test('is overwhelmingly a no-op in position terms', () => {
    // If this ever stops being true, the set was built from the wrong bucket.
    const small = ROWS.filter((r) => r.moves <= 25).length;
    expect(small / ROWS.length).toBeGreaterThan(0.75);
  });

  test('every coordinate is attributed to a specific OSM element', () => {
    for (const r of ROWS) {
      expect(r.osmRef, r.id).toMatch(/^(node|way|relation)\/\d+$/);
    }
    expect(SQL).toMatch(/ODbL/);
    expect(SQL).toMatch(/OpenStreetMap contributors/);
  });

  test('the five unarbitrated venues are held back, with reasons', () => {
    const ids = ROWS.map((r) => r.id);
    for (const held of [
      'diamond-dogs',
      'rocka-rolla',
      '230-fifth-rooftop-bar',
      'rivercrest',
      'watermark-bar',
    ]) {
      expect(ids, `${held} must not be applied`).not.toContain(held);
      expect(SQL, `${held} must be documented`).toContain(held);
    }
    expect(SQL).toMatch(/HELD BACK/);
    // diamond-dogs is the one that is not a placement quirk.
    expect(SQL).toMatch(/1,249m/);
  });

  test('the catalog source files carry the same coordinates', () => {
    // The migration fixes the table; the bar files ship in the bundle. Drift
    // between them means a fresh build silently reverts the change.
    let checked = 0;
    for (const r of ROWS) {
      const idx = CATALOG.indexOf(`id: '${r.id}'`);
      if (idx === -1) continue; // DB-only venue; the migration still covers it
      const block = CATALOG.slice(idx, idx + 400);
      expect(block, `${r.id} lat`).toContain(`lat: ${r.lat}`);
      expect(block, `${r.id} lng`).toContain(`lng: ${r.lng}`);
      checked += 1;
    }
    // Guard against the check silently covering nothing.
    expect(checked).toBeGreaterThan(200);
  });

  test('states the provenance rationale, not an accuracy claim', () => {
    // Someone reading this later must not conclude the old coordinates were
    // wrong — they were not, and 0029 is the migration that fixed wrong ones.
    expect(SQL).toMatch(/not WRONG/);
    expect(SQL).toMatch(/30 consecutive days/);
    expect(SQL).toMatch(/PROVENANCE change/i);
  });

  test('records what it does NOT end', () => {
    // The shipped sidecar is the real exposure; this migration does not touch it.
    expect(SQL).toMatch(/still SHIPS Google lat\/lng/);
    expect(SQL).toMatch(/140 venues with no OSM node/);
  });

  test('is transactional and authored-but-not-applied', () => {
    expect(SQL).toMatch(/^begin;/m);
    expect(SQL).toMatch(/^commit;/m);
    expect(SQL).toMatch(/AUTHORED, NOT APPLIED/);
  });
});
