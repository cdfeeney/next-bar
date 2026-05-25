/**
 * apply-migrations.ts
 *
 * Reads every *.sql file in supabase/migrations/ in lexical order and applies
 * each one against the Postgres database pointed to by DATABASE_URL.
 *
 * Migrations are NOT tracked in a schema_migrations table — they must be
 * idempotent (use CREATE ... IF NOT EXISTS, DROP POLICY IF EXISTS, etc.).
 * That's fine for v0.5.x; a real ledger is on the list when we have more
 * than a handful of files.
 *
 * Usage:
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
