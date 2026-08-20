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
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Client } from 'pg';

import { authorizeMigrationTarget, redactUrl } from './apply-migration-target-guard';
import { resolveTarget } from './lib/migration-target-guard';
import { checksumOfSql } from '../src/lib/effectiveMigration';

function fail(message: string): never {
  console.error(`
[revert] ${message}
`);
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
 * THE REVERT FILES THIS RUNNER MAY EXECUTE, pinned by content.
 *
 * This replaced a hand-written SQL lexer, and the reason is worth keeping. The
 * runner used to try to PROVE, by parsing, that an arbitrary file was one
 * transaction and nothing else. Four consecutive review rounds each found a
 * different way past it: a statement after COMMIT, an indented ROLLBACK, ABORT
 * and END as synonyms, an apostrophe inside a double-quoted identifier, a
 * non-ASCII dollar-quote tag, BEGIN ATOMIC routine bodies. That is not a run of
 * bad luck; statically validating arbitrary SQL needs a real parser, and a
 * safety check that is itself a homemade parser is a liability on a T0 rollback
 * path.
 *
 * So the runner no longer asks what the file MEANS. It asks whether the file is
 * one a human reviewed and pinned. Content that does not match its pin is
 * refused before a connection is even opened, which makes every lexical edge
 * case irrelevant: a file the reviewers read cannot change under them, and a
 * file they never read cannot run at all.
 *
 * Adding an entry is deliberately a code change, so it goes through review.
 *
 * NORMALISED (CRLF folded, trailing whitespace trimmed) rather than raw bytes,
 * using the repository's own `checksumOfSql`: this checkout is `core.autocrlf`,
 * so a raw-byte pin would match on the machine that wrote it and fail on every
 * fresh clone - a guard nobody can satisfy is a guard that gets deleted. Any
 * change to the file's CONTENT, down to one byte, still fails it.
 */
const PINNED_REVERTS: Record<string, string> = {
  'revert-0064-transaction.sql':
    '8d3f2c92a88d971882c6aeb41e40ed33f84910aea0f22ee6294ff208cef73962',
};

/** The migration number a revert file undoes, from its name. */
const REVERT_NAME = /^revert-(\d{4})-transaction\.sql$/;
/** The migration checksum a revert file pins in its own preconditions. */
const PINNED_MIGRATION = /AND\s+checksum\s*=\s*'([0-9a-f]{64})'/i;

/**
 * Both checksums, checked BEFORE any connection is opened.
 *
 * Two different questions. The revert pin answers 'is this the file that was
 * reviewed?'. The migration pin answers 'does this revert still describe the
 * migration it claims to undo?' - the revert refuses in-database on that same
 * value, but finding out here means an operator learns it before a connection
 * rather than from an aborted transaction.
 */
export function checkPinned(
  fileName: string,
  revertSql: string,
  readMigration: (name: string) => string | null,
  // Injectable ONLY so the migration-pin branch can be tested without
  // mutating the shipped map. Callers use the default.
  pins: Record<string, string> = PINNED_REVERTS,
): string | null {
  const pinned = pins[fileName];
  if (pinned === undefined) {
    return `${fileName} is not a pinned revert file. Every file this runner executes is `
      + 'pinned by content in PINNED_REVERTS, so adding one is a reviewed code change. '
      + 'Run an unpinned revert with psql, having verified the target yourself.';
  }
  const actual = checksumOfSql(revertSql);
  if (actual !== pinned) {
    return `${fileName} does not match its pinned content (pinned ${pinned.slice(0, 16)}…, `
      + `found ${actual.slice(0, 16)}…). It has been edited since it was reviewed; re-read it, `
      + 'then update the pin in the same commit.';
  }

  const number = REVERT_NAME.exec(fileName)?.[1];
  if (number === undefined) return `${fileName} is not a revert-NNNN-transaction.sql name`;
  const migrationPin = PINNED_MIGRATION.exec(revertSql)?.[1];
  if (migrationPin === undefined) {
    return `${fileName} pins no migration checksum, so it cannot prove which migration it undoes`;
  }
  const migrationSql = readMigration(number);
  if (migrationSql === null) {
    return `no migration file numbered ${number} was found for ${fileName}`;
  }
  const migrationActual = checksumOfSql(migrationSql);
  if (migrationActual !== migrationPin) {
    return `${fileName} pins migration checksum ${migrationPin.slice(0, 16)}… but ${number} `
      + `checksums to ${migrationActual.slice(0, 16)}…, so this revert no longer describes it`;
  }
  return null;
}

/** Reads the migration numbered `number`, or null when there is none. */
function migrationByNumber(number: string): string | null {
  const dir = resolve(process.cwd(), 'supabase', 'migrations');
  const found = readdirSync(dir).find((n) => n.startsWith(`${number}_`) && n.endsWith('.sql'));
  return found ? readFileSync(join(dir, found), 'utf8') : null;
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
  // BEFORE the connection, deliberately: a file that is not the reviewed one
  // should never reach a database at all, not even to be refused by its own
  // preconditions.
  const pinProblem = checkPinned(basename(path), sql, migrationByNumber);
  if (pinProblem !== null) fail(`refusing ${path}: ${pinProblem}`);
  console.log(`[revert] pinned   : content and migration checksums verified before connecting`);

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

    // NO timeouts are set here, deliberately. The file owns its transaction, so
    // a SET LOCAL from out here belongs to no transaction and is discarded; and a
    // session-level SET would LEAK onto the Supabase pooler's pinned backend for
    // whatever session is assigned it next, besides not being reliably inherited
    // in transaction mode. Both were review findings against an earlier version of
    // this file. The bounds live inside the revert transaction instead, which is
    // the only scope that can hold them.
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
