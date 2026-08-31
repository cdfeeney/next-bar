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

import { config as loadEnv, parse as parseEnv } from 'dotenv';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
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
import { normalisedSql } from '../src/lib/effectiveMigration';
import { deriveLabel, parseRef, resolveTarget } from './lib/migration-target-guard';
import { readClassification } from './lib/classification';


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

// A separate --secrets-file is how you reach a NON-default target without editing .env.local.
// Repointing .env.local at another project is the obvious workaround and it is a trap: it silently
// redirects every other tool in the repo, including the live RLS suite, and it stays repointed
// until someone remembers to undo it. Mirrors scripts/apply-migration-set.ts exactly — same flag
// name, override:true, loaded BEFORE .env.local, existence checked by hand.
//
// NOTE: deliberately NOT called --env-file. That name is a reserved Node flag; node consumes it
// before the script is reached and the failure looks like a missing file rather than a collision.
const secretsFileIndex = process.argv.indexOf('--secrets-file');
const SECRETS_FILE = secretsFileIndex >= 0 ? process.argv[secretsFileIndex + 1] ?? '' : null;

// Snapshot BEFORE any dotenv load. dotenv defaults to override:false, so a DATABASE_URL exported in
// the shell survives every load below and is afterwards indistinguishable from one a file supplied.
const shellDatabaseUrl = process.env.DATABASE_URL;
// The LABEL is snapshotted for the opposite reason: a --secrets-file loads with override:true, so a
// label in that file REPLACES one exported in the shell, and a human who exported a contradicting
// label would be silently corrected instead of refused.
const shellDeclaredEnv = process.env.NEXT_BAR_DATABASE_ENVIRONMENT;

if (SECRETS_FILE !== null) {
  if (SECRETS_FILE === '') {
    console.error('--secrets-file needs a path');
    process.exit(1);
  }
  // Checked by hand: dotenv does not reliably surface a missing file as an error, so a typo'd path
  // would fall through to .env.local and point this at whatever THAT names. A guard that does not
  // guard is worse than no guard, because it is trusted.
  if (!existsSync(SECRETS_FILE)) {
    console.error(`--secrets-file ${SECRETS_FILE} does not exist`);
    process.exit(1);
  }
  loadEnv({ path: SECRETS_FILE, override: true });
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

/**
 * THE GUARD RUNS IN EVERY MODE. It used to sit inside `if (BOOTSTRAP)`, so a plain
 * `npm run db:migrate` — the most ordinary command in this file — reached `new Client` and wrote
 * the ledger having checked no ref, no API pair, no classification, no label, no endpoint and no
 * libpq environment (round 4, CRITICAL). A guard that covers one flag of one script is not a guard;
 * it is a guard-shaped thing next to three unguarded doors, which is exactly how this repo already
 * lost a database. The bootstrap-specific reasoning below is unchanged; only its scope is.
 */
const GUARD_TAG = BOOTSTRAP ? '[bootstrap-guard]' : '[migrate-guard]';
let derivedLabel: string;
let certifiedUrl: string;
{
  // ONE CLASSIFICATION RULE, NOT TWO. The label is DERIVED from the project ref by the same guard
  // apply-migration-set.ts uses; this script used to read NEXT_BAR_DATABASE_ENVIRONMENT and trust
  // it. That is the defect class that destroyed staging on 2026-08-28: `.env.staging.local` carries
  // a connection string and (until it was fixed) no label, dotenv's override:false let `.env.local`
  // supply the word, and a STAGING connection string wore the label "production". Trusting the label
  // here would refuse the honest staging bootstrap and accept a mislabelled one.
  //
  // resolveTarget also refuses a URL/API pair naming different projects, an unclassified project,
  // and any label that CONTRADICTS the ref — from the shell or from a loaded file.
  // ITEM 3: the bootstrap has no --env flag, so the label it asks for is the one the TARGET already
  // derives to. Hard-coding 'staging' regressed DEVELOPMENT, which assertNonProductionBootstrapTarget
  // still permits — a development ref would be refused as a contradiction or misread as staging.
  // Asking for whatever the ref derives keeps resolveTarget's real work (pair agreement,
  // classification, contradiction) while leaving the production refusal to the guard below, which
  // is the check that actually protects the live data.
  try {
    // Inside the try: an incoherent classification file (no declared production ref, or a ref in
    // two lists) is a refusal like any other and must print as one, not as a stack trace.
    const bootstrapClassification = readClassification();
    const targetRef = parseRef(process.env.DATABASE_URL);
    const targetLabel = deriveLabel(targetRef, bootstrapClassification);
    const resolved = resolveTarget({
      env: targetLabel ?? 'unknown',
      shellDatabaseUrl,
      shellDeclaredEnv,
      databaseUrl: process.env.DATABASE_URL,
      apiUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
      actualEnv: process.env.NEXT_BAR_DATABASE_ENVIRONMENT,
      // Read from the repo-root .env.local FILE, never process.env: a --secrets-file must not be
      // able to supply or shadow the operator's classification of which project is which.
      classification: bootstrapClassification,
    });
    derivedLabel = resolved.label as string;
    // THE STRING THE GUARD CERTIFIED — not `process.env.DATABASE_URL` read a second time. The
    // connection below is opened from this and nothing else (round 4: certify one snapshot,
    // connect from another).
    certifiedUrl = resolved.connectionString;
  } catch (error) {
    console.error(`${GUARD_TAG} ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }

  try {
    // KEPT, and now fed the DERIVED label. It is a second, independent statement of the one rule
    // that protects live data — only staging and development may be written by THIS script, in any
    // mode. Production is reached exclusively through apply-migration-set.ts, which carries the
    // channel-security layer, the --env agreement and the ledger checks this script does not.
    assertNonProductionBootstrapTarget({ environmentLabel: derivedLabel });
  } catch (error) {
    console.error(`${GUARD_TAG} ${error instanceof Error ? error.message : String(error)}`);
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
      // NORMALISED BEFORE IT IS EXECUTED, exactly as apply-migration-set.ts does.
      //
      // This runner read the RAW buffer, and on a core.autocrlf=true checkout that means the
      // SERVER STORES CRLF while the repository commits LF. Postgres does not care, but
      // pg_proc.prosrc then differs from the committed text for every function the run creates —
      // which is exactly the applied-versus-committed evidence nightOutsRls.live.test.ts carries.
      // After B3 it failed on five night-out functions for precisely this reason, every length
      // delta equal to the newline count. CLAUDE.md already records the same defect in the set
      // applier (hash and execute the same string, round-9); the bootstrap runner never learned
      // it, so a database bootstrapped here was not byte-comparable with one migrated through
      // that applier.
      sql: normalisedSql(readFileSync(join(migrationsDir, name), 'utf-8')),
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
  const client = new Client({ connectionString: certifiedUrl });
  await client.connect();

  try {
    console.log(
      `Migrations: ${files.length} file${files.length === 1 ? '' : 's'} → ${redactUrl(certifiedUrl)}`
      + ` [${derivedLabel}]`,
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
