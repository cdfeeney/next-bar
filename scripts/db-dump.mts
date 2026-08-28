/**
 * db:dump — a full JSON snapshot of every table in `auth` and `public`.
 *
 * WHY THIS EXISTS. On 2026-08-28 the staging project was destroyed by a session that took no
 * pre-count and no dump; nine accounts were lost on a free-tier project with no vendor backups. Our
 * own dump is therefore mandatory regardless of what the platform offers, and the rule that came
 * out of that day is: BEFORE ANY DESTRUCTIVE DATABASE ACT — a read-only pre-count, a dump, and the
 * operator's explicit per-act approval.
 *
 * WHAT IT PRESERVES, AND WHY THAT MATTERS. Every column verbatim, including `auth.users.id` and
 * `encrypted_password`. A dump that drops the password hashes is not a restore path — the accounts
 * come back unable to sign in, which is indistinguishable from having lost them. Ids are preserved
 * for the same reason: every foreign key in the database points at them.
 *
 * IT RUNS db:whoami FIRST and prints its output. The question "which database is this" is answered
 * from the project REF before a single row is read, and it lands in the log above the counts, so a
 * dump can never be mistaken later for one taken against a different project.
 *
 * REFUSES TO OVERWRITE. A backup that silently replaces an earlier one is a backup that can destroy
 * evidence, which is the same class of act it exists to protect against.
 *
 * Usage:
 *   npm run db:dump                          # the default target from .env.local
 *   npm run db:dump -- --secrets-file <path> # a different project, without repointing .env.local
 *   npm run db:dump -- --out <dir>           # default D:\harness-handoffs\db-backups
 *
 * Exit codes: 0 written · 1 read/connect failure · 2 refused (identity, or the file already exists)
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { config as loadEnv } from 'dotenv';
import pg from 'pg';

const DEFAULT_OUT = 'D:\\harness-handoffs\\db-backups';

function fail(message: string, code: number): never {
  process.stderr.write(`[db:dump] ${message}\n`);
  process.exit(code);
}

function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] ?? '' : null;
}

async function main(): Promise<void> {
  const secretsFile = arg('--secrets-file');
  const outDir = arg('--out') ?? DEFAULT_OUT;

  // IDENTITY FIRST, ALWAYS. db:whoami derives the label from the project ref and refuses on a
  // contradiction; running it here means no dump is ever taken against a database nobody has
  // identified. Its output is printed verbatim above the counts.
  const whoamiArgs = ['scripts/db-whoami.mts'];
  if (secretsFile !== null) whoamiArgs.push('--secrets-file', secretsFile);
  let whoami: string;
  try {
    whoami = execFileSync(
      process.execPath,
      [path.join('node_modules', 'tsx', 'dist', 'cli.mjs'), ...whoamiArgs],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
  } catch (error) {
    const e = error as { stdout?: string; stderr?: string };
    process.stderr.write(`${e.stdout ?? ''}${e.stderr ?? ''}`);
    fail('db:whoami refused — no dump is taken against an unidentified database', 2);
  }
  process.stdout.write(`--- db:whoami ---\n${whoami.trim()}\n-----------------\n`);
  // dotenvx prints `◇ injected env (...)` banners to STDOUT, so the ref is NOT simply the first
  // token of the first line — taking it that way named a backup file `◇-<stamp>.json` and wrote
  // `◇` as its ref. A backup that cannot identify its own project is precisely the failure this
  // phase exists to prevent, so the ref is matched by SHAPE on the one line that carries it.
  const refLine = whoami.split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => /^[a-z0-9]{16,}\s+(production|staging|unknown)\b/.test(line));
  const ref = refLine?.split(/\s+/)[0];
  if (!ref) fail('could not read the project ref from db:whoami output', 2);

  if (secretsFile !== null) {
    if (secretsFile === '') fail('--secrets-file needs a path', 2);
    if (!existsSync(secretsFile)) fail(`--secrets-file ${secretsFile} does not exist`, 2);
    loadEnv({ path: secretsFile, override: true });
  }
  loadEnv({ path: '.env.local' });
  loadEnv({ path: '.env' });

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) fail('DATABASE_URL is not set', 2);

  const takenAt = new Date().toISOString();
  const stamp = takenAt.replace(/[:.]/g, '-').replace(/-\d{3}Z$/, 'Z');
  const outFile = path.join(outDir, `${ref}-${stamp}.json`);
  // Checked BEFORE the read, so a refusal costs nothing and cannot be mistaken for a failed dump.
  if (existsSync(outFile)) fail(`${outFile} already exists — refusing to overwrite a backup`, 2);

  const client = new pg.Client({ connectionString: databaseUrl });
  try {
    await client.connect();
  } catch (error) {
    fail(`could not connect: ${(error as Error).message}`, 1);
  }

  const tables: Record<string, unknown[]> = {};
  try {
    // EVERY base table in auth and public, discovered from the catalog rather than listed here: a
    // hand-maintained list silently stops backing up whatever was added since someone last edited
    // it, and nobody notices until a restore.
    const listed = await client.query(
      `select table_schema, table_name
         from information_schema.tables
        where table_schema in ('auth', 'public')
          and table_type = 'BASE TABLE'
        order by table_schema, table_name`,
    );
    for (const row of listed.rows as { table_schema: string; table_name: string }[]) {
      const key = `${row.table_schema}.${row.table_name}`;
      const quoted = `"${row.table_schema}"."${row.table_name}"`;
      try {
        const data = await client.query(`select * from ${quoted}`);
        tables[key] = data.rows;
      } catch (error) {
        // A table that cannot be READ is recorded as a refusal, never as an empty array: "no rows"
        // and "no permission" must never look the same in a backup.
        fail(`could not read ${key}: ${(error as Error).message}`, 1);
      }
    }
  } finally {
    await client.end();
  }

  mkdirSync(outDir, { recursive: true });
  writeFileSync(outFile, `${JSON.stringify({ ref, taken_at: takenAt, tables }, null, 0)}\n`);

  const entries = Object.entries(tables);
  const nonEmpty = entries.filter(([, rows]) => rows.length > 0)
    .sort((a, b) => b[1].length - a[1].length);
  process.stdout.write(`wrote ${outFile}\n`);
  process.stdout.write(`tables ${entries.length} (${nonEmpty.length} non-empty)\n`);
  for (const [name, rows] of nonEmpty) {
    process.stdout.write(`  ${name.padEnd(34)}${rows.length}\n`);
  }
  const empty = entries.filter(([, rows]) => rows.length === 0).map(([n]) => n);
  if (empty.length > 0) process.stdout.write(`  empty (${empty.length}): ${empty.join(', ')}\n`);
}

await main();
