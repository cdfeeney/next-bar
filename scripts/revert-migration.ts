/**
 * revert-migration.ts — run one revert transaction against a VERIFIED target.
 *
 * WHY THIS EXISTS. `apply-migration-set.ts` proves WHICH DATABASE it is about to
 * write to — same-file URL/label pairing, project ref against the production ref
 * and the staging allowlist, pg's own endpoint resolution, TLS with a verified
 * peer. The rollback path had none of that. It was "paste a connection string
 * into psql", so the only target check on the way back out was whatever the
 * revert SQL could assert about itself from inside the database.
 *
 * That gap is what a round-3 reviewer named: a revert script's preconditions can
 * identify a migration VERSION (its ledger row, its checksum, the shape of the
 * function it is undoing) but they cannot identify the SERVER. A second database
 * carrying the same migration passes every in-SQL check there is. Target
 * identity is a property of the connection, so it has to be enforced where the
 * connection is made — here, by the same module the applier uses, not by a
 * second implementation that can drift from it.
 *
 * WHAT IT DOES NOT DO. It does not wrap the file in a transaction, parse its
 * SQL, or touch `public.schema_migrations` itself. A revert file is authoritative
 * about its own preconditions, its ledger delete and its postconditions, and it
 * must stay runnable verbatim by `psql -f` as documented in
 * supabase/migrations/revert/README.md. This runner only proves the target,
 * refuses anything that is not a single explicit transaction, and hands the file
 * to the server unchanged.
 *
 * Usage:
 *   npx tsx scripts/revert-migration.ts --env staging <revert-file.sql>
 *   npx tsx scripts/revert-migration.ts --env staging --execute <revert-file.sql>
 *
 * Dry run is the default, exactly as it is for the applier.
 */

import { config as loadEnv } from 'dotenv';
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Client } from 'pg';

import { authorizeMigrationTarget, redactUrl } from './apply-migration-target-guard';
import { resolveTarget } from './lib/migration-target-guard';

/** A psql client metacommand. The server rejects these, so a file carrying one is psql-only. */
const METACOMMAND = 92; // '\'
const LOCK_TIMEOUT = '10s';
const STATEMENT_TIMEOUT = '300s';

function fail(message: string): never {
  console.error(`\n[revert] ${message}\n`);
  process.exit(1);
}

function parseArgs(argv: string[]): { env: string; execute: boolean; file: string; secretsFile: string | null } {
  let env = '';
  let execute = false;
  let secretsFile: string | null = null;
  const files: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--execute') execute = true;
    else if (arg === '--env') { i += 1; env = argv[i] ?? ''; }
    else if (arg === '--secrets-file') { i += 1; secretsFile = argv[i] ?? ''; }
    else if (arg.startsWith('--')) fail(`unknown option ${JSON.stringify(arg)}`);
    else files.push(arg);
  }
  if (!env) fail('--env <label> is required; the target must be named, never inferred');
  if (files.length !== 1) fail('give exactly one revert file. Reverts are decided one at a time.');
  return { env, execute, file: files[0], secretsFile };
}

/**
 * The file must be ONE explicit transaction. A revert that half-applies is the
 * split state every revert file in this repository is written to prevent: the
 * ledger row gone while the bodies are still the new ones, or the reverse.
 * `BEGIN READ WRITE` is what the files use, because the Supabase transaction
 * pooler hands out a pinned backend whose session can carry
 * `default_transaction_read_only=on`.
 */
export function checkRevertFile(sql: string): string | null {
  const lines = sql.split(/\r?\n/);
  const meta = lines.findIndex((line) => line.charCodeAt(0) === METACOMMAND);
  if (meta !== -1) {
    return `line ${meta + 1} is a psql metacommand (${JSON.stringify(lines[meta].trim())}), which the `
      + 'server rejects as a syntax error. A revert file must be plain SQL so every client can run it '
      + 'verbatim; put client options on the psql command line instead.';
  }
  if (!/^\s*BEGIN(\s+READ\s+WRITE)?\s*;/m.test(sql)) {
    return 'the file opens no explicit transaction (expected BEGIN READ WRITE;), so a failure part-way '
      + 'through would leave the database and the ledger disagreeing.';
  }
  if (!/^\s*COMMIT\s*;/m.test(sql)) {
    return 'the file never COMMITs, so it is not a single complete transaction.';
  }
  return null;
}

