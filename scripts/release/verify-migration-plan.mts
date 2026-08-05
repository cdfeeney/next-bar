/**
 * Pre-apply gate: prove what the ledgered runner WOULD apply, without
 * applying anything.
 *
 * Run from THIS worktree, with the same DATABASE_URL the apply will use:
 *
 *   npx tsx scripts/release/verify-migration-plan.mts --expect 0033,0034,0035,0036
 *
 * It reads `supabase/migrations/*.sql` from this checkout and the ledger from
 * the target database (a single SELECT), then runs the SAME `planMigrations`
 * the runner imports — so the proof and the apply cannot describe different
 * code. Exits non-zero unless the plan matches `--expect` exactly with zero
 * drift.
 *
 * Read-only: one SELECT, no writes, no DDL. Deliberately reads the ledger via
 * DATABASE_URL rather than a browser key: after 0036 the ledger is no longer
 * readable by anon/authenticated, so any anon-key check would stop working the
 * moment the migration it is verifying succeeds.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { config as loadEnv } from 'dotenv';
import { Client } from 'pg';
import { planMigrations, type MigrationFile } from '../../src/lib/migrationPlan';

loadEnv({ path: '.env.local' });
loadEnv({ path: '.env' });

const expectArg = process.argv[process.argv.indexOf('--expect') + 1];
const expected = (expectArg ?? '').split(',').map((s) => s.trim()).filter(Boolean);
if (expected.length === 0) {
  console.error('usage: --expect 0033,0034,0035,0036   (migration number prefixes)');
  process.exit(2);
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is not set.');
  process.exit(2);
}

const dir = join(process.cwd(), 'supabase', 'migrations');
const files: MigrationFile[] = readdirSync(dir)
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .map((name) => ({ name, sql: readFileSync(join(dir, name), 'utf8') }));

const client = new Client({ connectionString: databaseUrl });
await client.connect();
let applied: Array<{ name: string; checksum: string }>;
try {
  const res = await client.query<{ name: string; checksum: string }>(
    'select name, checksum from public.schema_migrations order by name',
  );
  applied = res.rows;
} finally {
  await client.end();
}

const plan = planMigrations(files, applied);
const names = plan.apply.map((f) => f.name);

console.log(`migration files here : ${files.length}`);
console.log(`ledger rows on target: ${applied.length} (last ${applied.at(-1)?.name ?? 'none'})`);
console.log(`WOULD APPLY (${names.length}): ${names.join(', ') || '(none)'}`);
console.log(`skip ${plan.skip.length} | drift ${plan.drift.length}`);
if (plan.drift.length > 0) console.log(`DRIFT: ${JSON.stringify(plan.drift)}`);

const matches =
  names.length === expected.length &&
  expected.every((prefix, i) => names[i]?.startsWith(prefix));
const ok = matches && plan.drift.length === 0;
console.log(`\n${ok ? 'PASS' : 'FAIL'} — expected exactly [${expected.join(', ')}]`);
process.exit(ok ? 0 : 1);
