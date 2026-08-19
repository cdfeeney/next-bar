/**
 * apply-one-migration — apply a SINGLE migration file attended, without
 * running the whole ledger-less runner (which re-runs every file).
 *
 * WHY: two work streams can have authored-but-gated migrations in the
 * same directory (e.g. 0015's apply gate belongs to its own stream).
 * `npm run db:migrate` is all-or-nothing; this applies exactly one file
 * so a stream never applies another stream's DDL as a side effect.
 *
 * ATTENDED ONLY: writes DDL to a real database.
 *
 * THE TARGET IS NAMED, NEVER INFERRED. This file used to connect to whatever
 * DATABASE_URL pointed at, asking nothing — while its sibling
 * apply-migration-set.ts refused six different ways to reach the wrong
 * database. A runbook line saying "use the other one" is a note in a document;
 * it stops nobody at 2am. Both appliers now go through the same
 * authorizeMigrationTarget(), so there is one decision and one vocabulary
 * rather than two tools that disagree.
 *
 * PREFER apply-migration-set.ts for anything that is a SET: it applies the
 * files in one transaction and writes the ledger rows. This tool writes no
 * `public.schema_migrations` row — that has always been true of it, and is why
 * it is the exception rather than the default.
 *
 *   npx tsx scripts/apply-one-migration.mts --env staging supabase/migrations/0016_x.sql
 *   npx tsx scripts/apply-one-migration.mts --secrets-file .env.production.local \
 *     --env production supabase/migrations/0016_x.sql
 */
import { config as loadEnv } from 'dotenv';
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Client } from 'pg';
import { authorizeMigrationTarget, redactUrl } from './apply-migration-target-guard';

const USAGE = 'usage: npx tsx scripts/apply-one-migration.mts --env <label> '
  + 'supabase/migrations/<file>.sql';

function fail(message: string): never {
  console.error(`\n[apply-one] REFUSING: ${message}\n`);
  process.exit(1);
}

function usage(message: string): never {
  console.error(`${message}\n${USAGE}`);
  process.exit(2);
}

if (process.env.LOOP_UNATTENDED === '1') {
  console.error('apply-one-migration writes DDL — attended runs only.');
  process.exit(2);
}

let env = '';
let file = '';
let secretsFile: string | null = null;
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i += 1) {
  const arg = argv[i];
  if (arg === '--env') {
    i += 1;
    env = argv[i] ?? '';
  } else if (arg === '--secrets-file') {
    i += 1;
    secretsFile = argv[i] ?? '';
  } else if (arg.startsWith('--')) usage(`unknown option ${arg}`);
  else if (file) usage('this tool applies exactly ONE file; use apply-migration-set.ts for a set');
  else file = arg;
}
if (!env) usage('--env <label> is required; the target must be named, never inferred');
if (!file || !/supabase[\\/]migrations[\\/].+\.sql$/.test(file)) usage('name one migration file');

// Same option, same reason as apply-migration-set.ts: reaching a non-default
// target by repointing .env.local silently redirects every other tool in the
// repo and stays that way until someone remembers to undo it. dotenv does not
// reliably report a missing file, so a typo would fall through to .env.local
// and apply DDL to whatever THAT names.
if (secretsFile !== null) {
  if (secretsFile === '') fail('--secrets-file needs a path');
  if (!existsSync(secretsFile)) fail(`--secrets-file ${secretsFile} does not exist`);
  loadEnv({ path: secretsFile, override: true });
}
loadEnv({ path: '.env.local' });
loadEnv({ path: '.env' });

const authorized = authorizeMigrationTarget(env);
if (authorized.refusal !== null) fail(authorized.refusal);
const { clientConfig, effective, env: actualEnv } = authorized.target;

// Read before connecting: an unreadable file must stop us before we open a
// session on a database at all. RAW BYTES, because that is the convention
// public.schema_migrations already uses — a displayed hash that disagrees with
// the ledger's is worse than none, since someone will compare the two.
let raw: Buffer;
try {
  raw = readFileSync(file);
} catch (error) {
  fail(`cannot read ${file}: ${(error as Error).message}`);
}
const sql = raw.toString('utf8');

console.log(`\n[apply-one] target   : ${redactUrl(clientConfig.connectionString)}`);
console.log(`[apply-one] effective: ${effective.user}@${effective.host}:${effective.port} (pg's own resolution)`);
console.log('[apply-one] tls      : on, peer certificate verified');
console.log(`[apply-one] env      : ${actualEnv}`);
console.log(`[apply-one] file     : ${file}  sha256 ${
  createHash('sha256').update(raw).digest('hex').slice(0, 16)}…  ${raw.length} bytes\n`);

const pg = new Client(clientConfig);
try {
  await pg.connect();
  await pg.query(sql);
  console.log(`ok ${file}`);
} catch (err) {
  console.error(`FAIL ${file}:`, err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await pg.end();
}
