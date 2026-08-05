import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';
import { bars } from '../../src/lib/bars';
import {
  CATALOG_DATA_MIGRATIONS,
  CATALOG_SCHEMA_MIGRATION,
  assertBootstrapLedgerIsPrefix,
  assertBootstrapResumeState,
  assertFixtureCovers,
  assertNonProductionBootstrapTarget,
  buildCatalogBootstrapRows,
  catalogBootstrapFingerprint,
  extractCatalogMigrationIds,
  extractDuplicateSurvivorIds,
  inventoryCatalogDependencies,
  isAfterCatalogSchemaMigration,
  pendingCatalogDependencyIds,
} from './catalogBootstrap';

const migrations = [CATALOG_SCHEMA_MIGRATION, ...CATALOG_DATA_MIGRATIONS].map((name) => ({
  name,
  sql: readFileSync(join(process.cwd(), 'supabase', 'migrations', name), 'utf8'),
}));

describe('catalog migration bootstrap inventory', () => {
  test('places the fixture boundary after 0019 and before every catalog data migration', () => {
    expect(isAfterCatalogSchemaMigration('0019_bars_catalog.sql')).toBe(false);
    expect(isAfterCatalogSchemaMigration('0020_bar_change_queue.sql')).toBe(true);
    for (const name of CATALOG_DATA_MIGRATIONS) {
      expect(isAfterCatalogSchemaMigration(name), name).toBe(true);
    }
  });

  test('mechanically derives dependencies from every historical data migration', () => {
    const inventory = inventoryCatalogDependencies(migrations);

    expect([...inventory.byMigration.keys()]).toEqual(CATALOG_DATA_MIGRATIONS);
    for (const name of CATALOG_DATA_MIGRATIONS) {
      expect(inventory.byMigration.get(name)?.length, `${name} should have targets`).toBeGreaterThan(0);
    }
    expect(
      Object.fromEntries([...inventory.byMigration].map(([name, ids]) => [name, ids.length])),
    ).toEqual({
      '0026_clear_misresolved_place_ids.sql': 2,
      '0027_merge_duplicate_venues.sql': 18,
      '0028_resolve_flemings_and_slaughtered_lamb.sql': 3,
      '0029_correct_coordinates_from_osm.sql': 34,
      '0030_resource_coordinates_from_osm.sql': 258,
      '0031_diamond_dogs_rocka_rolla_osm.sql': 2,
      '0032_geocode_remaining_from_osm.sql': 124,
    });
    expect(inventory.requiredIds).toHaveLength(402);

    expect(inventory.requiredIds).toEqual(
      expect.arrayContaining([
        'dominies-astoria',
        'flemings-pub',
        'the-slaughtered-lamb-pub',
        'diamond-dogs',
        'rocka-rolla',
      ]),
    );
  });

  test('extracts a newly planted target instead of relying on a hand list', () => {
    const planted = "update public.bars set name = name where id = 'adversarial-new-target';";
    expect(extractCatalogMigrationIds(planted)).toEqual(['adversarial-new-target']);
  });

  test('ignores rollback comments and held-back prose', () => {
    const sql = [
      "update public.bars set name = name where id = 'real-target';",
      "-- update public.bars set name = name where id = 'comment-only';",
      "/* delete from public.bars where id in ('block-comment-only') */",
    ].join('\n');
    expect(extractCatalogMigrationIds(sql)).toEqual(['real-target']);
  });

  test('mechanically includes 0027 canonical survivors from its checked-in mapping', () => {
    const migration = migrations.find((item) => item.name === '0027_merge_duplicate_venues.sql');
    expect(extractDuplicateSurvivorIds(migration!.sql)).toEqual(
      expect.arrayContaining(['death-and-co', 'kcbc-taproom', '7b-horseshoe-bar', 'slate']),
    );
    expect(extractDuplicateSurvivorIds(migration!.sql)).toHaveLength(9);
  });
});

