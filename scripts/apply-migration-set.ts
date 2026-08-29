/**
 * apply-migration-set.ts
 *
 * Applies an explicit, ordered SET of migrations to a ledger-bearing database
 * in ONE transaction, writing every `public.schema_migrations` row in that same
 * transaction.
 *
 * WHY THIS EXISTS. The Night Out feature ships as 0044-0051, where later files
 * `create or replace` functions defined in earlier ones. Applied one at a time,
 * the intermediate definitions — including ones known to be defective, which is
 * why the later files exist — go live in sequence on the target, and a failure
 * partway through leaves a half-applied ledger that nobody can safely reason
 * about. Four migration headers instruct the operator to "apply the run in ONE
 * transaction". A cold review pointed out that the instruction was prose with
 * no mechanism behind it. This is the mechanism.
 *
 * WHAT IT REFUSES, and why each refusal is fail-closed:
 *   - Any named migration already present in the target ledger. A partially
 *     applied set is ambiguous, and reconciling it is a human decision, not a
 *     script's. It reports which are present and stops.
 *   - An --env label that does not match NEXT_BAR_DATABASE_ENVIRONMENT in the
 *     loaded env file. Supabase's pooler hostname is shared and the project ref
 *     hides in the username, so a connection string cannot be read to tell
 *     staging from production. The label is the only thing that can, so naming
 *     the target is mandatory rather than inferred.
 *   - Anything at all without --execute. Dry-run is the default.
 *
 * Checksums come from checksumOfSql() in src/lib/effectiveMigration.ts, so this
 * script and the live provenance test in src/lib/nightOutsRls.live.test.ts
 * cannot disagree about what a ledger row means.
 *
 * It hashes the EXACT buffer this script is about to execute, never a second
 * read of the same path. A file-taking helper was tried first and was wrong: its
 * directory is resolved from the module's own location while `raw` below comes
 * from process.cwd(), so invoking this script by path from another checkout
 * executed one file and recorded the other's checksum — and even in one
 * checkout, a second read is a second snapshot (round-4 review, Codex HIGH).
 *
 * This header used to claim RAW BYTES, "verified against 0044's recorded row".
 * That was wrong, and 0044's row is what disproves it: the ledger holds the
 * NORMALISED hash (3514e43e...), not the raw one (5578e1af...). Read from the
 * serving staging ledger 2026-08-19: raw matched 0 of the 35 rows whose file
 * exists on this branch, normalised matched all 35. Applying through the old
 * code would have written rows the provenance gate then rejected as DRIFTED
 * (round-3 review, Claude, medium).
 *
 * Usage:
 *   npx tsx scripts/apply-migration-set.ts --env staging 0044_x.sql 0045_y.sql
 *   npx tsx scripts/apply-migration-set.ts --secrets-file .env.production.local \
 *     --env production --execute 0044_x.sql ...
 *
 * --secrets-file loads a target's credentials WITHOUT touching .env.local, so the
 * repo stays pointed at staging for every other tool.
 *
 * TLS: the connection must be encrypted AND the pooler's certificate verified.
 * Supabase's pooler presents a SELF-SIGNED chain, so verification needs their CA
 * (dashboard - Settings - Database - SSL configuration; one download, kept out of
 * the repo). Point PGSSLROOTCERT at that file. NAMING sslrootcert IN DATABASE_URL IS NOW
 * REFUSED: pg re-reads that file when it builds the client, after this tool has already
 * authorized a different read of it, so the CA that was checked and the CA that authenticates
 * can differ. PGSSLROOTCERT is read once here and travels as bytes. Without a CA this tool
 * refuses rather than falling back to an unauthenticated channel: every other link
 * in the target check is a string the operator wrote, and the certificate is the
 * only thing that proves the peer answering that hostname is really Supabase.
 */

import { config as loadEnv, parse as parseEnv } from 'dotenv';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { authorizeMigrationTarget, redactUrl } from './apply-migration-target-guard';

import { checksumOfSql, normalisedSql } from '../src/lib/effectiveMigration';

import { resolveTarget, TargetRefusal, type CertifiedTarget } from './lib/migration-target-guard';
import { readClassification } from './lib/classification';

const MIGRATIONS_DIR = join(process.cwd(), 'supabase', 'migrations');

function fail(message: string): never {
  console.error(`\n[apply-set] REFUSING: ${message}\n`);
  process.exit(1);
}

function parseArgs(argv: string[]): {
  env: string; execute: boolean; files: string[]; secretsFile: string | null;
} {
  let env = '';
  let execute = false;
  let secretsFile: string | null = null;
  const files: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--execute') execute = true;
    else if (arg === '--dry-run') execute = false;
    else if (arg === '--env') {
      i += 1;
      env = argv[i] ?? '';
    } else if (arg === '--secrets-file') {
      i += 1;
      secretsFile = argv[i] ?? '';
    } else if (arg.startsWith('--')) fail(`unknown option ${arg}`);
    else files.push(arg);
  }
  if (!env) fail('--env <label> is required; the target must be named, never inferred');
  if (files.length === 0) fail('name at least one migration file');
  return { env, execute, files, secretsFile };
}


