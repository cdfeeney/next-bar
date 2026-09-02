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

/**
 * COUNTS ARE READ FROM THE PRE-APPLY DUMP. They used to be a hardcoded object whose header
 * CLAIMED to be 'measured from the revert-point dump' - and it was, once, on 2026-08-31, before
 * phase D loaded 851 bars. On 09-02 it failed a correct production apply with
 * `public.bars: 2107 rows, expected 1256`: the THIRD tool in this set to refuse a right answer
 * from a stale pin.
 *
 * A comment saying a constant was measured is not the same as measuring it. So the dump is now
 * READ, and the comparison is genuinely before-versus-after rather than after-versus-a-memory.
 * The dump's shape is { ref, taken_at, tables: { name: rows[] } }, so a count is a row-array
 * length.
 */
const TRACKED_TABLES = [
  'auth.users', 'public.profiles', 'public.bars', 'public.ratings',
  'public.follows', 'public.pairwise_comparisons', 'public.waitlist',
] as const;

function countsFromDump(file: string): Record<string, number> {
  let parsed: { ref?: string; taken_at?: string; tables?: Record<string, unknown[]> };
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    process.stderr.write(`--pre-dump ${file} could not be read: ${(error as Error).message}\n`);
    process.exit(2);
  }
  const tables = parsed.tables;
  if (!tables || typeof tables !== 'object') {
    process.stderr.write(`--pre-dump ${file} has no 'tables' object; it is not a db:dump file\n`);
    process.exit(2);
  }
  const counts: Record<string, number> = {};
  for (const name of TRACKED_TABLES) {
    const rows = tables[name];
    // A table absent from the dump is NOT zero - it is unmeasured, and treating it as zero
    // would turn a gap in the evidence into a passing assertion.
    if (!Array.isArray(rows)) {
      process.stderr.write(`--pre-dump ${file} does not contain ${name}; cannot verify it survived\n`);
      process.exit(2);
    }
    counts[name] = rows.length;
  }
  process.stdout.write(`pre-apply dump  : ${file}\n`);
  process.stdout.write(`  taken_at      : ${parsed.taken_at ?? '(unstated)'}\n`);
  process.stdout.write(`  ref           : ${parsed.ref ?? '(unstated)'}\n\n`);
  return counts;
}

const EXPECTED_COUNTS = countsFromDump(requireArg('--pre-dump'));

/**
 * REQUIRED PARAMETERS, not constants. Pinning these in the file is how this tool and
 * db-precheck-prod both came to refuse a correct database: the pin describes the database on
 * the day it was written, and the database moves. The caller states what it expects, and
 * omitting it is refused rather than checked against a stale snapshot.
 */
function requireArg(name: string): string {
  const value = arg(name);
  if (value === null || value === '') {
    process.stderr.write(
      `${name} is REQUIRED - this tool does not carry a hardcoded snapshot of a moving `
      + 'database. Pass what the apply was expected to produce, e.g. --expect-head '
      + '0076_feed_access_consolidation_and_group_read_window.sql --expect-rows 68\n',
    );
    process.exit(2);
  }
  return value;
}
const EXPECTED_HEAD = requireArg('--expect-head');
const EXPECTED_ROWS = Number(requireArg('--expect-rows'));

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
