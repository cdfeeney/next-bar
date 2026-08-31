/**
 * READ-ONLY post-apply verification for phase C. The T0 gate's third phase is a post-deploy check
 * that is AUTHORITATIVE, and for a schema migration the question is not "did the tool exit 0" but
 * "does the database now hold what the ledger claims, and did the data survive".
 *
 * Opens the session read only at the server, so it cannot write.
 *
 * IT CHECKS:
 *   - every ledger row has a file here whose normalised checksum matches (the C-1 pre-check's rule,
 *     now applied to all 66 rows rather than 33);
 *   - the row count and head are what the apply predicted;
 *   - the data that existed before the apply still exists, at the same counts;
 *   - the drift repair actually took (profiles.shares_list_publicly exists);
 *   - 0066's retirement actually took (get_public_ratings is gone);
 *   - the headline tables the 33 files create are present.
 *
 *   PGSSLROOTCERT=<ca> npx tsx scripts/dev/verify-post-apply.mts --secrets-file <env>
 *
 * Exit 0 all as expected - 2 something is not.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import pg from 'pg';

import { checksumOfSql } from '../../src/lib/effectiveMigration';
import { certify } from '../lib/whoami';

function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] ?? '' : null;
}

/** Measured on production immediately BEFORE the apply, from the 12-26-14Z revert-point dump. */
const EXPECTED_COUNTS: Record<string, number> = {
  'auth.users': 8,
  'public.profiles': 8,
  'public.bars': 1256,
  'public.ratings': 32,
  'public.follows': 16,
  'public.pairwise_comparisons': 49,
  'public.waitlist': 1,
};

const EXPECTED_HEAD = '0074_waitlist_reconcile.sql';
const EXPECTED_ROWS = 66;

/** Headline tables the applied set creates. Not exhaustive: a spot check, named as one. */
const EXPECTED_NEW_TABLES = [
  'night_outs', 'night_out_members', 'stories', 'groups', 'feed_posts', 'media_objects',
  'vibe_profiles', 'profile_blocks', 'account_content_state',
];

const identity = await certify(arg('--secrets-file'));
if (identity.refusals.length > 0) {
  for (const reason of identity.refusals) process.stderr.write(`${reason}\n`);
  process.exit(2);
}
process.stdout.write(`target : ${identity.ref} (${identity.label})\n\n`);

const problems: string[] = [];
const client = new pg.Client({ connectionString: identity.certified.connectionString });
await client.connect();
try {
  await client.query('set session characteristics as transaction read only');

  // 1. LEDGER vs FILES, all 66.
  const ledger = await client.query<{ name: string; checksum: string }>(
    'select name, checksum from public.schema_migrations order by name',
  );
  const dir = path.join(process.cwd(), 'supabase', 'migrations');
  let matched = 0;
  for (const row of ledger.rows) {
    const file = path.join(dir, row.name);
    if (!existsSync(file)) {
      problems.push(`ledger names ${row.name} but no such file exists here`);
      continue;
    }
    const actual = checksumOfSql(readFileSync(file, 'utf8'));
    if (actual !== row.checksum) {
      problems.push(`${row.name}: checksum differs - ledger ${row.checksum.slice(0, 12)}, file ${actual.slice(0, 12)}`);
    } else {
      matched += 1;
    }
  }
  const head = ledger.rows.map((r) => r.name).sort().pop() ?? '(none)';
  process.stdout.write(`ledger rows      : ${ledger.rows.length}\n`);
  process.stdout.write(`checksums matched: ${matched}/${ledger.rows.length}\n`);
  process.stdout.write(`head             : ${head}\n\n`);
  if (ledger.rows.length !== EXPECTED_ROWS) problems.push(`ledger has ${ledger.rows.length} rows, expected ${EXPECTED_ROWS}`);
  if (head !== EXPECTED_HEAD) problems.push(`head is ${head}, expected ${EXPECTED_HEAD}`);

  // 2. THE DATA SURVIVED. This is the one that matters most.
  process.stdout.write('counts, against the pre-apply revert point:\n');
  for (const [table, expected] of Object.entries(EXPECTED_COUNTS)) {
    const quoted = table.split('.').map((p) => `"${p}"`).join('.');
    const { rows } = await client.query<{ n: number }>(`select count(*)::int n from ${quoted}`);
    const actual = rows[0]?.n ?? -1;
    const ok = actual === expected;
    process.stdout.write(`  ${table.padEnd(28)}${String(actual).padEnd(8)}${ok ? 'ok' : `EXPECTED ${expected}`}\n`);
    if (!ok) problems.push(`${table}: ${actual} rows, expected ${expected}`);
  }

  // 3. The drift repair took.
  const flag = await client.query(
    `select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'profiles'
        and column_name = 'shares_list_publicly'`,
  );
  process.stdout.write(`\nprofiles.shares_list_publicly : ${flag.rowCount === 1 ? 'present (repair took)' : 'MISSING'}\n`);
  if (flag.rowCount !== 1) problems.push('the 0033_a repair did not take: profiles.shares_list_publicly is still missing');

  // 4. 0066's retirement took.
  const retired = await client.query(
    `select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'get_public_ratings'`,
  );
  process.stdout.write(`get_public_ratings            : ${retired.rowCount === 0 ? 'gone (0066 took)' : 'STILL PRESENT'}\n`);
  if (retired.rowCount !== 0) problems.push('0066 did not retire get_public_ratings');

  // 5. The headline tables exist.
  const tables = await client.query<{ table_name: string }>(
    `select table_name from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE'`,
  );
  const liveTables = new Set(tables.rows.map((r) => r.table_name));
  const missing = EXPECTED_NEW_TABLES.filter((t) => !liveTables.has(t));
  process.stdout.write(`public tables                 : ${liveTables.size}\n`);
  process.stdout.write(`spot-checked new tables       : ${missing.length === 0 ? `all ${EXPECTED_NEW_TABLES.length} present` : `MISSING ${missing.join(', ')}`}\n`);
  if (missing.length > 0) problems.push(`missing tables the set should have created: ${missing.join(', ')}`);
} finally {
  await client.end();
}

if (problems.length > 0) {
  process.stderr.write('\n[verify] PROBLEMS:\n');
  for (const p of problems) process.stderr.write(`  - ${p}\n`);
  process.exit(2);
}
process.stdout.write('\n[verify] phase C verified: ledger, data, repair, retirement, and schema all as expected.\n');
