/**
 * db:whoami — WHICH DATABASE AM I ACTUALLY POINTED AT, AND WHAT IS IN IT.
 *
 * READ-ONLY. Four `select count(*)`-shaped queries and nothing else. No transaction is held open,
 * nothing is written, nothing is created.
 *
 * WHY THIS EXISTS. On 2026-08-28 the staging project was destroyed by a session that believed it
 * was operating inside a "staging only" mandate. The mandate was real; the belief about what it
 * permitted was not, and nothing in the tooling made the driver look at the database before acting
 * on it. Nine accounts were lost, on a free-tier project with no backups and no PITR.
 *
 * THE LABEL IS DERIVED FROM THE REF, NEVER READ FROM THE ENVIRONMENT — and that rule was written
 * by this tool's own first draft failing. That draft PRINTED `NEXT_BAR_DATABASE_ENVIRONMENT`, and
 * the first time it ran it announced the staging project as `production`: `.env.staging.local`
 * carries four keys and no label, so dotenv's override:false let `.env.local` supply the word
 * while the secrets file supplied the connection. A staging connection string wearing the word
 * production is the incident's exact defect class, one file layout away from repeating it.
 *
 * THE WORK LIVES IN scripts/lib/whoami.ts. This file is the command-line skin over it. It moved
 * because `db:dump` and `db:reset-staging` need this answer as an OBJECT: they used to spawn this
 * script and scrape a project ref out of its stdout, then re-read the secrets file to build the
 * client they actually connected with — two reads of a mutable file, which round 4 showed could
 * describe two different projects. A child process can only hand back text; a function hands back
 * the certified target itself.
 *
 * Usage:
 *   npm run db:whoami                       # .env.local, then .env
 *   npm run db:whoami -- --secrets-file <p> # a non-default target, without repointing .env.local
 *
 * Exit codes:
 *   0  identified and consistent
 *   2  REFUSED — refs disagree, project unclassified, or the environment contradicts the ref
 *   1  the database could not be read (connection/permission), reported verbatim
 *
 * Counts are the evidence, so they are printed even on a refusal whenever the connection works.
 */
import { TargetRefusal } from './lib/migration-target-guard';
import { whoami, WhoamiConnectionError, type WhoamiResult } from './lib/whoami';

function fail(message: string, code: number): never {
  process.stderr.write(`[db:whoami] ${message}\n`);
  process.exit(code);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const secretsIndex = args.indexOf('--secrets-file');
  const secretsFile = secretsIndex >= 0 ? args[secretsIndex + 1] ?? '' : null;

  let result: WhoamiResult;
  try {
    result = await whoami(secretsFile);
  } catch (error) {
    // "could not connect" is exit 1 and is NOT a refusal: the target was identified fine and the
    // network or the credentials failed. Collapsing the two sends an operator to look at DNS for
    // what is actually a spoofed or unclassified target, and the reverse.
    if (error instanceof WhoamiConnectionError) fail(error.message, 1);
    throw error;
  }

  process.stdout.write(`${result.line}\n`);
  if (result.refusals.length > 0) {
    for (const reason of result.refusals) process.stderr.write(`[db:whoami] REFUSED: ${reason}\n`);
    process.exit(2);
  }
}

try {
  await main();
} catch (error) {
  // Every guard refusal arrives here as a throw. Exit 2, the documented REFUSED code — not the
  // unhandled-rejection exit 1, which means "could not read the database" and would send an
  // operator looking at the network for what is actually a spoofed or unclassified target.
  if (error instanceof TargetRefusal) fail(`REFUSED: ${error.message}`, 2);
  throw error;
}
