/**
 * apply-migrations.ts
 *
 * Reads every *.sql file in supabase/migrations/ in lexical order and applies
 * each one against the Postgres database pointed to by DATABASE_URL.
 *
 * !! DO NOT RUN THIS AGAINST A SHARED DATABASE. THIS RUNNER IS LEDGER-BLIND. !!
 *
 * The comment that used to sit here said migrations are NOT tracked in a
 * schema_migrations table. That is FALSE and was false when read on 2026-08-16:
 * `public.schema_migrations` exists, holds a name + checksum per applied file,
 * and was created by 0036_protect_schema_migrations.sql. This runner does not
 * consult it, so it re-executes EVERY file on every run and relies purely on
 * idempotency.
 *
 * Why that matters concretely: eleven of this branch's 0000-0010 files differ
 * from the checksums recorded in the live ledger. A blind replay would re-run
 * older, different versions of the base schema over a database that has moved
 * past them — including re-granting privileges 0034_revoke_first_grants.sql had
 * deliberately tightened. Idempotency does not save you when the FILE changed.
 *
 * Use nb-overnight's apply-migrations.ts instead: it hashes each file, records
 * it in the ledger, and refuses ambiguous partial state. Or apply named files
 * individually, checking the ledger first and numbering above its maximum.
 *
 * Usage (isolated/throwaway databases only):
 *   1. Set DATABASE_URL in .env.local (Supabase → Project Settings →
 *      Database → Connection string → URI, Transaction pooler, port 6543).
 *   2. `npm run db:migrate`
 *
 * Safety: aborts on the first SQL error and reports the file that failed.
 */

import { config as loadEnv } from 'dotenv';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';

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

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error(
    'DATABASE_URL is not set. Add it to .env.local (Supabase → Project Settings → Database → Connection string → URI).',
  );
  process.exit(1);
}

const migrationsDir = join(process.cwd(), 'supabase', 'migrations');

let files: string[];
try {
  files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
} catch (err) {
  console.error(`Could not read ${migrationsDir}:`, err);
  process.exit(1);
}

if (files.length === 0) {
  console.log('No migration files found. Nothing to do.');
  process.exit(0);
}

async function main() {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  console.log(`Applying ${files.length} migration${files.length === 1 ? '' : 's'} to ${redactUrl(databaseUrl!)}`);

  for (const file of files) {
    const path = join(migrationsDir, file);
    const sql = readFileSync(path, 'utf-8');
    process.stdout.write(`  • ${file} ... `);
    try {
      await client.query(sql);
      process.stdout.write('ok\n');
    } catch (err) {
      process.stdout.write('FAILED\n');
      console.error(`\nError applying ${file}:\n`, err);
      await client.end();
      process.exit(1);
    }
  }

  await client.end();
  console.log('\nAll migrations applied.');
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
