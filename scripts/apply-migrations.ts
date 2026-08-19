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
 * Why that matters concretely: a blind replay re-runs the base schema over a
 * database that has moved past it — including re-granting privileges
 * 0034_revoke_first_grants.sql had deliberately tightened. Idempotency does not
 * save you when the ORDER is wrong.
 *
 * This paragraph used to add that "eleven of this branch's 0000-0010 files
 * differ from the checksums recorded in the live ledger". They do not. That
 * reading hashed raw bytes against a ledger that records a NORMALISED digest
 * (see migrationChecksum in src/lib/effectiveMigration.ts); re-measured against
 * the serving ledger, all eleven are present and all eleven match. Corrected
 * here, in CLAUDE.md, and in apply-migration-set.ts — the same mistake was
 * written into all three.
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

/**
 * Hard gate: a database that keeps a ledger is a SHARED database, and this
 * runner is ledger-blind.
 *
 * The warning at the top of this file, and the identical one in CLAUDE.md, are
 * prose — and 0044_night_outs.sql, which is already applied and therefore
 * immutable, still carries an APPLY GATE checklist pointing an operator right
 * back here. A comment cannot stop that; a refusal can. LOOP_UNATTENDED=1 only
 * ever covered the overnight loop, which is the one case nobody was worried
 * about: the dangerous run is an attended operator following a stale checklist
 * at the exact moment they believe they are being careful.
 */
async function assertNotLedgerBearing(client: Client): Promise<void> {
  const { rows } = await client.query(
    "select to_regclass('public.schema_migrations') is not null as tracked",
  );
  if (!rows[0]?.tracked) return;
  const { rows: head } = await client.query(
    'select name from public.schema_migrations order by name desc limit 1',
  );
  console.error(
    '\n[ledger-guard] REFUSING to run.\n'
    + `  ${redactUrl(databaseUrl!)} has a public.schema_migrations ledger (head: ${head[0]?.name ?? 'unknown'}).\n`
    + '  This runner replays EVERY file in lexical order and consults no ledger, so it would\n'
    + "  re-execute older, divergent copies of the base schema over a database that has moved past\n"
    + '  them — including re-granting privileges 0034_revoke_first_grants.sql tightened.\n\n'
    + "  Use nb-overnight's ledger-aware runner, or apply the specific file by hand after reading\n"
    + '  the ledger and numbering above its maximum. Ignore any apply checklist embedded inside an\n'
    + '  already-applied migration file; those cannot be corrected in place.\n',
  );
  await client.end();
  process.exit(1);
}

async function main() {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  await assertNotLedgerBearing(client);

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
