import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

/**
 * Guards for migration 0028 (Fleming's / Dominie's place_id, Slaughtered Lamb
 * coordinates).
 *
 * 0028 is ATTENDED work — it performs live-catalog writes and is committed
 * unapplied. That is exactly why it needs a test: nothing else will exercise it
 * until someone runs it against production, and by then a mistake has already
 * landed. These assertions are static (they read the SQL text), because there is
 * no test database — but the failure modes they pin are ordering and omission,
 * both of which are visible in the text.
 */

const SQL = readFileSync(
  join(process.cwd(), 'supabase/migrations/0028_resolve_flemings_and_slaughtered_lamb.sql'),
  'utf8',
);

describe('migration 0028', () => {
  test("clears Fleming's place_id BEFORE recreating the unique index", () => {
    // Order is load-bearing. bars_place_id_unique without the carve-out cannot
    // be created while two rows still share ChIJUzyXVUdfwokRYzS5v4AZpYw, so a
    // reordering makes the migration abort halfway on the live catalog.
    const clearsPlaceId = SQL.indexOf("where id = 'flemings-pub'");
    const createsIndex = SQL.indexOf('create unique index bars_place_id_unique');

    expect(clearsPlaceId).toBeGreaterThan(-1);
    expect(createsIndex).toBeGreaterThan(-1);
    expect(clearsPlaceId).toBeLessThan(createsIndex);
  });

  test('recreates the unique index WITHOUT the 0027 carve-out', () => {
    // The entire point of settling D5 is that all 1,256 rows get the guard, not
    // 1,254. If the exclusion survives, the migration silently achieves nothing.
    const indexBlock = SQL.slice(SQL.indexOf('create unique index bars_place_id_unique'));
    const statement = indexBlock.slice(0, indexBlock.indexOf(';'));

    expect(statement).toContain('where place_id is not null');
    expect(statement).not.toContain('not in');
    expect(statement).not.toContain('dominies-astoria');
  });

  test("marks Fleming's closed using the vocabulary the app actually filters on", () => {
    // matching.ts:165 and discover/page.tsx:220 both filter on this exact
    // string. A typo here is invisible: the venue simply keeps being suggested.
    expect(SQL).toContain("business_status = 'CLOSED_PERMANENTLY'");
  });

  test('Slaughtered Lamb coordinates match the recorded Nominatim result', () => {
    expect(SQL).toContain('40.7323542');
    expect(SQL).toContain('-74.0018245');
    // Provenance must travel with the value — an OSM-derived coordinate we
    // cannot attribute is indistinguishable from a Google one we may not store.
    expect(SQL).toMatch(/nominatim/i);
    expect(SQL).toMatch(/ODbL/);
    expect(SQL).toMatch(/osm_id=2562458252/);
  });

  test('Slaughtered Lamb coordinates satisfy the 0019 bbox constraint', () => {
    // bars_coord_bbox_check: lat 40.45..41.0, lng -74.30..-73.60. Asserting it
    // here means a bad edit fails in CI rather than aborting mid-migration.
    const lat = 40.7323542;
    const lng = -74.0018245;
    expect(lat).toBeGreaterThan(40.45);
    expect(lat).toBeLessThan(41.0);
    expect(lng).toBeGreaterThan(-74.3);
    expect(lng).toBeLessThan(-73.6);
  });

  test('does NOT touch bar-coastal, whose closure is unconfirmed', () => {
    // Connor said "seems closed". Marking a live venue closed on a guess is the
    // one error a user never reports — the bar just stops being recommended.
    // This pins the decision so a later edit cannot quietly fold it in.
    const statements = SQL.split(';');
    const touchesCoastal = statements.some(
      (s) => /^\s*update/im.test(s) && s.includes('bar-coastal'),
    );
    expect(touchesCoastal).toBe(false);
  });

  test('asserts its preconditions instead of silently no-opping', () => {
    // A migration that quietly matches zero rows because an id moved is worse
    // than one that aborts: the operator believes the correction landed.
    expect(SQL).toContain('raise exception');
    expect(SQL).toContain('ChIJUzyXVUdfwokRYzS5v4AZpYw');
  });

  test('is documented as authored-but-not-applied', () => {
    expect(SQL).toMatch(/AUTHORED, NOT APPLIED/);
  });
});
