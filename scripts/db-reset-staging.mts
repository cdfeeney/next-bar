/**
 * db:reset-staging — THE ONLY SANCTIONED WAY TO EMPTY THE STAGING DATABASE.
 *
 * WHY IT EXISTS. On 2026-08-28 a session emptied staging with five ad-hoc statements in a throwaway
 * script, took no pre-count, took no dump, asked nobody, and deleted the script afterwards so even
 * the timestamp had to be reconstructed from file mtimes. Nine accounts were lost on a free-tier
 * project with no vendor backups and no PITR. Staging is disposable BY CONSTRUCTION — rebuilt from
 * git plus a production dump — but disposable is a property of the REBUILD PATH, not a licence to
 * destroy without one. This is that path.
 *
 * The five statements it runs in step 3 are the same five from the incident. That is deliberate:
 * they were never the problem. What was missing is everything around them, and it is now
 * unavoidable rather than remembered — the identity check, the pre-count, the dump, the named
 * consent, and a rebuild that puts the data back.
 *
 * THE INCIDENT RULE IS SATISFIED BY CONSTRUCTION, not by discipline: step 1's output IS the
 * read-only pre-count and step 2's output IS the dump path, and both are printed before step 3 can
 * run. There is no ordering in which a destructive statement executes before its evidence exists.
 *
 * ONE CERTIFICATION, ONE CONNECTION. Steps 1 and 2 used to run in CHILD PROCESSES — `db-whoami.mts`
 * and `db-dump.mts` — whose answers came back as text, after which this script re-read the secrets
 * file to build the client that ran the five statements. Round 4 (CRITICAL): those are two
 * independent resolutions of a mutable file, so the pre-count and the dump could describe staging
 * while the destructive connection went somewhere else. Everything now happens in this process
 * against the single `CertifiedTarget` that step 1 produced, and step 3 connects with that exact
 * string. There is no re-read left to disagree with.
 *
 * PRODUCTION IS REFUSED AT STEP 1 REGARDLESS OF CONSENT. `HARNESS_DB_WRITE_OK` set to the
 * production ref does not unlock this script — a tool whose entire purpose is to empty a database
 * must not be pointable at the one holding the only surviving data. Consent is necessary here, not
 * sufficient.
 *
 * Usage:
 *   npm run db:reset-staging                        # DRY RUN — prints the plan, touches nothing
 *   npm run db:reset-staging -- --secrets-file <p>  # a target other than the .env.local default
 *   HARNESS_DB_WRITE_OK=<staging-ref> npm run db:reset-staging -- --execute
 *
 * Exit codes: 0 planned or completed · 1 a step failed · 2 refused (identity, consent, or target)
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import pg from 'pg';

import { readClassification } from './lib/classification';
import { dumpDatabase, DumpFailure, DumpRefusal, formatDumpSummary } from './lib/dbDump';
import { TargetRefusal } from './lib/migration-target-guard';
import { certify, readCounts, WhoamiConnectionError } from './lib/whoami';

const BACKUPS = 'D:\\harness-handoffs\\db-backups';

function fail(message: string, code: number): never {
  process.stderr.write(`[db:reset-staging] ${message}\n`);
  process.exit(code);
}

function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] ?? '' : null;
}

const EXECUTE = process.argv.includes('--execute');
const secretsFile = arg('--secrets-file');

/**
 * THE OPERATOR'S CONSENT, SNAPSHOTTED BEFORE ANY FILE IS LOADED.
 *
 * Round 5, HIGH, and a regression this file introduced: identifying the target IN-PROCESS means
 * `whoami()` loads the `--secrets-file` with `override: true` into THIS process's environment. Read
 * afterwards, `process.env.HARNESS_DB_WRITE_OK` could therefore be supplied by the very file naming
 * the target — so a secrets file could grant the per-act consent the operator is supposed to type,
 * for the one script that empties a database. The child process that used to do this contained the
 * mutation; nothing does now, so the value is captured at module load instead, which runs before
 * `main()` and before any dotenv call.
 *
 * Consent is necessary and never sufficient: the production refusal and the staging-label rule
 * below do not consult it at all.
 */
const SHELL_WRITE_CONSENT = (process.env.HARNESS_DB_WRITE_OK ?? '').trim().toLowerCase();

