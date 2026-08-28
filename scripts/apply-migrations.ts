/**
 * apply-migrations.ts
 *
 * Applies every *.sql file in supabase/migrations/ in lexical order against the
 * Postgres database pointed to by DATABASE_URL.
 *
 * LEDGERED (2026-07-28). Migrations used to re-run on EVERY invocation, relying
 * purely on each file being idempotent. Two problems with that:
 *
 *   1. Re-running 0020 re-creates and re-GRANTs the over-permissive
 *      `pending_change_count(uuid)` definer function that 0021 exists to remove.
 *   2. Nothing detected an already-applied migration being EDITED afterwards,
 *      so the file and the database could disagree silently and forever.
 *
 * Now: each file is hashed, recorded in public.schema_migrations on success, and
 * skipped thereafter. If a recorded file's contents change, the run ABORTS and
 * applies nothing — see src/lib/migrationPlan.ts (unit-tested) for that logic.
 *
 * Each migration runs inside an explicit transaction together with its ledger
 * write, so a failure leaves neither the schema change nor the ledger row.
 *
 * Usage:
 *   1. Set DATABASE_URL in .env.local (Supabase -> Project Settings ->
 *      Database -> Connection string -> URI, Transaction pooler, port 6543).
 *   2. `npm run db:migrate`
 *
 *   A brand-new non-production database must use `npm run db:bootstrap`.
 *   Historical catalog migrations 0026-0032 depend on operational venue rows
 *   that schema migration 0019 does not create. Bootstrap derives those target
 *   ids from the SQL, installs a sanitized fixture after 0019, then runs the
 *   ordinary checksum-ledgered migration path. It refuses ambiguous partial
 *   databases and never baselines.
 *
 *   `npm run db:migrate -- --baseline` records every current file as applied
 *   WITHOUT executing it. Use it when adopting the ledger on a database that
 *   already matches the files on disk — it avoids re-running historical
 *   migrations against production.
 *
 *   Baseline is a CLAIM ABOUT REALITY, so it verifies the claim instead of
 *   trusting it: the tables the migration files create are extracted from the
 *   SQL and checked for existence, and baseline REFUSES if any are missing.
 *   That is what stops it being pointed at a fresh database, recording a schema
 *   that does not exist, and reporting "up to date" forever after. The whole
 *   pass is one transaction, so an interruption leaves no partial ledger.
 *
 *   `--force-baseline` overrides a failed premise check. Separate flag on
 *   purpose: routine adoption and overriding a safety check must not share a
 *   keystroke.
 *
 * Safety: aborts on the first error and names the file that failed.
 */

import { config as loadEnv } from 'dotenv';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import {
  checkBaselinePremise,
  checksum,
  planMigrations,
  unwrapMigrationTransaction,
  type AppliedMigration,
  type MigrationFile,
} from '../src/lib/migrationPlan';
import {
  BOOTSTRAP_MARKER_TABLE,
  CATALOG_SCHEMA_MIGRATION,
  assertBootstrapLedgerIsPrefix,
  assertBootstrapResumeState,
  assertNonProductionBootstrapTarget,
  buildCatalogBootstrapRows,
  catalogBootstrapFingerprint,
  inventoryCatalogDependencies,
  isAfterCatalogSchemaMigration,
  pendingCatalogDependencyIds,
  type CatalogDependencyInventory,
  type CatalogBootstrapRow,
} from './lib/catalogBootstrap';
import { MIGRATION_LEDGER_DDL } from './lib/migrationLedger';

// Hard gate: never write the live DB with the service-role/pooler creds
// during the unattended overnight loop (DeepSeek security review). This
// runs BEFORE any env load so nothing DB-touching happens first.
if (process.env.LOOP_UNATTENDED === '1') {
  console.error(
    '[loop-guard] applying migrations is forbidden during the unattended ' +
      'loop (LOOP_UNATTENDED=1). Migrations are an attended step. Aborting.',
  );
  process.exit(1);
}

loadEnv({ path: '.env.local' });
loadEnv({ path: '.env' });

const BASELINE = process.argv.includes('--baseline');
const BOOTSTRAP = process.argv.includes('--bootstrap');
// Escape hatch for the baseline premise check. Separate flag on purpose: --baseline
// is a routine adoption step, overriding a failed premise check is not, and the two
// must not share a keystroke.
const FORCE_BASELINE = process.argv.includes('--force-baseline');

