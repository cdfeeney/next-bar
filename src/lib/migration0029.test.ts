import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

/**
 * Guards for migration 0029 (32 venue coordinates corrected from OpenStreetMap).
 *
 * Like 0028 this is attended, authored-but-unapplied, so nothing exercises it
 * until someone runs it against production. These assertions are static — there
 * is no test database — but the failure modes they pin are transcription errors
 * and silent scope drift, both visible in the SQL text.
 */

const SQL = readFileSync(
  join(process.cwd(), 'supabase/migrations/0029_correct_coordinates_from_osm.sql'),
  'utf8',
);

/** Every ('id', lat, lng, 'osm_ref', was_off) tuple in the VALUES block. */
const ROWS = [...SQL.matchAll(/\('([a-z0-9-]+)',\s*(-?\d+\.\d+),\s*(-?\d+\.\d+),\s*'([^']+)',\s*(\d+)\)/g)].map(
  (m) => ({
    id: m[1],
    lat: Number(m[2]),
    lng: Number(m[3]),
    osmRef: m[4],
    wasOff: Number(m[5]),
  }),
);

describe('migration 0029', () => {
  test('carries exactly 32 corrections, all distinct', () => {
    expect(ROWS).toHaveLength(32);
    expect(new Set(ROWS.map((r) => r.id)).size).toBe(32);
  });

  test('every replacement satisfies the 0019 bbox constraint', () => {
    // bars_coord_bbox_check: lat 40.45..41.0, lng -74.30..-73.60. A typo here
    // would otherwise abort mid-apply on the live catalog.
    for (const r of ROWS) {
      expect(r.lat, `${r.id} lat`).toBeGreaterThan(40.45);
      expect(r.lat, `${r.id} lat`).toBeLessThan(41.0);
      expect(r.lng, `${r.id} lng`).toBeGreaterThan(-74.3);
      expect(r.lng, `${r.id} lng`).toBeLessThan(-73.6);
    }
  });

  test('every correction is a real move, not noise', () => {
    // The smallest genuine error found was 74m. Anything near zero would mean a
    // row got in that did not need correcting.
    for (const r of ROWS) {
      expect(r.wasOff, `${r.id} was only ${r.wasOff}m off`).toBeGreaterThanOrEqual(50);
    }
  });

  test('every coordinate is attributed to a specific OSM element', () => {
    // Provenance travels with the value: an OSM-derived coordinate we cannot
    // attribute is indistinguishable from a Google one we may not store.
    for (const r of ROWS) {
      expect(r.osmRef, `${r.id}`).toMatch(/^(node|way|relation)\/\d+$/);
    }
    expect(SQL).toMatch(/ODbL/);
    expect(SQL).toMatch(/OpenStreetMap contributors/);
  });

  test('the two multi-location brands are EXCLUDED', () => {
    // A same-name OSM node near Google's coords does not prove our row is
    // misplaced when the brand has several branches — it may be a different one.
    // Applying these blind could move a correct venue.
    const ids = ROWS.map((r) => r.id);
    expect(ids).not.toContain('tir-na-nog');
    expect(ids).not.toContain('boxers-chelsea');
    // …and the reason is recorded rather than silently dropped.
    expect(SQL).toContain('tir-na-nog');
    expect(SQL).toContain('boxers-chelsea');
    expect(SQL).toMatch(/DELIBERATELY EXCLUDED/);
  });

  test('the update is guarded so a re-run is a no-op', () => {
    const updateStmt = SQL.split(';').find(
      (s) => /update\s+public\.bars/i.test(s) && s.includes('_osm_fix'),
    );
    expect(updateStmt, 'no UPDATE against _osm_fix found').toBeTruthy();
    expect(updateStmt).toMatch(/abs\(b\.lat - f\.lat\)/);
    expect(updateStmt).toMatch(/abs\(b\.lng - f\.lng\)/);
  });

  test('asserts its preconditions and verifies the outcome', () => {
    // A migration that quietly matches zero rows is worse than one that aborts.
    expect(SQL).toMatch(/not in public\.bars/);
    expect(SQL).toMatch(/did not take the correction/);
    expect(SQL).toMatch(/raise exception/);
  });

  test('is transactional and documented as authored-but-not-applied', () => {
    expect(SQL).toMatch(/^begin;/m);
    expect(SQL).toMatch(/^commit;/m);
    expect(SQL).toMatch(/AUTHORED, NOT APPLIED/);
  });

  describe('the five address corrections', () => {
    const EXPECTED: Record<string, string> = {
      'the-ditty': '35-03 Ditmars Blvd, Astoria, NY 11105',
      'the-levee': '212 Berry St, Brooklyn, NY 11211',
      'the-sampler': '234 Starr St, Brooklyn, NY 11237',
      mosaic: '25-19 24th Ave, Astoria, NY 11105',
      'pocket-bar': '455 W 48th St, New York, NY 10019',
    };

    test('each sets exactly the expected address and is guarded', () => {
      for (const [id, addr] of Object.entries(EXPECTED)) {
        const stmt = SQL.split(';').find(
          (s) => /update\s+public\.bars/i.test(s) && s.includes(`id = '${id}'`),
        );
        expect(stmt, `no address UPDATE for ${id}`).toBeTruthy();
        expect(stmt).toContain(`address = '${addr}'`);
        // `is distinct from` makes a re-run a no-op instead of churning updated_at.
        expect(stmt).toContain('is distinct from');
      }
    });

    test('the catalog source files carry the same addresses', () => {
      // The migration corrects the table; the bar files ship in the bundle. If
      // these drift, a fresh build silently reverts the fix.
      const files = [
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

      for (const [id, addr] of Object.entries(EXPECTED)) {
        const idx = files.indexOf(`id: '${id}'`);
        expect(idx, `${id} not found in catalog files`).toBeGreaterThan(-1);
        expect(files.slice(idx, idx + 400), `${id} address`).toContain(addr);
      }
    });

    test("the-ditty's postcode is the corroborated one, not Nominatim's", () => {
      // Nominatim reverse-geocoded its node to 11370 (East Elmhurst), which is
      // wrong — three catalog neighbours on Ditmars Blvd bracket it at 11105.
      // Pinned because 11370 is exactly the value a future re-derivation would
      // reintroduce.
      // Strip `--` comments first: splitting on ';' leaves the preceding comment
      // block attached to the statement, and that block legitimately mentions
      // 11370 while explaining why it was rejected.
      const code = SQL.split('\n')
        .filter((l) => !l.trimStart().startsWith('--'))
        .join('\n');
      const stmt = code
        .split(';')
        .find((s) => /update\s+public\.bars/i.test(s) && s.includes("id = 'the-ditty'"));

      expect(stmt, 'no address UPDATE for the-ditty').toBeTruthy();
      expect(stmt).toContain('35-03 Ditmars Blvd, Astoria, NY 11105');
      expect(stmt).not.toContain('11370');
      // …and the rejected value stays documented in the comments.
      expect(SQL).toMatch(/11370/);
    });
  });

  test('records what it does NOT fix', () => {
    // The catalog source files and the wrong addresses are still outstanding;
    // an apply log that implies otherwise would be misleading.
    expect(SQL).toMatch(/bars\.\*\.ts are still wrong/);
    expect(SQL).toMatch(/wrong ADDRESS/);
  });
});
