/**
 * apply-one-migration — apply a SINGLE migration file attended, without
 * running the whole ledger-less runner (which re-runs every file).
 *
 * WHY: two work streams can have authored-but-gated migrations in the
 * same directory (e.g. 0015's apply gate belongs to its own stream).
 * `npm run db:migrate` is all-or-nothing; this applies exactly one file
 * so a stream never applies another stream's DDL as a side effect.
 *
 * ATTENDED ONLY: writes DDL to the production DB.
 *
 *   npx tsx scripts/apply-one-migration.mts supabase/migrations/0016_shared_nights.sql
 */
import { config } from 'dotenv';
import { readFileSync } from 'node:fs';
import { Client } from 'pg';

config({ path: '.env.local' });

if (process.env.LOOP_UNATTENDED === '1') {
  console.error('apply-one-migration writes prod DDL — attended runs only.');
  process.exit(2);
}

const file = process.argv[2];
if (!file || !/supabase[\\/]migrations[\\/].+\.sql$/.test(file)) {
  console.error('usage: npx tsx scripts/apply-one-migration.mts supabase/migrations/<file>.sql');
  process.exit(2);
}
const DB = process.env.DATABASE_URL;
if (!DB) {
  console.error('missing DATABASE_URL');
  process.exit(2);
}

const sql = readFileSync(file, 'utf8');
const pg = new Client({ connectionString: DB });
try {
  await pg.connect();
  await pg.query(sql);
  console.log(`ok ${file}`);
} catch (err) {
  console.error(`FAIL ${file}:`, err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await pg.end();
}