if (BOOTSTRAP && (BASELINE || FORCE_BASELINE)) {
  console.error('Refusing: --bootstrap and --baseline/--force-baseline are mutually exclusive.');
  process.exit(1);
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error(
    'DATABASE_URL is not set. Add it to .env.local (Supabase → Project Settings → Database → Connection string → URI).',
  );
  process.exit(1);
}

if (BOOTSTRAP) {
  try {
    assertNonProductionBootstrapTarget({
      environmentLabel: process.env.NEXT_BAR_DATABASE_ENVIRONMENT,
      publicSupabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
      databaseUrl,
      productionProjectRef: process.env.NEXT_BAR_PRODUCTION_PROJECT_REF,
    });
  } catch (error) {
    console.error(`[bootstrap-guard] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

const migrationsDir = join(process.cwd(), 'supabase', 'migrations');

let files: MigrationFile[];
try {
  files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((name) => ({
      name,
      sql: readFileSync(join(migrationsDir, name), 'utf-8'),
    }));
} catch (err) {
  console.error(`Could not read ${migrationsDir}:`, err);
  process.exit(1);
}

if (files.length === 0) {
  console.log('No migration files found. Nothing to do.');
  process.exit(0);
}

const BOOTSTRAP_MARKER = BOOTSTRAP_MARKER_TABLE;
const BOOTSTRAP_MARKER_REGCLASS = `public.${BOOTSTRAP_MARKER}`;

async function tableExists(client: Client, regclass: string): Promise<boolean> {
  const { rows } = await client.query<{ name: string | null }>(
    'select to_regclass($1) as name',
    [regclass],
  );
  return rows[0]?.name !== null && rows[0]?.name !== undefined;
}

async function barsCount(client: Client): Promise<number> {
  if (!(await tableExists(client, 'public.bars'))) return 0;
  const { rows } = await client.query<{ count: number }>(
    'select count(*)::integer as count from public.bars',
  );
  return rows[0]?.count ?? 0;
}

function bootstrapInsert(
  rows: readonly CatalogBootstrapRow[],
): { sql: string; values: unknown[] } {
  const values: unknown[] = [];
  const tuples = rows.map((row) => {
    const fields: unknown[] = [
      row.id,
      row.name,
      row.lat,
      row.lng,
      row.tags,
      row.neighborhood,
      row.priceTier,
      null,
      row.blurb,
      row.address,
      row.source,
      row.placeId,
      row.businessStatus,
      0,
      null,
      null,
      row.lastVerified,
    ];
    const placeholders = fields.map((value) => {
      values.push(value);
      return `$${values.length}`;
    });
    return `(${placeholders.join(', ')})`;
  });

  return {
    sql: `insert into public.bars (
      id, name, lat, lng, tags, neighborhood, price_tier, hours, blurb,
      address, source, place_id, business_status, photo_count,
      photo_attributions, reviews, last_verified
    ) values ${tuples.join(', ')}`,
    values,
  };
}

async function expectedBootstrapFixture(): Promise<{
  rows: CatalogBootstrapRow[];
  fingerprint: string;
  inventory: CatalogDependencyInventory;
}> {
  const inventory = inventoryCatalogDependencies(files);
  const { bars } = await import('../src/lib/bars');
  const rows = buildCatalogBootstrapRows(inventory, bars);
  return { rows, fingerprint: catalogBootstrapFingerprint(rows), inventory };
}

async function inspectBootstrap(
  client: Client,
  appliedMigrationNames: readonly string[],
  migrationWorkRemaining: boolean,
): Promise<boolean> {
  assertBootstrapLedgerIsPrefix(
    files.map((file) => file.name),
    appliedMigrationNames,
  );
  const markerPresent = await tableExists(client, BOOTSTRAP_MARKER_REGCLASS);
  assertBootstrapResumeState({
    appliedMigrationNames,
    markerPresent,
    barsCount: await barsCount(client),
    migrationWorkRemaining,
  });
  if (!markerPresent) return false;

  const expected = await expectedBootstrapFixture();
  const { rows } = await client.query<{
    fixture_fingerprint: string;
    required_count: number;
  }>(
    `select fixture_fingerprint, required_count
       from public.${BOOTSTRAP_MARKER}
      where singleton = true`,
  );
  const marker = rows[0];
  if (
    !marker ||
    marker.fixture_fingerprint !== expected.fingerprint ||
    marker.required_count !== expected.rows.length
  ) {
    throw new Error(
      'bootstrap refused: the interrupted fixture marker does not match this checkout',
    );
  }

  const pendingIds = pendingCatalogDependencyIds(
    expected.inventory,
    appliedMigrationNames,
  );
  if (pendingIds.length > 0) {
    const { rows: pendingRows } = await client.query<{ count: number }>(
      'select count(*)::integer as count from public.bars where id = any($1::text[])',
      [pendingIds],
    );
    if (pendingRows[0]?.count !== pendingIds.length) {
      throw new Error(
        `bootstrap refused: ${pendingIds.length - (pendingRows[0]?.count ?? 0)} ` +
          'pending catalog migration target(s) are missing',
      );
    }
  }
  console.log(`  bootstrap fixture marker verified (${marker.required_count} venues).`);
  return true;
}

async function installBootstrapFixture(client: Client): Promise<void> {
  const fixture = await expectedBootstrapFixture();
  await client.query('begin');
  try {
    const count = await barsCount(client);
    if (count !== 0) {
      throw new Error(`bootstrap fixture requires an empty bars table; found ${count} row(s)`);
    }

    await client.query(`
      create table public.${BOOTSTRAP_MARKER} (
        singleton boolean primary key default true check (singleton),
        fixture_fingerprint text not null,
        required_count integer not null check (required_count > 0),
        created_at timestamptz not null default now()
      );
      revoke all on table public.${BOOTSTRAP_MARKER} from public, anon, authenticated;
    `);

    for (let i = 0; i < fixture.rows.length; i += 100) {
      const insert = bootstrapInsert(fixture.rows.slice(i, i + 100));
      await client.query(insert.sql, insert.values);
    }

    const { rows: coverageRows } = await client.query<{ count: number }>(
      'select count(*)::integer as count from public.bars where id = any($1::text[])',
      [fixture.rows.map((row) => row.id)],
    );
    if (coverageRows[0]?.count !== fixture.rows.length) {
      throw new Error(
        `bootstrap fixture coverage mismatch: expected ${fixture.rows.length}, ` +
          `found ${coverageRows[0]?.count ?? 0}`,
      );
    }

    await client.query(
      `insert into public.${BOOTSTRAP_MARKER}
         (singleton, fixture_fingerprint, required_count)
       values (true, $1, $2)`,
      [fixture.fingerprint, fixture.rows.length],
    );
    await client.query('commit');
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  }
  console.log(
    `  installed sanitized bootstrap fixture (${fixture.rows.length} migration targets).`,
  );
}

async function finishBootstrap(client: Client): Promise<void> {
  await client.query('begin');
  try {
    await client.query(`drop table if exists public.${BOOTSTRAP_MARKER}`);
    await client.query('commit');
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  }
  console.log('  removed bootstrap marker; sanitized venue fixtures remain for staging tests.');
}

async function main() {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    console.log(
      `Migrations: ${files.length} file${files.length === 1 ? '' : 's'} → ${redactUrl(databaseUrl!)}`,
    );

    // One parameterless query message: on a fresh database CREATE, ENABLE RLS,
    // and REVOKE commit atomically, so Supabase's default browser-role grants
    // are never externally visible. On an existing database this also repairs
    // the ledger before its contents are trusted for planning.
    await client.query(MIGRATION_LEDGER_DDL);

    const { rows } = await client.query<AppliedMigration>(
      'select name, checksum from public.schema_migrations',
    );
    const plan = planMigrations(files, rows);

    if (plan.drift.length > 0) {
      console.error(
        '\nABORTED — these migrations were edited after being applied:\n',
      );
      for (const d of plan.drift) {
        console.error(`  ${d.name}`);
        console.error(`    recorded ${d.recorded}`);
        console.error(`    current  ${d.current}`);
      }
      console.error(
        '\nThe database and these files now disagree. Nothing was applied.\n' +
          'Fix by reverting the edit, or by moving the change into a NEW\n' +
          'numbered migration. Only if you are certain the database already\n' +
          'matches the edited file should you re-point the ledger by hand.',
      );
      process.exitCode = 1;
      return;
    }

    if (BASELINE) {
      // Verify the premise before recording it. --baseline asserts "every file on
      // disk already ran here"; against a fresh database it would instead record a
      // complete schema that does not exist, after which every run reports "up to
      // date" while nothing was ever created. The expectation is derived from the
      // migration files themselves, so it cannot go stale as migrations are added.
      const { rows: tableRows } = await client.query<{ table_name: string }>(
        `select table_name from information_schema.tables
          where table_schema = 'public' and table_type = 'BASE TABLE'`,
      );
      const premise = checkBaselinePremise(
        files,
        tableRows.map((r) => r.table_name),
      );

      if (!premise.ok) {
        const detail = premise.reason
          ? `  ${premise.reason}`
          : `  expected ${premise.expected.length} table(s) from the migration files\n`
            + `  MISSING from this database: ${premise.missing.join(', ')}`;
        if (!FORCE_BASELINE) {
          console.error(
            '\nREFUSED to baseline — this database does not look migrated.\n'
              + `${detail}\n\n`
              + 'Recording these as applied would mark migrations done without ever\n'
              + 'running them, and the next run would report "up to date" against a\n'
              + 'schema that was never created.\n\n'
              + 'If this is a NEW non-production database: run `npm run db:bootstrap`.\n'
              + 'That command installs the catalog fixture required by migrations 0026-0032.\n'
              + 'If you are certain the schema already matches these files: re-run with\n'
              + '--force-baseline.',
          );
          process.exitCode = 1;
          return;
        }
        console.warn(
          `\n--force-baseline: proceeding despite a FAILED premise check.\n${detail}\n`
            + 'You are asserting these migrations already ran here. If that is wrong,\n'
            + 'the ledger will permanently hide the missing schema work.',
        );
      }

      // ONE transaction. An interrupted baseline must leave no partial ledger,
      // because the rows it did manage to write would silently skip those files
      // forever while the rest re-ran — a split-brain ledger is worse than none.
      try {
        await client.query('begin');
        for (const file of files) {
          // DO NOTHING, deliberately, not DO UPDATE. An upsert would let a second
          // --baseline silently re-point the ledger at an edited file, erasing the
          // drift the guard exists to catch. Additive only; clearing drift stays a
          // deliberate manual act. (DeepSeek review, 2026-07-28.)
          await client.query(
            `insert into public.schema_migrations (name, checksum) values ($1, $2)
               on conflict (name) do nothing`,
            [file.name, checksum(file.sql)],
          );
        }
        await client.query('commit');
      } catch (err) {
        await client.query('rollback').catch(() => {});
        console.error('\nBaseline FAILED and rolled back; the ledger is unchanged.\n', err);
        process.exitCode = 1;
        return;
      }

      console.log(
        `\nBaselined ${files.length} migration(s) as applied. NOTHING was executed.`
          + `\nPremise verified: all ${premise.expected.length} expected table(s) present.`,
      );
      return;
    }

    let bootstrapFixtureReady = false;
    if (BOOTSTRAP) {
      bootstrapFixtureReady = await inspectBootstrap(
        client,
        rows.map((row) => row.name),
        plan.apply.length > 0,
      );
    }

    if (plan.skip.length > 0) {
      console.log(`  ${plan.skip.length} already applied, skipped.`);
    }

    if (plan.apply.length === 0) {
      if (BOOTSTRAP && bootstrapFixtureReady) await finishBootstrap(client);
      console.log('\nDatabase is up to date.');
      return;
    }

    for (const file of plan.apply) {
      if (
        BOOTSTRAP &&
        !bootstrapFixtureReady &&
        isAfterCatalogSchemaMigration(file.name)
      ) {
        await installBootstrapFixture(client);
        bootstrapFixtureReady = true;
      }

      process.stdout.write(`  • ${file.name} ... `);
      try {
        // The migration and its ledger row commit together, so a failure can
        // never leave a file recorded as applied when it was not.
        await client.query('begin');
        // Some historical data migrations contain their own top-level BEGIN /
        // COMMIT. Sending those unchanged inside this runner's transaction lets
        // the inner COMMIT detach the schema change from the ledger write. Keep
        // the checksummed file unchanged, but execute its body inside the one
        // transaction owned by this runner.
        const executable = unwrapMigrationTransaction(file.sql);
        await client.query(executable.sql);
        await client.query(
          'insert into public.schema_migrations (name, checksum) values ($1, $2)',
          [file.name, checksum(file.sql)],
        );
        await client.query('commit');
        process.stdout.write('ok\n');
      } catch (err) {
        process.stdout.write('FAILED\n');
        await client.query('rollback').catch(() => {});
        console.error(`\nError applying ${file.name}:\n`, err);
        process.exitCode = 1;
        return;
      }
    }

    if (BOOTSTRAP) {
      if (!bootstrapFixtureReady) {
        throw new Error(
          `bootstrap did not reach the fixture boundary after ${CATALOG_SCHEMA_MIGRATION}`,
        );
      }
      await finishBootstrap(client);
    }

    console.log(`\nApplied ${plan.apply.length} migration(s).`);
  } finally {
    await client.end();
  }
}

function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.username}:***@${u.host}${u.pathname}`;
  } catch {
    return '<invalid url>';
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
