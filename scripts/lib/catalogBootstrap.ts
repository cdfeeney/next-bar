import { createHash } from 'node:crypto';

import type { Bar } from '../../src/types';

export const CATALOG_SCHEMA_MIGRATION = '0019_bars_catalog.sql';
export const CATALOG_DATA_MIGRATIONS = [
  '0026_clear_misresolved_place_ids.sql',
  '0027_merge_duplicate_venues.sql',
  '0028_resolve_flemings_and_slaughtered_lamb.sql',
  '0029_correct_coordinates_from_osm.sql',
  '0030_resource_coordinates_from_osm.sql',
  '0031_diamond_dogs_rocka_rolla_osm.sql',
  '0032_geocode_remaining_from_osm.sql',
] as const;

const DUPLICATE_MERGE_MIGRATION = '0027_merge_duplicate_venues.sql';

/**
 * Private marker table recording fixture ownership. Declared here rather than in
 * the runner so the refusal messages below and the DDL that creates it cannot
 * name two different tables.
 */
export const BOOTSTRAP_MARKER_TABLE = '_next_bar_bootstrap';

export type CatalogMigrationSource = {
  name: string;
  sql: string;
};

export type CatalogBootstrapRow = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  tags: string[];
  neighborhood: string;
  priceTier: number;
  blurb: string;
  address: string;
  source: 'curated';
  placeId: string | null;
  businessStatus: string | null;
  lastVerified: string;
};

export type CatalogDependencyInventory = {
  byMigration: Map<string, string[]>;
  requiredIds: string[];
  coordinateHints: Map<string, { lat: number; lng: number }>;
};

export type BootstrapResumeState = {
  appliedMigrationNames: readonly string[];
  markerPresent: boolean;
  barsCount: number;
  migrationWorkRemaining: boolean;
};

export type BootstrapTarget = {
  /**
   * The label DERIVED from the project ref by the caller's guard. The two URL fields that used to
   * sit beside it fed the deleted denylist comparison; keeping them would advertise an inspection
   * this function no longer performs.
   */
  environmentLabel: string | undefined;
};

const SHARED_DOMINIES_PLACE_ID = 'ChIJUzyXVUdfwokRYzS5v4AZpYw';

/**
 * MUST use the same comparison as the runner's file ordering, which is a plain
 * `Array.prototype.sort()` (code-unit) in scripts/apply-migrations.ts. An
 * earlier version used `localeCompare`, whose locale-aware collation disagrees:
 * `.sort()` puts `0019-bars.sql` BEFORE `0019_bars_catalog.sql` while
 * `localeCompare` reports it after, which would place the fixture install
 * before `public.bars` exists. (Codex + GLM review, 2026-07-31.)
 */
export function isAfterCatalogSchemaMigration(migrationName: string): boolean {
  return migrationName > CATALOG_SCHEMA_MIGRATION;
}

/**
 * Bootstrap is unavailable to any target whose DERIVED label is not staging or development.
 *
 * WHICH PROJECT IS PRODUCTION COMES FROM THE REPO-ROOT `.env.local` ONLY; THE LABEL IS DERIVED FROM
 * THE REF; THERE IS NO SECOND LIST.
 *
 * This function used to take `environmentLabel` from `NEXT_BAR_DATABASE_ENVIRONMENT` and carry its
 * own production denylist. Both are gone. The caller now derives the label from the project ref
 * using the operator-set lists in `.env.local` (see scripts/lib/migration-target-guard.ts), so the
 * classification file IS the denylist and a second copy could only ever disagree with it.
 *
 * THE DENYLIST COMPARISON WAS DELETED BECAUSE IT WAS UNREACHABLE, and that was proved rather than
 * assumed: a production ref always derives to the label "production", which this function refuses
 * at the check below, so the ref comparison that followed could never run for the case it was
 * written for. Mutation testing exposed it — swapping the caller's file-sourced value for
 * `process.env` changed no test outcome, because no input reached the line. Dead code that reads
 * like a safety check is worse than no code: it invites a reader to trust a guard that never fires.
 *
 * What remains is the one live rule, and it is enough: a target the operator's own file classifies
 * as production derives the label "production" and is refused here.
 */
export function assertNonProductionBootstrapTarget(target: BootstrapTarget): void {
  if (!['staging', 'development'].includes(target.environmentLabel ?? '')) {
    throw new Error(
      `bootstrap refused: this target derives to ${JSON.stringify(target.environmentLabel ?? null)}`
      + ' and only staging or development may be bootstrapped. The label comes from the project'
      + ' REF via the lists in the repo-root .env.local — setting NEXT_BAR_DATABASE_ENVIRONMENT'
      + ' will not change it, and contradicting it is itself a refusal.',
    );
  }
}