describe('bootstrap resume preflight', () => {
  test('requires the ledger to be a contiguous prefix of checked-in migrations', () => {
    const names = ['0000_init.sql', '0001_auth.sql', '0002_catalog.sql'];
    expect(() => assertBootstrapLedgerIsPrefix(names, [])).not.toThrow();
    expect(() => assertBootstrapLedgerIsPrefix(names, names.slice(0, 2))).not.toThrow();
    expect(() => assertBootstrapLedgerIsPrefix(names, [names[0]!, names[2]!])).toThrow(
      /contiguous prefix/i,
    );
    expect(() => assertBootstrapLedgerIsPrefix(names, ['9999_unknown.sql'])).toThrow(/unknown/i);
  });

  test('allows a genuinely empty database', () => {
    expect(() =>
      assertBootstrapResumeState({
        appliedMigrationNames: [],
        markerPresent: false,
        barsCount: 0,
        migrationWorkRemaining: true,
      }),
    ).not.toThrow();
  });

  test('allows recovery immediately after 0019 but before fixture installation', () => {
    expect(() =>
      assertBootstrapResumeState({
        appliedMigrationNames: ['0000_init.sql', '0019_bars_catalog.sql'],
        markerPresent: false,
        barsCount: 0,
        migrationWorkRemaining: true,
      }),
    ).not.toThrow();
  });

  test('refuses the exact ambiguous state found by the first staging rehearsal', () => {
    expect(() =>
      assertBootstrapResumeState({
        appliedMigrationNames: ['0019_bars_catalog.sql', '0027_merge_duplicate_venues.sql'],
        markerPresent: false,
        barsCount: 0,
        migrationWorkRemaining: true,
      }),
    ).toThrow(/after 0019.*no bootstrap marker/i);
  });

  test('refuses pre-existing catalog rows without ownership evidence', () => {
    expect(() =>
      assertBootstrapResumeState({
        appliedMigrationNames: ['0019_bars_catalog.sql'],
        markerPresent: false,
        barsCount: 1,
        migrationWorkRemaining: true,
      }),
    ).toThrow(/already contains rows/i);
  });

  test('allows a marked interrupted bootstrap to resume', () => {
    expect(() =>
      assertBootstrapResumeState({
        appliedMigrationNames: ['0029_correct_coordinates_from_osm.sql'],
        markerPresent: true,
        barsCount: 397,
        migrationWorkRemaining: true,
      }),
    ).not.toThrow();
  });

  test('allows a completed bootstrap command to be rerun as a no-op', () => {
    expect(() =>
      assertBootstrapResumeState({
        appliedMigrationNames: ['0019_bars_catalog.sql', '0035_share_night_bound.sql'],
        markerPresent: false,
        barsCount: 410,
        migrationWorkRemaining: false,
      }),
    ).not.toThrow();
  });

  /**
   * Reachable via `--force-baseline`, which records every file as applied
   * without executing any of it. The ledger then looks complete while the
   * catalog is empty — the silent no-op this whole command exists to prevent.
   */
  test('refuses a fully-ledgered database whose catalog was never actually seeded', () => {
    expect(() =>
      assertBootstrapResumeState({
        appliedMigrationNames: ['0019_bars_catalog.sql', '0035_share_night_bound.sql'],
        markerPresent: false,
        barsCount: 0,
        migrationWorkRemaining: false,
      }),
    ).toThrow(/recorded as applied but public\.bars is empty/i);
  });

  test('refuses a marker that cannot describe this database because the catalog is empty', () => {
    expect(() =>
      assertBootstrapResumeState({
        appliedMigrationNames: ['0029_correct_coordinates_from_osm.sql'],
        markerPresent: true,
        barsCount: 0,
        migrationWorkRemaining: true,
      }),
    ).toThrow(/marker exists but public\.bars is empty/i);
    // Same hole with NO pending catalog migrations, where the caller's
    // pending-dependency check would otherwise pass vacuously.
    expect(() =>
      assertBootstrapResumeState({
        appliedMigrationNames: ['0035_share_night_bound.sql'],
        markerPresent: true,
        barsCount: 0,
        migrationWorkRemaining: false,
      }),
    ).toThrow(/marker exists but public\.bars is empty/i);
  });
});

describe('bootstrap fixture boundary ordering', () => {
  /**
   * The boundary MUST agree with the runner's own file ordering, which is a
   * plain code-unit `.sort()`. `localeCompare` disagrees on punctuation and
   * would place the fixture install before public.bars exists.
   */
  test('agrees with code-unit sort on adversarial filenames', () => {
    const adversarial = [
      '0019-bars.sql',
      '0019_bars_catalog.sql',
      '0019a_extra.sql',
      '0020_provenance_and_media.sql',
      '0002_v0.5.1_pairwise.sql',
    ];
    const sorted = [...adversarial].sort();
    const anchorIndex = sorted.indexOf(CATALOG_SCHEMA_MIGRATION);
    sorted.forEach((name, index) => {
      expect(isAfterCatalogSchemaMigration(name), `${name} @ ${index}`).toBe(index > anchorIndex);
    });
    // The specific divergence Codex identified.
    expect(isAfterCatalogSchemaMigration('0019-bars.sql')).toBe(false);
    expect('0019-bars.sql'.localeCompare(CATALOG_SCHEMA_MIGRATION) > 0).toBe(true);
  });
});