async function main(): Promise<void> {
  const { env, execute, file, secretsFile } = parseArgs(process.argv.slice(2));

  // Snapshot BEFORE any dotenv load, for the same reason the applier does: a
  // DATABASE_URL exported in the shell survives dotenv's override:false and is
  // then indistinguishable from one a file supplied.
  const shellDatabaseUrl = process.env.DATABASE_URL;

  let secretsParsed: Record<string, string> | undefined;
  if (secretsFile !== null) {
    if (secretsFile === '') fail('--secrets-file needs a path');
    if (!existsSync(secretsFile)) fail(`--secrets-file ${secretsFile} does not exist`);
    secretsParsed = loadEnv({ path: secretsFile, override: true }).parsed;
  }
  loadEnv({ path: '.env.local' });
  loadEnv({ path: '.env' });

  // Same two questions the applier asks, in the same order, through the same
  // modules. A second implementation of this is a second thing to keep correct.
  try {
    resolveTarget({
      env,
      secretsFile,
      secretsParsed,
      shellDatabaseUrl,
      databaseUrl: process.env.DATABASE_URL,
      actualEnv: process.env.NEXT_BAR_DATABASE_ENVIRONMENT,
    });
  } catch (error) {
    fail((error as Error).message);
  }

  const { refusal, target } = authorizeMigrationTarget(env);
  if (refusal !== null || target === null) fail(`refusing: ${refusal}`);

  const path = isAbsolute(file) ? file : resolve(process.cwd(), file);
  if (!existsSync(path)) fail(`${path} does not exist`);
  const sql = readFileSync(path, 'utf8');
  const shapeProblem = checkRevertFile(sql);
  if (shapeProblem !== null) fail(`refusing ${path}: ${shapeProblem}`);

  const client = new Client(target.clientConfig);
  await client.connect();
  try {
    const { rows: head } = await client.query(
      'select name from public.schema_migrations order by name desc limit 1',
    );
    console.log(`\n[revert] target   : ${redactUrl(target.clientConfig.connectionString)}`);
    console.log(`[revert] effective: ${target.effective.user}@${target.effective.host}:${target.effective.port} (pg's own resolution)`);
    console.log('[revert] tls      : on, peer certificate verified');
    console.log(`[revert] env      : ${target.env}`);
    console.log(`[revert] ref      : ${target.ref}`);
    console.log(`[revert] head     : ${(head[0]?.name as string) ?? '(empty ledger)'}`);
    console.log(`[revert] file     : ${path}`);
    console.log(`[revert] mode     : ${execute ? 'EXECUTE' : 'DRY RUN — nothing will be written'}`);
    console.log(
      '\n[revert] The file\'s own preconditions decide whether this revert is allowed; they run\n'
      + '         inside its transaction and abort it before any DDL if they refuse.\n',
    );

    if (!execute) {
      console.log('[revert] dry run complete. Re-run with --execute to run the revert.\n');
      return;
    }

    // Session-level, not SET LOCAL: the file owns its own transaction, so a
    // SET LOCAL here would belong to no transaction and be discarded.
    await client.query(`SET lock_timeout = '${LOCK_TIMEOUT}'`);
    await client.query(`SET statement_timeout = '${STATEMENT_TIMEOUT}'`);
    try {
      await client.query(sql);
      console.log('[revert] the revert transaction committed.\n');
    } catch (error) {
      // No ROLLBACK here: the failure aborted the file's own transaction, and
      // issuing one against a connection with no open transaction only muddies
      // the error the operator needs to read.
      console.error('\n[revert] FAILED — the revert transaction did not commit.');
      console.error(`  ${(error as Error).message}\n`);
      process.exitCode = 1;
    }
  } finally {
    await client.end();
  }
}

// Only when RUN, never when imported. Without this the shape guard above cannot
// be unit-tested at all: importing the module would execute main(), reach for
// DATABASE_URL, and exit the test process.
const invokedDirectly = process.argv[1] !== undefined
  && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  main().catch((error) => {
    console.error(`\n[revert] ${(error as Error).message}\n`);
    process.exit(1);
  });
}