/**
 * A bootstrap may start from empty, resume after its own marker was committed,
 * or recover from a process exit immediately after 0019 and before fixture
 * installation. Any later unmarked ledger is ambiguous: catalog migrations may
 * already have silently run against an empty table, which is exactly the state
 * found in the first staging rehearsal.
 */
export function assertBootstrapResumeState(state: BootstrapResumeState): void {
  if (!Number.isInteger(state.barsCount) || state.barsCount < 0) {
    throw new Error('bootstrap preflight could not establish a valid bars row count');
  }
  if (state.markerPresent) {
    // The marker is committed in the SAME transaction as the fixture rows, so a
    // genuine marker can never coexist with an empty catalog. If it does, the
    // marker was forged or `public.bars` was truncated underneath it, and the
    // caller's pending-dependency check passes vacuously once every catalog
    // migration is already in the ledger. (DeepSeek + Claude review, 2026-07-31.)
    if (state.barsCount === 0) {
      throw new Error(
        'bootstrap refused: a bootstrap marker exists but public.bars is empty; ' +
          'the marker does not describe this database. If you truncated the catalog ' +
          `deliberately, drop the marker table (drop table public.${BOOTSTRAP_MARKER_TABLE}) ` +
          'and re-run from an empty database rather than resuming mid-build',
      );
    }
    return;
  }
  // A second invocation after a successful build is a read-only no-op. Allow
  // that ergonomic case ONLY when the catalog it claims to have built is
  // actually there. Without this the fully-ledgered-but-never-seeded database
  // — reachable via `--force-baseline` — reports "Database is up to date"
  // over an empty catalog, which is precisely the silent failure this whole
  // command exists to prevent. (Claude + DeepSeek review, 2026-07-31.)
  if (!state.migrationWorkRemaining) {
    if (state.barsCount === 0) {
      throw new Error(
        'bootstrap refused: every migration is recorded as applied but public.bars is empty; ' +
          'this database was baselined or hand-edited, not built — reset it and bootstrap from zero',
      );
    }
    return;
  }

  const beyondAnchor = state.appliedMigrationNames.filter(
    (name) => isAfterCatalogSchemaMigration(name),
  );
  if (beyondAnchor.length > 0) {
    throw new Error(
      'bootstrap refused: this database has migrations after 0019 but no bootstrap marker; ' +
        'reset the non-production database instead of pretending catalog data was present',
    );
  }
  if (state.barsCount > 0) {
    throw new Error(
      'bootstrap refused: public.bars already contains rows without a bootstrap marker',
    );
  }
}

export function assertBootstrapLedgerIsPrefix(
  migrationNames: readonly string[],
  appliedMigrationNames: readonly string[],
): void {
  const known = new Set(migrationNames);
  const unknown = appliedMigrationNames.filter((name) => !known.has(name));
  if (unknown.length > 0) {
    throw new Error(`bootstrap refused: ledger contains unknown migration(s): ${unknown.join(', ')}`);
  }

  const applied = new Set(appliedMigrationNames);
  let gapSeen = false;
  for (const name of migrationNames) {
    if (!applied.has(name)) {
      gapSeen = true;
    } else if (gapSeen) {
      throw new Error(
        `bootstrap refused: migration ledger is not a contiguous prefix (found ${name} after a gap)`,
      );
    }
  }
}

/**
 * SQL comments contain rollback examples and held-back venues. They are not
 * executable dependencies and counting them would invent fixture rows.
 */
function stripSqlComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');
}

function quotedStrings(value: string): string[] {
  return [...value.matchAll(/'((?:''|[^'])*)'/g)].map((match) =>
    (match[1] ?? '').replace(/''/g, "'"),
  );
}

/**
 * Derive every bar id used as executable input by migrations 0026-0032.
 *
 * Supported shapes are deliberately narrow and match the historical files:
 *   - first column of `insert into _temp (id, ...) values (...)`
 *   - `id = 'venue-id'`
 *   - `id in ('venue-a', 'venue-b')`
 *
 * The tests run this against the real SQL files and fail if a migration yields
 * no dependencies, if a target lacks a fixture row, or if a planted target is
 * omitted. This avoids a second hand-maintained id list drifting from the SQL.
 */