function step(n: number, title: string): void {
  process.stdout.write(`\n=== STEP ${n}: ${title} ===\n`);
}

/** The exact five statements from the incident — now behind every gate they lacked. */
const RESET_STATEMENTS = [
  'drop schema if exists public cascade',
  'create schema public',
  'grant usage on schema public to postgres, anon, authenticated, service_role',
  'grant all on schema public to postgres, service_role',
  'delete from auth.users',
];

/** The newest production dump in the backups directory. */
function latestProdDump(productionRef: string): string | null {
  if (!existsSync(BACKUPS)) return null;
  const candidates = readdirSync(BACKUPS)
    .filter((f) => f.startsWith(`${productionRef}-`) && f.endsWith('.json'))
    .sort();
  return candidates.length > 0 ? path.join(BACKUPS, candidates[candidates.length - 1]) : null;
}

async function main(): Promise<void> {
  // BEFORE ANYTHING ELSE, INCLUDING THE CONNECTION. A pure file read, so an incoherent
  // classification is caught without a database — which is also what makes the rule testable. It
  // sat after step 1 and was therefore only reachable when a database happened to answer.
  //
  // THE SHARED READER, not a private copy. This script had its own, and its own copy carried the
  // round-2 defect in its worst possible location: `if (productionRef && ...)` meant an ABSENT
  // NEXT_BAR_PRODUCTION_PROJECT_REF silently disabled the production refusal below — in the one
  // tool whose whole purpose is to empty a database. readClassification() makes the declaration
  // mandatory and refuses a ref that appears in two lists.
  let productionRef: string;
  try {
    productionRef = readClassification().productionRef as string;
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error), 2);
  }

  // ── STEP 1 ────────────────────────────────────────────────────────────────────────────────────
  step(1, 'identify the target (read-only) — this output IS the mandatory pre-count');

  // CERTIFY FIRST, WITHOUT A SOCKET. Every refusal below — production, label, consent — is decided
  // before this script connects to anything, because authorization to destroy is not a question you
  // should need a live database to answer. It also makes those rules testable without one, which is
  // how a round-5 regression in the consent rule reached a review instead of a test.
  const identity = await certify(secretsFile);
  if (identity.refusals.length > 0) {
    for (const reason of identity.refusals) process.stderr.write(`[db:reset-staging] ${reason}\n`);
    fail('db:whoami refused — nothing is emptied against an unidentified database', 2);
  }
  const { certified } = identity;
  const ref = identity.ref;
  const label = identity.label;

  // THE REFUSAL THAT CANNOT BE OVERRIDDEN. Consent is necessary, never sufficient: a tool for
  // emptying a database must not be pointable at the one holding the only surviving data.
  if (ref === productionRef) {
    fail(
      `REFUSED: ${ref} is the PRODUCTION project (NEXT_BAR_PRODUCTION_PROJECT_REF). This script `
      + 'empties a database and will not run against production under any circumstances — '
      + 'HARNESS_DB_WRITE_OK does not unlock it, because consent is necessary here and never '
      + 'sufficient.',
      2,
    );
  }
  if (label !== 'staging') {
    fail(`REFUSED: ${ref} derives the label "${label}", not "staging". Only staging may be reset.`, 2);
  }

  const consent = SHELL_WRITE_CONSENT;
  if (EXECUTE && consent !== ref) {
    fail(
      consent
        ? `REFUSED: HARNESS_DB_WRITE_OK is "${consent}" but the target is ${ref}. Consent names the project it applies to.`
        : `REFUSED: --execute requires HARNESS_DB_WRITE_OK=${ref} in the shell. The operator types it, per act.`,
      2,
    );
  }

  // THE PRE-COUNT, now that the target is authorized. It is still printed before anything is
  // destroyed — step 3 is below — and it is still the evidence the incident rules demand.
  const counted = await readCounts(identity);
  process.stdout.write(`${counted.line}\n`);
  if (counted.refusals.length > 0) {
    for (const reason of counted.refusals) process.stderr.write(`[db:reset-staging] ${reason}\n`);
    fail('the target could not be read — nothing is emptied on a pre-count that failed', 1);
  }

  // ── STEP 2 ────────────────────────────────────────────────────────────────────────────────────
  step(2, 'dump the target before touching it — free, and it is the rule');
  let dumpPath = '(dry run — no dump taken)';
  if (EXECUTE) {
    // The SAME certified target step 1 identified. Not a child process, not a second read.
    try {
      const dumped = await dumpDatabase(certified, BACKUPS);
      process.stdout.write(formatDumpSummary(dumped));
      dumpPath = dumped.outFile;
    } catch (error) {
      if (error instanceof DumpRefusal) fail(error.message, 2);
      if (error instanceof DumpFailure) fail(error.message, 1);
      throw error;
    }
  } else {
    process.stdout.write(`would dump ${ref} into: ${BACKUPS}\\${ref}-<ISO>.json\n`);
  }

  // ── STEP 3 ────────────────────────────────────────────────────────────────────────────────────
  step(3, 'empty the schema — the five statements from the incident');
  for (const sql of RESET_STATEMENTS) process.stdout.write(`  ${sql};\n`);

  // ── STEP 4 ────────────────────────────────────────────────────────────────────────────────────
  step(4, 'bootstrap the full migration chain (this is B3)');
  const migrationsDir = path.join(process.cwd(), 'supabase', 'migrations');
  const files = existsSync(migrationsDir)
    ? readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()
    : [];
  const highest = files.length > 0 ? files[files.length - 1] : '(none found)';
  process.stdout.write(`  ${files.length} migrations present, ending at ${highest}\n`);
  process.stdout.write('  each must land a ledger row in public.schema_migrations\n');

  // ── STEP 5 ────────────────────────────────────────────────────────────────────────────────────
  step(5, 'load the latest production dump, sanitized');
  const dump = latestProdDump(productionRef);
  if (!dump) {
    fail(`no production dump found in ${BACKUPS} for ref ${productionRef} — run npm run db:dump first`, 2);
  }
  process.stdout.write(`  source: ${dump}\n`);
  const parsed = JSON.parse(readFileSync(dump, 'utf8')) as {
    ref: string; taken_at: string; tables: Record<string, Record<string, unknown>[]>;
  };
  process.stdout.write(`  taken_at: ${parsed.taken_at}\n`);
  process.stdout.write('  emails rewritten to user-<n>@example.invalid; encrypted_password KEPT, so\n');
  process.stdout.write('  test logins work with the real passwords; ids preserved; all else verbatim\n');
  const nonEmpty = Object.entries(parsed.tables).filter(([, rows]) => rows.length > 0)
    .sort((a, b) => b[1].length - a[1].length);
  for (const [name, rows] of nonEmpty) {
    process.stdout.write(`    ${name.padEnd(34)}${rows.length}\n`);
  }

  // ── STEP 6 ────────────────────────────────────────────────────────────────────────────────────
  step(6, 'identify the target again — proof of what was rebuilt');
  process.stdout.write('  npm run db:whoami\n');

  if (!EXECUTE) {
    process.stdout.write(
      `\nDRY RUN — nothing was written. Pre-count above is step 1; the dump would be step 2.\n`
      + `To execute:  HARNESS_DB_WRITE_OK=${ref} npm run db:reset-staging -- --execute`
      + `${secretsFile ? ` --secrets-file ${secretsFile}` : ''}\n`,
    );
    return;
  }

  // ── EXECUTION ─────────────────────────────────────────────────────────────────────────────────
  // THE CERTIFIED STRING. No dotenv reload here: this script used to re-read the secrets file at
  // this exact point, which meant the five statements below could run against a target nothing had
  // certified — the evidence above describing one project and the socket opening on another.
  const client = new pg.Client({ connectionString: certified.connectionString });
  await client.connect();
  try {
    process.stdout.write(`\nexecuting against ${ref} (dump at ${dumpPath})\n`);
    for (const sql of RESET_STATEMENTS) {
      await client.query(sql);
      process.stdout.write(`  ok: ${sql}\n`);
    }
  } finally {
    await client.end();
  }
  process.stdout.write(
    '\nSchema emptied. Steps 4-6 are not yet automated: run the bootstrap, then the sanitized\n'
    + 'load, then db:whoami, and paste each result.\n',
  );
}

try {
  await main();
} catch (error) {
  if (error instanceof WhoamiConnectionError) fail(error.message, 1);
  if (error instanceof TargetRefusal) fail(`REFUSED: ${error.message}`, 2);
  throw error;
}
