/**
 * db:precheck — the READ-ONLY pre-check that runs before phase C touches production.
 *
 * IT WRITES NOTHING. Every statement is a select, and the session is opened
 * `default_transaction_read_only`, so "never writes" is enforced by the server rather than promised
 * by this comment. It exists because phase C forward-migrates the database that holds the only
 * surviving data, and the answer to "is this database in the state we think it is" must be measured
 * immediately before, not inferred from a handoff written hours earlier.
 *
 * WHAT IT REFUSES ON. Anything unexpected, and it prints everything it checked either way:
 *   - the target is not the declared production project, or the guard cannot certify it;
 *   - the applied set is not exactly 0000-0032 (the ledger head production is known to hold);
 *   - a migration file is missing for a row the ledger claims, or a checksum disagrees;
 *   - the pending set is not exactly 0033-0074 minus the reserved gaps;
 *   - public.waitlist's live shape differs from what 0074 would create.
 * A refusal here means STOP AND REPORT, never "adjust the plan and continue".
 *
 * Usage (phase C, after the operator's go and after db:dump):
 *   PGSSLROOTCERT=<ca> npx tsx scripts/db-precheck-prod.mts --secrets-file <production secrets>
 *
 * Exit codes: 0 everything as expected · 1 could not read · 2 REFUSED, something is unexpected
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import pg from 'pg';

import { checksumOfSql } from '../src/lib/effectiveMigration';
import { readClassification } from './lib/classification';
import { TargetRefusal } from './lib/migration-target-guard';
import { certify, WhoamiConnectionError } from './lib/whoami';

function fail(message: string, code: number): never {
  process.stderr.write(`[db:precheck] ${message}\n`);
  process.exit(code);
}

function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] ?? '' : null;
}

/**
 * THE EXPECTED STATE IS A PARAMETER, NOT A SNAPSHOT, and it is REQUIRED.
 *
 * This constant used to be '0032_geocode_remaining_from_osm.sql' - what production held on
 * 2026-08-28. Phase C moved production to 0074 on 08-31, nobody updated the constant, and on
 * 09-01 this tool refused a CORRECT database with "applied head is 0074..., expected 0032".
 * That is the second tool to rot the same way (verify-post-apply.mts was the first).
 *
 * A hardcoded snapshot of a moving database is a lie with a timestamp on it. So the caller -
 * the gate script, which knows what it is about to apply - passes what it expects, and there
 * is NO DEFAULT: omitting it is refused rather than silently checked against last month.
 */
function requireArg(name: string): string {
  const value = arg(name);
  if (value === null || value === '') {
    fail(
      `${name} is REQUIRED. This tool refuses to carry a hardcoded snapshot of a database that `
      + 'moves; the caller states what it expects. Pass the CURRENT head, row count and pending '
      + 'set, e.g. --expect-head 0074_waitlist_reconcile.sql --expect-rows 66 '
      + '--expect-pending 0075_x.sql,0076_y.sql',
      2,
    );
  }
  return value;
}

/** 0074 creates these seven columns; the live table must match, or the migration is a lie. */
const WAITLIST_COLUMNS = [
  'id', 'email', 'vibe_profile', 'neighborhood', 'age_range', 'source', 'created_at',
];
const WAITLIST_POLICIES = ['waitlist anyone insert', 'waitlist service role select'];