export function extractCatalogMigrationIds(sql: string): string[] {
  const executable = stripSqlComments(sql);
  const ids = new Set<string>();

  const tempValues =
    /insert\s+into\s+_[a-z0-9_]+\s*\(\s*id\b[^)]*\)\s*values\s*([\s\S]*?);/gi;
  for (const block of executable.matchAll(tempValues)) {
    const tuples = block[1] ?? '';
    for (const tuple of tuples.matchAll(/\(\s*'((?:''|[^'])+)'\s*,/g)) {
      ids.add((tuple[1] ?? '').replace(/''/g, "'"));
    }
  }

  const directId = /\b(?:[a-z_][a-z0-9_]*\.)?id\s*=\s*'((?:''|[^'])+)'/gi;
  for (const match of executable.matchAll(directId)) {
    ids.add((match[1] ?? '').replace(/''/g, "'"));
  }

  const idList = /\b(?:[a-z_][a-z0-9_]*\.)?id\s+in\s*\(([\s\S]*?)\)/gi;
  for (const match of executable.matchAll(idList)) {
    for (const value of quotedStrings(match[1] ?? '')) ids.add(value);
  }

  return [...ids].sort();
}

/**
 * 0027 records its canonical/removed pairs in a structured `kept removed`
 * table. The kept side is a real data dependency even though DELETE only names
 * the removed side: without it, a fresh fixture can successfully delete the
 * alias while leaving no representation of the venue. Parse the mapping from
 * the checksummed migration instead of maintaining a second venue list here.
 */
export function extractDuplicateSurvivorIds(sql: string): string[] {
  const table = sql.match(/--\s+kept\s+removed\s*\r?\n([\s\S]*?)(?:\r?\n--\s*\r?\n)/i)?.[1];
  if (!table) return [];

  const survivors = new Set<string>();
  for (const line of table.split(/\r?\n/)) {
    const pair = line.match(/^--\s+([a-z0-9][a-z0-9-]*)\s{2,}([a-z0-9][a-z0-9-]*)/i);
    if (pair?.[1]) survivors.add(pair[1]);
  }
  return [...survivors].sort();
}

function extractCoordinateHints(sql: string): Map<string, { lat: number; lng: number }> {
  const executable = stripSqlComments(sql);
  const hints = new Map<string, { lat: number; lng: number }>();

  // The first three columns of every correction temp table are id, lat, lng.
  const tempTuple =
    /\(\s*'((?:''|[^'])+)'\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/g;
  for (const match of executable.matchAll(tempTuple)) {
    hints.set((match[1] ?? '').replace(/''/g, "'"), {
      lat: Number(match[2]),
      lng: Number(match[3]),
    });
  }

  // 0028/0031 use direct UPDATEs rather than a temp table.
  const directUpdate =
    /update\s+public\.bars\s+set[\s\S]*?\blat\s*=\s*(-?\d+(?:\.\d+)?)[\s\S]*?\blng\s*=\s*\(?\s*(-?\d+(?:\.\d+)?)\s*\)?[\s\S]*?where\s+id\s*=\s*'((?:''|[^'])+)'/gi;
  for (const match of executable.matchAll(directUpdate)) {
    hints.set((match[3] ?? '').replace(/''/g, "'"), {
      lat: Number(match[1]),
      lng: Number(match[2]),
    });
  }

  return hints;
}

export function inventoryCatalogDependencies(
  migrations: readonly CatalogMigrationSource[],
): CatalogDependencyInventory {
  const orderedNames = migrations.map((migration) => migration.name);
  const anchorIndex = orderedNames.indexOf(CATALOG_SCHEMA_MIGRATION);
  if (anchorIndex < 0) {
    throw new Error(`bootstrap inventory: schema anchor is missing: ${CATALOG_SCHEMA_MIGRATION}`);
  }
  const files = new Map(migrations.map((migration) => [migration.name, migration.sql]));
  const byMigration = new Map<string, string[]>();
  const required = new Set<string>();
  const coordinateHints = new Map<string, { lat: number; lng: number }>();

  for (const name of CATALOG_DATA_MIGRATIONS) {
    const sql = files.get(name);
    if (sql === undefined) {
      throw new Error(`bootstrap inventory: required migration is missing: ${name}`);
    }
    if (orderedNames.indexOf(name) <= anchorIndex) {
      throw new Error(`bootstrap inventory: ${name} must appear after ${CATALOG_SCHEMA_MIGRATION}`);
    }
    const executableIds = extractCatalogMigrationIds(sql);
    const survivorIds =
      name === DUPLICATE_MERGE_MIGRATION ? extractDuplicateSurvivorIds(sql) : [];
    if (name === DUPLICATE_MERGE_MIGRATION && survivorIds.length === 0) {
      throw new Error('bootstrap inventory: 0027 yielded zero canonical duplicate survivors');
    }
    const ids = [...new Set([...executableIds, ...survivorIds])].sort();
    if (ids.length === 0) {
      throw new Error(`bootstrap inventory: ${name} yielded zero venue dependencies`);
    }
    byMigration.set(name, ids);
    for (const id of ids) required.add(id);
    for (const [id, hint] of extractCoordinateHints(sql)) coordinateHints.set(id, hint);
  }

  return {
    byMigration,
    requiredIds: [...required].sort(),
    coordinateHints,
  };
}

