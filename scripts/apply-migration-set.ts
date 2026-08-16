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
 * Checksums are sha256 of each file's RAW BYTES, which is the convention the
 * existing ledger already uses (verified against 0044's recorded row).
 *
 * Usage:
 *   npx tsx scripts/apply-migration-set.ts --env staging 0044_x.sql 0045_y.sql
 *   npx tsx scripts/apply-migration-set.ts --secrets-file .env.production.local \
 *     --env production --execute 0044_x.sql ...
 *
 * --secrets-file loads a target's credentials WITHOUT touching .env.local, so the
 * repo stays pointed at staging for every other tool.
 */

import { config as loadEnv } from 'dotenv';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';

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

function redactUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.username}:***@${parsed.host}${parsed.pathname}`;
  } catch {
    return '<invalid url>';
  }
}

async function main(): Promise<void> {
  const { env, execute, files, secretsFile } = parseArgs(process.argv.slice(2));

  // A separate --secrets-file is how you reach a NON-default target without editing
  // .env.local. Repointing .env.local at production is the obvious workaround
  // and it is a trap: it silently redirects every other tool in the repo,
  // including the live RLS suite, and it stays repointed until someone
  // remembers to undo it. One command, one file, no lingering state.
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
    loadEnv({ path: secretsFile, override: true });
  }
  loadEnv({ path: '.env.local' });
  loadEnv({ path: '.env' });

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) fail('DATABASE_URL is not set');

  const actualEnv = process.env.NEXT_BAR_DATABASE_ENVIRONMENT;
  if (!actualEnv) {
    fail('NEXT_BAR_DATABASE_ENVIRONMENT is not set, so the target cannot be identified');
  }
  if (actualEnv !== env) {
    fail(
      `you named --env ${JSON.stringify(env)} but the loaded environment is `
      + `${JSON.stringify(actualEnv)}. The connection string cannot tell these apart; `
      + 'the label is the only thing that can.',
    );
  }

  // Read and hash first: a missing or unreadable file must stop us before we
  // open a transaction on anything.
  const planned = files.map((name) => {
    let raw: Buffer;
    try {
      raw = readFileSync(join(MIGRATIONS_DIR, name));
    } catch (error) {
      return fail(`cannot read ${name}: ${(error as Error).message}`);
    }
    return { name, raw, checksum: createHash('sha256').update(raw).digest('hex') };
  });

  const client = new Client({ connectionString: databaseUrl });
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

    console.log(`\n[apply-set] target   : ${redactUrl(databaseUrl)}`);
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

    await client.query('BEGIN');
    try {
      for (const entry of planned) {
        process.stdout.write(`  applying ${entry.name} ... `);
        await client.query(entry.raw.toString('utf8'));
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