async function main(): Promise<void> {
  const secretsFile = arg('--secrets-file');
  const expectedHead = requireArg('--expect-head');
  const expectedRows = Number(requireArg('--expect-rows'));
  if (!Number.isInteger(expectedRows) || expectedRows < 1) {
    fail('--expect-rows takes a positive integer', 2);
  }
  const expectedPending = requireArg('--expect-pending').split(',').map((s) => s.trim()).filter(Boolean);
  const migrationsDir = path.join(process.cwd(), 'supabase', 'migrations');

  const classification = readClassification();
  const productionRef = classification.productionRef as string;

  // ── IDENTITY, through the shared guard, before any socket ────────────────────────────────────
  const identity = await certify(secretsFile);
  if (identity.refusals.length > 0) {
    for (const reason of identity.refusals) process.stderr.write(`[db:precheck] ${reason}\n`);
    fail('the target was refused — a pre-check of an unidentified database proves nothing', 2);
  }
  const { certified, ref, label } = identity;

  // This is the ONE tool in the set that is SUPPOSED to be pointed at production, so it refuses the
  // opposite of what the others do: anything that is NOT production is the wrong target here.
  if (ref !== productionRef) {
    fail(
      `REFUSED: this is the production pre-check and the target is ${ref} (${label}), not the `
      + `declared production ref ${productionRef}.`,
      2,
    );
  }

  process.stdout.write(`target : ${ref} (${label})\n\n`);

  const client = new pg.Client({ connectionString: certified.connectionString });
  try {
    await client.connect();
  } catch (error) {
    fail(`could not connect: ${(error as Error).message}`, 1);
  }

  const problems: string[] = [];
  try {
    // ENFORCED READ-ONLY BY THE SERVER, not by intent.
    await client.query('set session characteristics as transaction read only');

    // ── 1. WHOAMI-STYLE COUNTS ─────────────────────────────────────────────────────────────────
    const counts = await client.query<{ table_name: string; n: string }>(
      `select c.relname as table_name, c.reltuples::bigint::text as n
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r'
        order by c.relname`,
    );
    process.stdout.write('tables (estimated rows, from the planner — exact counts below for the ones that matter):\n');
    for (const row of counts.rows) process.stdout.write(`  ${row.table_name.padEnd(34)}${row.n}\n`);

    for (const table of ['auth.users', 'public.profiles', 'public.bars', 'public.waitlist']) {
      try {
        const exact = await client.query<{ n: number }>(
          `select count(*)::int n from ${table.split('.').map((p) => `"${p}"`).join('.')}`,
        );
        process.stdout.write(`  EXACT ${table.padEnd(30)}${exact.rows[0]?.n}\n`);
      } catch {
        process.stdout.write(`  EXACT ${table.padEnd(30)}(no such table)\n`);
      }
    }

    // ── 2. LEDGER vs FILES ─────────────────────────────────────────────────────────────────────
    const ledger = await client.query<{ name: string; checksum: string }>(
      'select name, checksum from public.schema_migrations order by name',
    );
    const files = existsSync(migrationsDir)
      ? readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()
      : [];
    const applied = new Map(ledger.rows.map((r) => [r.name, r.checksum]));
    const pending = files.filter((f) => !applied.has(f));

    process.stdout.write(`\nledger rows : ${applied.size}\n`);
    process.stdout.write(`files       : ${files.length}\n`);
    process.stdout.write(`pending     : ${pending.length}\n`);

    const appliedMax = [...applied.keys()].sort().pop() ?? '(none)';
    process.stdout.write(`applied head: ${appliedMax}\n`);
    if (appliedMax !== expectedHead) {
      problems.push(`applied head is ${appliedMax}, expected ${expectedHead}`);
    }
    if (applied.size !== expectedRows) {
      problems.push(`ledger has ${applied.size} rows, expected ${expectedRows}`);
    }
    // THE PENDING SET WAS ONLY EVER PRINTED, NEVER ASSERTED - so a surprise extra migration
    // would have scrolled past a reader as just another line. Now it is checked exactly, in
    // order, because "what is about to be applied" is the one thing a pre-check exists to pin.
    const pendingMismatch = pending.length !== expectedPending.length
      || pending.some((name, i) => name !== expectedPending[i]);
    if (pendingMismatch) {
      problems.push(
        `pending set is [${pending.join(', ')}], expected [${expectedPending.join(', ')}]`,
      );
    }

    // A row the repository cannot produce a file for is drift this tool must not paper over.
    for (const [name, checksum] of applied) {
      const file = path.join(migrationsDir, name);
      if (!existsSync(file)) {
        problems.push(`ledger names ${name} but no such file exists here`);
        continue;
      }
      const actual = checksumOfSql(readFileSync(file, 'utf8'));
      if (actual !== checksum) {
        problems.push(`${name}: checksum differs — ledger ${checksum.slice(0, 12)}, file ${actual.slice(0, 12)}`);
      }
    }

    process.stdout.write('\npending files, in the order they would apply:\n');
    for (const f of pending) process.stdout.write(`  ${f}\n`);

    // ── 3. waitlist LIVE SHAPE vs 0074 ─────────────────────────────────────────────────────────
    const cols = await client.query<{ column_name: string; data_type: string; is_nullable: string }>(
      `select column_name, data_type, is_nullable
         from information_schema.columns
        where table_schema = 'public' and table_name = 'waitlist'
        order by ordinal_position`,
    );
    process.stdout.write('\npublic.waitlist live shape:\n');
    if (cols.rows.length === 0) {
      process.stdout.write('  (table does not exist — 0074 would create it)\n');
    } else {
      for (const c of cols.rows) {
        process.stdout.write(`  ${c.column_name.padEnd(16)}${c.data_type}${c.is_nullable === 'NO' ? ' NOT NULL' : ''}\n`);
      }
      const live = cols.rows.map((c) => c.column_name);
      const missing = WAITLIST_COLUMNS.filter((c) => !live.includes(c));
      const extra = live.filter((c) => !WAITLIST_COLUMNS.includes(c));
      if (missing.length > 0) problems.push(`waitlist is missing column(s) 0074 declares: ${missing.join(', ')}`);
      if (extra.length > 0) {
        // THE DRIFT CASE 0074's own comment warns about: `create table if not exists` cannot
        // correct a shape that has moved, and would silently accept this.
        problems.push(`waitlist has column(s) 0074 does not declare: ${extra.join(', ')} — 0074 would NOT reconcile these`);
      }

      const policies = await client.query<{ policyname: string }>(
        "select policyname from pg_policies where schemaname = 'public' and tablename = 'waitlist' order by policyname",
      );
      const live_policies = policies.rows.map((r) => r.policyname);
      process.stdout.write(`  policies: ${live_policies.join(' | ') || '(none)'}\n`);
      for (const p of WAITLIST_POLICIES) {
        if (!live_policies.includes(p)) problems.push(`waitlist is missing the policy 0074 declares: "${p}"`);
      }
    }
  } finally {
    await client.end();
  }

  if (problems.length > 0) {
    process.stderr.write('\n[db:precheck] REFUSED — the database is not in the expected state:\n');
    for (const p of problems) process.stderr.write(`  - ${p}\n`);
    fail('stop and report. Do not adjust the plan to fit an unexpected database.', 2);
  }
  process.stdout.write('\n[db:precheck] everything as expected.\n');
}

try {
  await main();
} catch (error) {
  if (error instanceof WhoamiConnectionError) fail(error.message, 1);
  if (error instanceof TargetRefusal) fail(`REFUSED: ${error.message}`, 2);
  throw error;
}