function titleFromId(id: string): string {
  return id
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function fixtureCoordinates(
  id: string,
  bar: Bar | undefined,
  hints: ReadonlyMap<string, { lat: number; lng: number }>,
): { lat: number; lng: number } {
  // 0028 should exercise its correction rather than taking the already-fixed
  // early return. The point is synthetic and merely needs to satisfy 0019's NYC
  // bounds before the migration moves it to the recorded OSM coordinate.
  if (id === 'the-slaughtered-lamb-pub') return { lat: 40.733, lng: -74.002 };
  if (bar) return { lat: bar.lat, lng: bar.lng };
  return hints.get(id) ?? { lat: 40.75, lng: -73.98 };
}

/**
 * Build a sanitized non-production catalog fixture. It contains no users,
 * ratings, reviews, hours, photos, or copied production records. Every static
 * catalog venue is included so duplicate-removal migrations
 * retain their canonical side and staging remains useful; the mechanically
 * derived migration targets add deterministic synthetic rows for DB-only ids.
 */
export function buildCatalogBootstrapRows(
  inventory: CatalogDependencyInventory,
  catalog: readonly Bar[],
): CatalogBootstrapRow[] {
  const catalogById = new Map(catalog.map((bar) => [bar.id, bar]));

  const fixtureIds = [...new Set([...catalog.map((bar) => bar.id), ...inventory.requiredIds])].sort();
  const rows = fixtureIds.map((id): CatalogBootstrapRow => {
    const bar = catalogById.get(id);
    const coords = fixtureCoordinates(id, bar, inventory.coordinateHints);
    let placeId: string | null = null;
    let businessStatus: string | null = null;

    // 0027 intentionally allows this one duplicate pair; 0028 resolves it and
    // recreates the full unique index. The fixture must exercise that ordering.
    if (id === 'dominies-astoria' || id === 'flemings-pub') {
      placeId = SHARED_DOMINIES_PLACE_ID;
    } else if (id === 'the-slaughtered-lamb-pub' || id === 'bar-coastal') {
      // 0026 only clears rows whose place_id is non-null.
      placeId = `bootstrap-${id}`;
    }
    if (id === 'flemings-pub') businessStatus = 'OPERATIONAL';

    return {
      id,
      name: bar?.name ?? titleFromId(id),
      lat: coords.lat,
      lng: coords.lng,
      tags: bar?.tags?.length ? [...bar.tags] : ['dive'],
      neighborhood: bar?.neighborhood ?? 'East Village',
      priceTier: bar?.priceTier ?? 1,
      blurb: bar?.blurb ?? 'Synthetic non-production migration fixture.',
      address: bar?.address ?? 'Synthetic staging fixture, New York, NY',
      source: 'curated',
      placeId,
      businessStatus,
      lastVerified: bar?.lastVerified ?? '2026-07-31',
    };
  });

  assertFixtureCovers(inventory.requiredIds, rows);
  return rows;
}

export function assertFixtureCovers(
  requiredIds: readonly string[],
  rows: readonly Pick<CatalogBootstrapRow, 'id'>[],
): void {
  const rowIds = new Set(rows.map((row) => row.id));
  const missing = requiredIds.filter((id) => !rowIds.has(id));
  if (missing.length > 0) {
    throw new Error(`bootstrap fixture is missing ${missing.length} venue(s): ${missing.join(', ')}`);
  }
  if (rowIds.size !== rows.length) {
    throw new Error('bootstrap fixture contains duplicate venue ids');
  }
}

export function pendingCatalogDependencyIds(
  inventory: CatalogDependencyInventory,
  appliedMigrationNames: readonly string[],
): string[] {
  const applied = new Set(appliedMigrationNames);
  const pending = new Set<string>();
  for (const name of CATALOG_DATA_MIGRATIONS) {
    if (applied.has(name)) continue;
    for (const id of inventory.byMigration.get(name) ?? []) pending.add(id);
  }
  return [...pending].sort();
}

export function catalogBootstrapFingerprint(rows: readonly CatalogBootstrapRow[]): string {
  const stable = [...rows]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((row) => JSON.stringify(row))
    .join('\n');
  return createHash('sha256').update(stable, 'utf8').digest('hex');
}
