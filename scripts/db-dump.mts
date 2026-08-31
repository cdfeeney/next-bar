/**
 * db:dump — a full JSON snapshot of every table in `auth` and `public`.
 *
 * WHY THIS EXISTS. On 2026-08-28 the staging project was destroyed by a session that took no
 * pre-count and no dump; nine accounts were lost on a free-tier project with no vendor backups. Our
 * own dump is therefore mandatory regardless of what the platform offers, and the rule that came
 * out of that day is: BEFORE ANY DESTRUCTIVE DATABASE ACT — a read-only pre-count, a dump, and the
 * operator's explicit per-act approval.
 *
 * IT IDENTIFIES THE TARGET FIRST, IN THIS PROCESS. `whoami()` returns the certified target and the
 * counts; the dump connects with that exact certified string. It used to SPAWN `db-whoami.mts`,
 * scrape a ref out of its stdout, and then re-read the secrets file itself to build the connection
 * — so the identity printed above the counts and the database actually read were two independent
 * resolutions of a mutable file (round 4, CRITICAL). One object now answers both.
 *
 * WHAT IT PRESERVES is in scripts/lib/dbDump.ts, with the reasoning: every column verbatim,
 * password hashes and ids included, because a dump that drops them is not a restore path.
 *
 * REFUSES TO OVERWRITE. A backup that silently replaces an earlier one can destroy evidence, which
 * is the same class of act it exists to protect against.
 *
 * Usage:
 *   npm run db:dump                          # the default target from .env.local
 *   npm run db:dump -- --secrets-file <path> # a different project, without repointing .env.local
 *   npm run db:dump -- --out <dir>           # default D:\harness-handoffs\db-backups
 *
 * Exit codes: 0 written · 1 read/connect failure · 2 refused (identity, or the file already exists)
 */
import { dumpDatabase, DumpFailure, DumpRefusal, formatDumpSummary } from './lib/dbDump';
import { TargetRefusal } from './lib/migration-target-guard';
import { whoami, WhoamiConnectionError } from './lib/whoami';

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

  // IDENTITY FIRST, ALWAYS — and it is the same object the dump connects with.
  const identified = await whoami(secretsFile);
  process.stdout.write(`--- db:whoami ---\n${identified.line}\n-----------------\n`);
  if (identified.refusals.length > 0) {
    for (const reason of identified.refusals) process.stderr.write(`[db:dump] ${reason}\n`);
    fail('db:whoami refused — no dump is taken against an unidentified database', 2);
  }

  try {
    process.stdout.write(formatDumpSummary(await dumpDatabase(identified.certified, outDir)));
  } catch (error) {
    if (error instanceof DumpRefusal) fail(error.message, 2);
    if (error instanceof DumpFailure) fail(error.message, 1);
    throw error;
  }
}

try {
  await main();
} catch (error) {
  if (error instanceof WhoamiConnectionError) fail(error.message, 1);
  if (error instanceof TargetRefusal) fail(`REFUSED: ${error.message}`, 2);
  throw error;
}
