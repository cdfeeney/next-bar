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
 * Strips what SQL says is not code, so the transaction check reads STATEMENTS
 * rather than text. Without this, a `BEGIN` inside a comment or a dollar-quoted
 * function body counts as a transaction. The first version of this file shipped
 * exactly that bug, and a reviewer found it: a file reading BEGIN, COMMIT, then
 * a DELETE passed the check, and the trailing DELETE would have committed on
 * its own — the very ledger/body split the guard claims to prevent.
 */
export function stripNonCode(sql: string): string {
  let out = '';
  let i = 0;
  while (i < sql.length) {
    const rest = sql.slice(i);
    if (rest.startsWith('--')) {
      const nl = sql.indexOf('\n', i);
      i = nl === -1 ? sql.length : nl;
      continue;
    }
    if (rest.startsWith('/*')) {
      // Postgres block comments nest, so a depth counter is required.
      let depth = 1;
      i += 2;
      while (i < sql.length && depth > 0) {
        if (sql.startsWith('/*', i)) { depth += 1; i += 2; } else if (sql.startsWith('*/', i)) { depth -= 1; i += 2; } else i += 1;
      }
      out += ' ';
      continue;
    }
    // An E-prefixed string honours BACKSLASH escapes, so ' does not end it,
    // while an ordinary string ends at the first unpaired quote and treats a
    // backslash as an ordinary character. Reading both the same way ended an
    // E-string early and swallowed the rest of the file, which could wrongly
    // REFUSE a legitimate rollback (round-2 panel, Codex MEDIUM). Fail-closed,
    // but a rollback refused mid-incident is its own hazard.
    const escaped = /^E'/i.test(rest);
    if (escaped || rest.startsWith("'")) {
      i += escaped ? 2 : 1;
      while (i < sql.length) {
        if (escaped && sql[i] === '\\') { i += 2; continue; }
        if (sql[i] === "'" && sql[i + 1] === "'") { i += 2; continue; }
        if (sql[i] === "'") { i += 1; break; }
        i += 1;
      }
      out += " '' ";
      continue;
    }
    // A double-quoted IDENTIFIER is not a string, and an apostrophe inside one
    // is just a character. Skipping this made "a'b" open a phantom string:
    // one such identifier swallowed the file's COMMIT and wrongly refused SQL
    // the server runs fine, and TWO re-synced quote parity while hiding every
    // statement between them - including a ROLLBACK (round-3 panel, both
    // lanes). U&"..." is the same construct with a prefix.
    const identifier = /^(U&)?"/i.exec(rest);
    if (identifier) {
      i += identifier[0].length;
      while (i < sql.length) {
        if (sql[i] === '"' && sql[i + 1] === '"') { i += 2; continue; }
        if (sql[i] === '"') { i += 1; break; }
        i += 1;
      }
      out += ' "" ';
      continue;
    }
    const dollar = /^\$[A-Za-z_0-9]*\$/.exec(rest);
    if (dollar) {
      const tag = dollar[0];
      const close = sql.indexOf(tag, i + tag.length);
      i = close === -1 ? sql.length : close + tag.length;
      out += ' $$ ';
      continue;
    }
    out += sql[i];
    i += 1;
  }
  return out;
}

/**
 * The file must be ONE explicit transaction and nothing else. A revert that
 * half-applies is the split state every revert file in this repository is
 * written to prevent: the ledger row gone while the bodies are still the new
 * ones, or the reverse. Anything after COMMIT would run outside that
 * transaction and commit on its own, which is the same failure wearing a
 * different shape.
 *
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

  const statements = stripNonCode(sql)
    .split(';')
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);

  if (statements.length === 0) return 'the file contains no SQL statements.';

  // AN ALLOWLIST, not a blocklist, and that is the lesson of three rounds.
  // Round 2 found a statement after COMMIT; round 3 found the same hazard
  // wearing whitespace (an indented ROLLBACK); round 3's panel then found it
  // wearing a synonym (ABORT, and END which commits early). Enumerating what
  // must not appear loses that race by construction, because Postgres has more
  // spellings than a reviewer can list. So: exactly one transaction-control
  // statement is permitted at the front, exactly one at the back, and ANY
  // other transaction-control statement anywhere in the file is refused,
  // whatever it is called.
  const TXN_CONTROL = /^(BEGIN|START\s+TRANSACTION|COMMIT|END|ROLLBACK|ABORT|SAVEPOINT|RELEASE|PREPARE\s+TRANSACTION)\b/i;
  const OPENS = /^(BEGIN|START\s+TRANSACTION)\b/i;
  // END is COMMIT's documented synonym, so it is a legitimate closer.
  const CLOSES = /^(COMMIT|END)\b(?!\s*PREPARED)/i;

  if (!OPENS.test(statements[0])) {
    return `the first statement is not BEGIN (${JSON.stringify(statements[0].slice(0, 60))}), so it `
      + 'would run outside the transaction.';
  }
  const last = statements[statements.length - 1];
  if (!CLOSES.test(last)) {
    return `the last statement is not COMMIT (${JSON.stringify(last.slice(0, 60))}), so the file `
      + 'either never commits or commits before its end.';
  }
  if (statements.length < 2) {
    return 'the file opens and closes a transaction with nothing inside it.';
  }

  const stray = statements.slice(1, -1).findIndex((statement) => TXN_CONTROL.test(statement));
  if (stray !== -1) {
    const statement = statements[stray + 1];
    return `statement ${stray + 2} is transaction control `
      + `(${JSON.stringify(statement.slice(0, 40))}), so this file is not one transaction: `
      + 'everything after it commits or rolls back on its own.';
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