describe('catalog data migration list coverage', () => {
  /**
   * `CATALOG_DATA_MIGRATIONS` is the one hand-maintained list left in this
   * module. If a future migration mutates catalog rows and nobody classifies it,
   * the fixture can silently omit its dependency and — for a migration written in
   * 0026's assertion-free style — the migration silently no-ops. That is the
   * original incident.
   *
   * The detector is deliberately a DML-TARGET scan, not an id scan. An earlier
   * version asked "does this migration name venue ids?", which is a proxy for the
   * wrong invariant: `update public.bars set ...` with a predicate WHERE, a
   * `delete ... where region = ...`, or a `truncate` all mutate the catalog while
   * naming no ids at all, and sailed straight through. (GLM review, 2026-07-31.)
   *
   * Every post-0019 migration that writes to public.bars must therefore be
   * EITHER in `CATALOG_DATA_MIGRATIONS` (it depends on specific rows, so the
   * fixture must contain them) OR explicitly allowlisted below with a reason.
   * A new migration is in neither, so it fails until someone chooses.
   */
  const ROW_AGNOSTIC_CATALOG_WRITERS: Record<string, string> = {
    '0020_provenance_and_media.sql':
      'bulk backfill: sets hours_source/hours_confidence where hours is not null — ' +
      'predicate-driven, depends on no particular venue.',
    '0023_purge_google_reviews.sql':
      'compliance purge: nulls reviews where reviews is not null — ' +
      'predicate-driven, depends on no particular venue.',
  };

  test('every post-0019 migration that writes to public.bars is classified', () => {
    const dir = join(process.cwd(), 'supabase', 'migrations');
    // Quoted identifiers are legal and were a real blind spot: `update
    // "public"."bars"` names the same table and the unquoted-only pattern could
    // not see it. The trailing `(?![\w"])` keeps `bars_archive`, `barsx` and
    // `bar_rsvps` out. (Kimi + GLM round 3, 2026-07-31.)
    const catalogWrite =
      /\b(?:insert\s+into|update|delete\s+from|truncate(?:\s+table)?|merge\s+into)\s+(?:only\s+)?(?:"?public"?\s*\.\s*)?"?bars"?(?![\w"])/i;
    const unclassified: string[] = [];

    for (const name of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
      if (!isAfterCatalogSchemaMigration(name)) continue;
      if ((CATALOG_DATA_MIGRATIONS as readonly string[]).includes(name)) continue;
      if (name in ROW_AGNOSTIC_CATALOG_WRITERS) continue;
      // Comments hold rollback examples and held-back venues; only executable
      // SQL counts, exactly as the inventory itself does.
      const executable = readFileSync(join(dir, name), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/--[^\n]*/g, ' ');
      if (catalogWrite.test(executable) || extractCatalogMigrationIds(executable).length > 0) {
        unclassified.push(name);
      }
    }

    expect(unclassified).toEqual([]);
  });

  test('the detector actually fires on catalog writes that name no venue ids', () => {
    // Quoted identifiers are legal and were a real blind spot: `update
    // "public"."bars"` names the same table and the unquoted-only pattern could
    // not see it. The trailing `(?![\w"])` keeps `bars_archive`, `barsx` and
    // `bar_rsvps` out. (Kimi + GLM round 3, 2026-07-31.)
    const catalogWrite =
      /\b(?:insert\s+into|update|delete\s+from|truncate(?:\s+table)?|merge\s+into)\s+(?:only\s+)?(?:"?public"?\s*\.\s*)?"?bars"?(?![\w"])/i;
    for (const sql of [
      'update public.bars set last_verified = now();',
      "delete from public.bars where neighborhood = 'ghost';",
      'truncate table public.bars;',
      'insert into bars (id) select id from staging_bars;',
      'update only public.bars set blurb = \'\';',
      'with c as (select 1) update public.bars set blurb = \'\';',
      'update "public"."bars" set blurb = \'\';',
      'update public . bars set blurb = \'\';',
      "merge into public.bars b using staging s on b.id = s.id when matched then update set blurb = '';",
    ]) {
      expect(extractCatalogMigrationIds(sql), sql).toEqual([]);
      expect(catalogWrite.test(sql), sql).toBe(true);
    }
    // Sibling tables that merely start with the same letters must NOT trip it.
    for (const sql of [
      'insert into public.bars_archive values (1);',
      'update public.bar_rsvps set x = 1;',
      'select * from public.bars;',
    ]) {
      expect(catalogWrite.test(sql), sql).toBe(false);
    }
  });

  test('the allowlist names only migrations that really are row-agnostic writers', () => {
    const dir = join(process.cwd(), 'supabase', 'migrations');
    for (const name of Object.keys(ROW_AGNOSTIC_CATALOG_WRITERS)) {
      const sql = readFileSync(join(dir, name), 'utf8').replace(/--[^\n]*/g, ' ');
      expect(sql, `${name} should still write to bars`).toMatch(/\bupdate\s+public\.bars\b/i);
      expect(extractCatalogMigrationIds(sql), `${name} must name no venue ids`).toEqual([]);
    }
  });
});

describe('bootstrap target preflight', () => {
  const publicUrl = 'https://stagingref.supabase.co';
  const poolerUrl =
    'postgresql://postgres.stagingref:placeholder@aws-1-us-west-2.pooler.supabase.com:6543/postgres';
  const productionProjectRef = 'prodref';

  test('accepts an explicitly labelled staging project whose references match', () => {
    expect(() =>
      assertNonProductionBootstrapTarget({
        environmentLabel: 'staging',
        publicSupabaseUrl: publicUrl,
        databaseUrl: poolerUrl,
        productionProjectRef,
      }),
    ).not.toThrow();
  });

  test('accepts a matching direct Supabase connection', () => {
    expect(() =>
      assertNonProductionBootstrapTarget({
        environmentLabel: 'development',
        publicSupabaseUrl: publicUrl,
        databaseUrl: 'postgresql://postgres:placeholder@db.stagingref.supabase.co:5432/postgres',
        productionProjectRef,
      }),
    ).not.toThrow();
  });

  test('refuses production, missing classification, mismatched refs, and opaque targets', () => {
    expect(() =>
      assertNonProductionBootstrapTarget({
        environmentLabel: 'production',
        publicSupabaseUrl: publicUrl,
        databaseUrl: poolerUrl,
        productionProjectRef,
      }),
    ).toThrow(/staging or development/i);
    expect(() =>
      assertNonProductionBootstrapTarget({
        environmentLabel: undefined,
        publicSupabaseUrl: publicUrl,
        databaseUrl: poolerUrl,
        productionProjectRef,
      }),
    ).toThrow(/staging or development/i);
    expect(() =>
      assertNonProductionBootstrapTarget({
        environmentLabel: 'staging',
        publicSupabaseUrl: publicUrl,
        databaseUrl:
          'postgresql://postgres.productionref:placeholder@aws-1-us-west-2.pooler.supabase.com:6543/postgres',
        productionProjectRef,
      }),
    ).toThrow(/different projects/i);
    expect(() =>
      assertNonProductionBootstrapTarget({
        environmentLabel: 'staging',
        publicSupabaseUrl: publicUrl,
        databaseUrl: 'postgresql://postgres:placeholder@example.com:5432/postgres',
        productionProjectRef,
      }),
    ).toThrow(/derive both/i);
  });

  /**
   * The label is operator-supplied. A stale `staging` label in a shell whose
   * .env.local still points at Production satisfies every OTHER check, because
   * the two URLs agree with each other — they just agree on the wrong project.
   */
  test('refuses a staging-labelled shell whose matching URLs are both Production', () => {
    expect(() =>
      assertNonProductionBootstrapTarget({
        environmentLabel: 'staging',
        publicSupabaseUrl: 'https://prodref.supabase.co',
        databaseUrl:
          'postgresql://postgres.prodref:placeholder@aws-1-us-west-2.pooler.supabase.com:6543/postgres',
        productionProjectRef,
      }),
    ).toThrow(/IS the declared Production project/i);
  });

  /**
   * Supabase issues lowercase refs and URL parsing lowercases hostnames, but the
   * pooled-username branch and this operator-typed env value are neither parsed
   * nor lowercased — so a mixed-case value silently disabled the guard against
   * the exact project it names. (Codex round 2, 2026-07-31.)
   */
  test('matches the declared Production ref case-insensitively', () => {
    for (const declared of ['PRODREF', '  ProdRef  ']) {
      expect(() =>
        assertNonProductionBootstrapTarget({
          environmentLabel: 'staging',
          publicSupabaseUrl: 'https://prodref.supabase.co',
          databaseUrl:
            'postgresql://postgres.PRODREF:placeholder@aws-1-us-west-2.pooler.supabase.com:6543/postgres',
          productionProjectRef: declared,
        }),
      ).toThrow(/IS the declared Production project/i);
    }
  });

  test('refuses to run at all when the Production project is not declared', () => {
    for (const undeclared of [undefined, '', '   ']) {
      expect(() =>
        assertNonProductionBootstrapTarget({
          environmentLabel: 'staging',
          publicSupabaseUrl: publicUrl,
          databaseUrl: poolerUrl,
          productionProjectRef: undeclared,
        }),
      ).toThrow(/NEXT_BAR_PRODUCTION_PROJECT_REF/);
    }
  });
});

describe('catalog bootstrap fixture', () => {
  const inventory = inventoryCatalogDependencies(migrations);
  const rows = buildCatalogBootstrapRows(inventory, bars);

  test('includes the public static catalog and every mechanically derived target exactly once', () => {
    const expectedIds = new Set([...bars.map((bar) => bar.id), ...inventory.requiredIds]);
    expect(rows).toHaveLength(expectedIds.size);
    expect(new Set(rows.map((row) => row.id)).size).toBe(rows.length);
    expect(() => assertFixtureCovers(inventory.requiredIds, rows)).not.toThrow();
  });

  test('keeps the canonical venue for every duplicate removed by 0027', () => {
    const ids = new Set(rows.map((row) => row.id));
    for (const keeper of [
      'death-and-co',
      'sunshine-laundromat',
      'boxers-chelsea',
      'blind-tiger',
      'kcbc-taproom',
      'empire-hotel-rooftop',
      'pieces-bar',
      '7b-horseshoe-bar',
      'slate',
    ]) {
      expect(ids.has(keeper), `${keeper} should survive 0027`).toBe(true);
    }
  });

  test('fails closed when an arbitrary required target is absent', () => {
    const removed = inventory.requiredIds[Math.floor(inventory.requiredIds.length / 2)]!;
    expect(() =>
      assertFixtureCovers(
        inventory.requiredIds,
        rows.filter((row) => row.id !== removed),
      ),
    ).toThrow(removed);
  });

  test('recomputes required rows from only the catalog migrations still pending', () => {
    const allPending = pendingCatalogDependencyIds(inventory, []);
    const afterMerge = pendingCatalogDependencyIds(inventory, [
      '0026_clear_misresolved_place_ids.sql',
      '0027_merge_duplicate_venues.sql',
    ]);
    expect(allPending).toEqual(inventory.requiredIds);
    expect(afterMerge).not.toContain('death-and-company');
    expect(afterMerge).toEqual(expect.arrayContaining(['dominies-astoria', 'diamond-dogs']));
    expect(pendingCatalogDependencyIds(inventory, CATALOG_DATA_MIGRATIONS)).toEqual([]);
  });

  test('contains no user, review, hours, or photo fields', () => {
    for (const row of rows) {
      expect(row).not.toHaveProperty('userId');
      expect(row).not.toHaveProperty('reviews');
      expect(row).not.toHaveProperty('hours');
      expect(row).not.toHaveProperty('photoAttributions');
    }
  });

  test('satisfies the 0019 catalog constraints before insertion', () => {
    for (const row of rows) {
      expect(row.priceTier).toBeGreaterThanOrEqual(1);
      expect(row.priceTier).toBeLessThanOrEqual(4);
      expect(row.lat).toBeGreaterThanOrEqual(40.45);
      expect(row.lat).toBeLessThanOrEqual(41.0);
      expect(row.lng).toBeGreaterThanOrEqual(-74.3);
      expect(row.lng).toBeLessThanOrEqual(-73.6);
      expect(row.name).not.toBe('');
      expect(row.lastVerified).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  test('exercises the 0027 carve-out and 0028 resolution ordering', () => {
    const dominies = rows.find((row) => row.id === 'dominies-astoria');
    const flemings = rows.find((row) => row.id === 'flemings-pub');
    expect(dominies?.placeId).toBeTruthy();
    expect(flemings?.placeId).toBe(dominies?.placeId);
    expect(flemings?.businessStatus).toBe('OPERATIONAL');
  });

  test('makes both 0026 cleanup targets non-null so the migration is exercised', () => {
    for (const id of ['the-slaughtered-lamb-pub', 'bar-coastal']) {
      expect(rows.find((row) => row.id === id)?.placeId, id).toBeTruthy();
    }
  });

  test('is deterministic', () => {
    expect(catalogBootstrapFingerprint(rows)).toBe(
      'e87d3c85de9b7487775686102216d21620b17d0144b32983b46459ef181422e2',
    );
    expect(catalogBootstrapFingerprint(buildCatalogBootstrapRows(inventory, bars))).toBe(
      catalogBootstrapFingerprint(rows),
    );
  });
});