async function main(): Promise<void> {
  const { env, execute, files, secretsFile } = parseArgs(process.argv.slice(2));

  // Snapshot BEFORE any dotenv load. dotenv defaults to override:false, so a
  // DATABASE_URL exported in the shell survives every load below and is
  // indistinguishable afterwards from one a file supplied — which is exactly
  // how a production connection string pairs with .env.local's staging label.
  const shellDatabaseUrl = process.env.DATABASE_URL;
  // The LABEL is snapshotted for the same reason, and one more: a --secrets-file loads with
  // override:true, so a label in that file REPLACES one exported in the shell. Without this, a
  // human who exports a contradicting label is silently corrected instead of refused.
  const shellDeclaredEnv = process.env.NEXT_BAR_DATABASE_ENVIRONMENT;

  // A separate --secrets-file is how you reach a NON-default target without editing
  // .env.local. Repointing .env.local at production is the obvious workaround
  // and it is a trap: it silently redirects every other tool in the repo,
  // including the live RLS suite, and it stays repointed until someone
  // remembers to undo it. One command, one file, no lingering state.
  let secretsParsed: Record<string, string> | undefined;
  if (secretsFile !== null) {
    if (secretsFile === '') fail('--secrets-file needs a path');
    // NOTE: this option is deliberately NOT called --env-file. That name is a
    // reserved Node flag; node consumes it before the script is reached, and
    // the failure looks like a missing file rather than an option collision.
    // Check existence ourselves: dotenv does not reliably surface a missing
    // file as an error, so a typo'd path would silently fall through to
    // .env.local and point this at whatever THAT names. A guard that does not
    // guard is worse than no guard, because it is trusted.
    if (!existsSync(secretsFile)) fail(`--secrets-file ${secretsFile} does not exist`);
    secretsParsed = loadEnv({ path: secretsFile, override: true }).parsed;
  }
  loadEnv({ path: '.env.local' });
  loadEnv({ path: '.env' });

  // TWO different questions, both mandatory, in THIS order — and the order is load-bearing.
  //
  // FIRST: is this endpoint safe to talk to at all? authorizeMigrationTarget refuses a non-pooler
  // endpoint, a connection carrying startup options, disabled TLS, sslmode/ssl=no-verify, a missing
  // or dropped pooler CA, NODE_TLS_REJECT_UNAUTHORIZED=0, and a DATABASE_URL pointing at the
  // production ref under a staging run. Those are properties of the CHANNEL and they hold whatever
  // project is on the other end.
  //
  // SECOND: which project is it, and is that the one the operator asked for? resolveTarget derives
  // the label from the project REF (operator-set lists in the repo-root .env.local) and refuses a
  // mismatched URL/API pair, an unclassified project, a label that contradicts the ref, and an
  // --env that disagrees with the derived label.
  //
  // SECURITY LAYER FIRST, CLASSIFICATION SECOND. Reversed, an unclassified project short-circuits
  // with "unknown project" and the operator never learns their connection had TLS verification off
  // — the more dangerous fact, hidden behind the more procedural one. Measured: reversing this
  // order turned 11 channel-security refusals into classification refusals.
  const authorized = authorizeMigrationTarget(env);
  if (authorized.refusal !== null) fail(authorized.refusal);
  const { clientConfig, effective, env: actualEnv } = authorized.target;

  let certified: CertifiedTarget;
  try {
    certified = resolveTarget({
      env,
      shellDatabaseUrl,
      shellDeclaredEnv,
      databaseUrl: process.env.DATABASE_URL,
      apiUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
      actualEnv: process.env.NEXT_BAR_DATABASE_ENVIRONMENT,
      // Read from the repo-root .env.local FILE, never process.env: a --secrets-file must not be
      // able to supply or shadow the operator's classification of which project is which.
      classification: readClassification(),
    });
  } catch (error) {
    if (error instanceof TargetRefusal) fail(error.message);
    throw error;
  }

  // THE TWO LAYERS MUST BE TALKING ABOUT THE SAME CONNECTION. They read process.env.DATABASE_URL
  // independently, one before the other, so this is the seam where a value that changed between
  // them would go unnoticed — the round-4 defect, stated as an assertion instead of a hope. The
  // connection below is opened from the CERTIFIED string with the authorized TLS settings.
  if (clientConfig.connectionString !== certified.connectionString) {
    fail(
      'DATABASE_URL changed between the channel check and the target certification, so neither '
      + 'result describes the connection that would be opened',
    );
  }
  const databaseUrl = certified.connectionString;

  // Read and hash first: a missing or unreadable file must stop us before we
  // open a transaction on anything.
  const planned = files.map((name) => {
    let raw: Buffer;
    try {
      raw = readFileSync(join(MIGRATIONS_DIR, name));
    } catch (error) {
      return fail(`cannot read ${name}: ${(error as Error).message}`);
    }
    // ONE string: what gets executed is exactly what the checksum describes.
    // Hashing normalised text while executing the raw buffer meant that on a
    // CRLF checkout the ledger row described LF while the server stored CRLF,
    // and the applied-versus-committed body comparison in
    // nightOutsRls.live.test.ts would fail for anything applied here
    // (round-9 review, Claude, medium).
    const sql = normalisedSql(raw.toString('utf8'));
    return { name, raw, sql, checksum: checksumOfSql(sql) };
  });

  const client = new Client(clientConfig);
  await client.connect();
  try {
    const { rows: ledgerRows } = await client.query(
      'select name from public.schema_migrations where name = any($1::text[])',
      [planned.map((entry) => entry.name)],
    );
    if (ledgerRows.length > 0) {
      fail(
        `${ledgerRows.length} of ${planned.length} are already in the target ledger: `
        + `${ledgerRows.map((row) => row.name as string).join(', ')}. `
        + 'A partially applied set is a human decision, not a script\'s.',
      );
    }
    const { rows: head } = await client.query(
      'select name from public.schema_migrations order by name desc limit 1',
    );
    const ledgerHead = (head[0]?.name as string) ?? '(empty ledger)';
    for (const entry of planned) {
      if (entry.name <= ledgerHead) {
        fail(`${entry.name} does not sort above the ledger head ${ledgerHead}`);
      }
    }

    // The set must be given in LEXICAL ORDER, and this is not a nicety.
    // Later files `create or replace` functions defined in earlier ones, so
    // applying them out of order records every checksum while leaving an
    // OBSOLETE definition live — the precise failure this tool exists to
    // prevent, arrived at by a different route (cold panel, Codex, HIGH).
    // Sorting the list silently would be worse: the caller's stated order is
    // the thing being checked, and quietly correcting it hides a mistake in
    // whatever produced the list.
    const sorted = [...planned].map((e) => e.name).sort();
    const given = planned.map((e) => e.name);
    for (let i = 0; i < given.length; i += 1) {
      if (given[i] !== sorted[i]) {
        fail(
          'the set is not in lexical order, so a later file could be applied '
          + `before one it supersedes. Given: ${given.join(', ')}. `
          + `Expected: ${sorted.join(', ')}.`,
        );
      }
    }

    console.log(`\n[apply-set] target   : ${redactUrl(databaseUrl)}`);
    console.log(`[apply-set] effective: ${effective.user}@${effective.host}:${effective.port} (pg's own resolution)`);
    console.log('[apply-set] tls      : on, peer certificate verified');
    console.log(`[apply-set] env      : ${actualEnv}`);
    console.log(`[apply-set] head     : ${ledgerHead}`);
    console.log(`[apply-set] mode     : ${execute ? 'EXECUTE (one transaction)' : 'DRY RUN — nothing will be written'}`);
    console.log('[apply-set] plan     :');
    for (const entry of planned) {
      console.log(`  ${entry.name}  sha256 ${entry.checksum.slice(0, 16)}…  ${entry.raw.length} bytes`);
    }
    console.log('\n[apply-set] revert   :');
    console.log(
      `  delete from public.schema_migrations where name in (${planned
        .map((entry) => `'${entry.name}'`)
        .join(', ')});`,
    );
    console.log('  ...plus re-running the prior definitions of any function these replace.\n');

    if (!execute) {
      console.log('[apply-set] dry run complete. Re-run with --execute to apply.\n');
      return;
    }

    // READ WRITE explicitly, because `BEGIN` alone inherits
    // `default_transaction_read_only`, and Supabase's transaction pooler hands
    // out a PINNED backend whose session carries that setting on: measured
    // 2026-08-19 against the staging pooler, six fresh connections all landed
    // on backend pid 1879957 with `default_transaction_read_only=on`
    // (source=session — no role or database setting says so, and the 14 MB
    // database is nowhere near the disk-full lockdown that would). Without this
    // the first DDL dies with 25006 "cannot execute ... in a read-only
    // transaction" and the operator reads it as a broken migration.
    //
    // This bypasses NOTHING that grants access. `default_transaction_read_only`
    // is a soft default any session may override, not a privilege: a role that
    // actually lacks write permission still fails on the first statement, RLS
    // still applies, and the real guards on this tool — the named --env, the
    // project-ref allowlist, --execute — are untouched. Scoped to the
    // transaction, so it cannot leak back onto the shared pooler backend the
    // way a session-level SET would.
    await client.query('BEGIN READ WRITE');
    // An unbounded wait holds every lock already taken while the application
    // queues behind it, with no recourse but killing the process. Bounded, a
    // blocked apply aborts and the whole set rolls back.
    await client.query("SET LOCAL lock_timeout = '10s'");
    await client.query("SET LOCAL statement_timeout = '300s'");
    try {
      for (const entry of planned) {
        process.stdout.write(`  applying ${entry.name} ... `);
        await client.query(entry.sql);
        await client.query(
          'insert into public.schema_migrations (name, checksum) values ($1, $2)',
          [entry.name, entry.checksum],
        );
        process.stdout.write('ok\n');
      }
      await client.query('COMMIT');
      console.log(`\n[apply-set] committed ${planned.length} migrations as one transaction.\n`);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      console.error(`\n[apply-set] FAILED — the whole set was rolled back. Nothing was applied.`);
      console.error(`  ${(error as Error).message}\n`);
      process.exitCode = 1;
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
