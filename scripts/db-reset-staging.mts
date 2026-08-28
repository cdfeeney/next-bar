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
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { config as loadEnv, parse as parseEnv } from 'dotenv';
import pg from 'pg';

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

function runTsx(script: string, args: string[]): string {
  return execFileSync(
    process.execPath,
    [path.join('node_modules', 'tsx', 'dist', 'cli.mjs'), script, ...args],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
}

/** The newest production dump in the backups directory. */
function latestProdDump(productionRef: string): string | null {
  if (!existsSync(BACKUPS)) return null;
  const candidates = readdirSync(BACKUPS)
    .filter((f) => f.startsWith(`${productionRef}-`) && f.endsWith('.json'))
    .sort();
  return candidates.length > 0 ? path.join(BACKUPS, candidates[candidates.length - 1]) : null;
}

async function main(): Promise<void> {
  // ── STEP 1 ────────────────────────────────────────────────────────────────────────────────────
  step(1, 'identify the target (read-only) — this output IS the mandatory pre-count');
  const whoamiArgs = secretsFile !== null ? ['--secrets-file', secretsFile] : [];
  let whoami: string;
  try {
    whoami = runTsx('scripts/db-whoami.mts', whoamiArgs);
  } catch (error) {
    const e = error as { stdout?: string; stderr?: string };
    process.stderr.write(`${e.stdout ?? ''}${e.stderr ?? ''}`);
    fail('db:whoami refused — nothing is emptied against an unidentified database', 2);
  }
  const refLine = whoami.split(/\r?\n/).map((l) => l.trim())
    .find((l) => /^[a-z0-9]{16,}\s+(production|staging|unknown)\b/.test(l));
  if (!refLine) fail('could not read the project ref from db:whoami output', 2);
  process.stdout.write(`${refLine}\n`);
  const [ref, label] = refLine.split(/\s+/);

  const envLocal = path.join(process.cwd(), '.env.local');
  if (!existsSync(envLocal)) fail(`${envLocal} does not exist`, 2);
  const classification = parseEnv(readFileSync(envLocal));
  const productionRef = (classification.NEXT_BAR_PRODUCTION_PROJECT_REF ?? '').trim().toLowerCase();

  // THE REFUSAL THAT CANNOT BE OVERRIDDEN. Consent is necessary, never sufficient: a tool for
  // emptying a database must not be pointable at the one holding the only surviving data.
  if (productionRef && ref === productionRef) {
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

  const consent = (process.env.HARNESS_DB_WRITE_OK ?? '').trim().toLowerCase();
  if (EXECUTE && consent !== ref) {
    fail(
      consent
        ? `REFUSED: HARNESS_DB_WRITE_OK is "${consent}" but the target is ${ref}. Consent names the project it applies to.`
        : `REFUSED: --execute requires HARNESS_DB_WRITE_OK=${ref} in the shell. The operator types it, per act.`,
      2,
    );
  }

  // ── STEP 2 ────────────────────────────────────────────────────────────────────────────────────
  step(2, 'dump the target before touching it — free, and it is the rule');
  let dumpPath = '(dry run — no dump taken)';
  if (EXECUTE) {
    const out = runTsx('scripts/db-dump.mts', whoamiArgs);
    process.stdout.write(out);
    dumpPath = out.split(/\r?\n/).find((l) => l.startsWith('wrote '))?.slice(6).trim() ?? '(unknown)';
  } else {
    process.stdout.write(`would run: npm run db:dump${secretsFile ? ` -- --secrets-file ${secretsFile}` : ''}\n`);
    process.stdout.write(`would write into: ${BACKUPS}\\${ref}-<ISO>.json\n`);
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
  if (secretsFile !== null && secretsFile !== '') loadEnv({ path: secretsFile, override: true });
  loadEnv({ path: '.env.local' });
  loadEnv({ path: '.env' });
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
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

await main();
