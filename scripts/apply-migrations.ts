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
 *   `npm run db:migrate -- --baseline` records every current file as applied
 *   WITHOUT executing it. Use this exactly once, when adopting the ledger on a
 *   database you already know matches the files on disk — it avoids re-running
 *   nineteen historical migrations against production. It is a claim about
 *   reality, so it is wrong to use it on a database you have not verified.
 *
 * Safety: aborts on the first error and names the file that failed.
 */

import { config as loadEnv } from 'dotenv';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import {
  checksum,
  planMigrations,
  type AppliedMigration,
  type MigrationFile,
} from '../src/lib/migrationPlan';

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

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error(
    'DATABASE_URL is not set. Add it to .env.local (Supabase → Project Settings → Database → Connection string → URI).',
  );
  process.exit(1);
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

/**
 * The ledger is bootstrapped here rather than as a numbered migration —
 * a migration that records migrations cannot record itself.
 */
const LEDGER_DDL = `
  create table if not exists public.schema_migrations (
    name       text primary key,
    checksum   text not null,
    applied_at timestamptz not null default now()
  );
`;

async function main() {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    console.log(
      `Migrations: ${files.length} file${files.length === 1 ? '' : 's'} → ${redactUrl(databaseUrl!)}`,
    );

    await client.query(LEDGER_DDL);

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
      for (const file of files) {
        // DO NOTHING, deliberately, not DO UPDATE. An upsert here would let a
        // second --baseline silently re-point the ledger at an edited file, so
        // the sequence "baseline, edit an applied migration, baseline again"
        // would erase the drift the guard exists to catch. Recording only
        // files that are not already recorded keeps baseline additive and
        // makes drift un-clearable except by deliberate manual intervention.
        // (Found by DeepSeek review, 2026-07-28.)
        await client.query(
          `insert into public.schema_migrations (name, checksum) values ($1, $2)
             on conflict (name) do nothing`,
          [file.name, checksum(file.sql)],
        );
      }
      console.log(
        `\nBaselined ${files.length} migration(s) as applied. NOTHING was executed.`,
      );
      return;
    }

    if (plan.skip.length > 0) {
      console.log(`  ${plan.skip.length} already applied, skipped.`);
    }

    if (plan.apply.length === 0) {
      console.log('\nDatabase is up to date.');
      return;
    }

    for (const file of plan.apply) {
      process.stdout.write(`  • ${file.name} ... `);
      try {
        // The migration and its ledger row commit together, so a failure can
        // never leave a file recorded as applied when it was not.
        await client.query('begin');
        await client.query(file.sql);
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
