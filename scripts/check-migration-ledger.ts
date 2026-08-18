/**
 * check-migration-ledger.ts — CI guard: no migration may be numbered at or
 * below the serving ledger head unless it is already in the ledger.
 *
 * WHY. `apply-migration-set.ts` refuses any file that does not sort above the
 * head. On a branch that forked before trunk advanced, a migration can be
 * committed, reviewed, merged and shipped while being permanently unappliable,
 * and every stage before production is silent about it. A reviewer caught one
 * instance by hand and it cost a database query and an adjudication to settle.
 * This makes it mechanical.
 *
 * EXIT CODES — the distinction matters, so they are not all "1":
 *   0  every migration file is either above the head or already in the ledger
 *   1  at least one file can never be applied by the approved path
 *   2  COULD NOT VERIFY — the ledger was unreadable, or the guard refused to
 *      run against this target. Never a silent pass: a guard that greens when
 *      it cannot see is the failure mode this repo has already hit.
 *
 * READ-ONLY. It opens the session with default_transaction_read_only, so
 * "never writes" is enforced by the server rather than promised by the code,
 * and it refuses a production target outright (same gate as
 * apply-migration-set.ts: the label alone proves only that a word was typed in
 * two places, so the project ref behind DATABASE_URL is checked too).
 *
 * Usage:  npm run check:migrations
 */

import { config as loadEnv } from 'dotenv';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { describeUnappliable, findUnappliable, ledgerHead } from './migration-ledger-guard';

const MIGRATIONS_DIR = join(process.cwd(), 'supabase', 'migrations');
const OK = 0;
const UNAPPLIABLE = 1;
const COULD_NOT_VERIFY = 2;

function cannotVerify(message: string): never {
  console.error(`\n[migration-ledger] COULD NOT VERIFY: ${message}\n`);
  process.exit(COULD_NOT_VERIFY);
}

/** Reads the ledger. Any failure is the caller's "could not verify", never an empty list. */
async function readLedger(databaseUrl: string): Promise<string[]> {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    // Belt and braces: nothing below this line writes, and now nothing below
    // it CAN. A read-only guard that is only read-only by inspection is one
    // careless edit away from not being one.
    await client.query('set default_transaction_read_only = on');
    const { rows } = await client.query<{ name: string }>(
      'select name from public.schema_migrations',
    );
    return rows.map((row) => row.name);
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function main(): Promise<void> {
  loadEnv({ path: '.env.local' });
  loadEnv({ path: '.env' });

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    cannotVerify(
      'DATABASE_URL is not set, so the serving ledger cannot be read. Point it at a '
      + 'read-only, NON-production connection (see .env.example).',
    );
  }

  // Criterion 6, and the same reasoning as apply-migration-set.ts: the label is
  // the only thing that can tell staging from production through a shared
  // pooler hostname, and a label is only a word someone typed. Check both.
  const environment = process.env.NEXT_BAR_DATABASE_ENVIRONMENT;
  if (!environment) {
    cannotVerify(
      'NEXT_BAR_DATABASE_ENVIRONMENT is not set, so the target cannot be identified '
      + 'and this guard will not connect to an unnamed database.',
    );
  }
  if (environment === 'production') {
    cannotVerify('NEXT_BAR_DATABASE_ENVIRONMENT is "production"; this guard does not run against production.');
  }

  // MANDATORY, not best-effort. Guarding this block with `if (productionRef)`
  // made the whole cross-check vanish on the one configuration that ships by
  // default (.env.example leaves it blank) and on a CI repo whose variable has
  // not been created yet — leaving criterion 6 as label-only, which is exactly
  // the "a word someone typed" it exists to distrust.
  const productionRef = process.env.NEXT_BAR_PRODUCTION_PROJECT_REF ?? '';
  if (!productionRef) {
    cannotVerify(
      'NEXT_BAR_PRODUCTION_PROJECT_REF is not set, so the target cannot be proven not to be '
      + 'production and this guard will not connect on the strength of a label alone.',
    );
  }

  // pg's own resolution, not the URL authority — query parameters override the
  // authority, which is how an earlier guard in this repo was bypassable.
  const probe = new Client({ connectionString: databaseUrl }) as unknown as {
    connectionParameters?: { user?: string };
  };
  const ref = (probe.connectionParameters?.user ?? '').split('.').pop() ?? '';
  if (!ref) cannotVerify('could not determine the Supabase project ref from DATABASE_URL');
  if (ref === productionRef) {
    cannotVerify(
      `NEXT_BAR_DATABASE_ENVIRONMENT says ${JSON.stringify(environment)} but DATABASE_URL `
      + 'points at the PRODUCTION project ref.',
    );
  }

  // The same allowlist apply-migration-set.ts enforces. `ref !== productionRef`
  // only rules out the one ref we can name; a positive allowlist also catches a
  // direct connection whose user is plain `postgres` (so the derived ref is
  // `postgres`, matching nothing) and any third project nobody meant to touch.
  // Optional, exactly as it is there: unset means no allowlist to check against.
  const stagingRefs = (process.env.NEXT_BAR_STAGING_PROJECT_REFS ?? '')
    .split(',').map((value) => value.trim()).filter(Boolean);
  if (stagingRefs.length > 0 && !stagingRefs.includes(ref)) {
    cannotVerify(
      `DATABASE_URL's project ref is not in NEXT_BAR_STAGING_PROJECT_REFS (env `
      + `${JSON.stringify(environment)}).`,
    );
  }

  let files: string[];
  try {
    files = readdirSync(MIGRATIONS_DIR);
  } catch (error) {
    cannotVerify(`cannot read ${MIGRATIONS_DIR}: ${(error as Error).message}`);
  }

  let ledger: string[];
  try {
    ledger = await readLedger(databaseUrl);
  } catch (error) {
    cannotVerify(`cannot read public.schema_migrations: ${(error as Error).message}`);
  }

  // No head, no check. An EMPTY ledger is the obvious case, but a non-empty one
  // whose rows do not parse as migration names (a path prefix, a missing .sql,
  // a reformatted ledger) establishes no head either — and findUnappliable
  // returns [] on a null head, so counting rows instead of asking for the head
  // greens the guard in precisely the scenario it exists to catch.
  const head = ledgerHead(ledger);
  if (head === null) {
    cannotVerify(
      `public.schema_migrations yielded no ledger head from ${ledger.length} row(s), so no `
      + 'migration can be checked against it.',
    );
  }

  const unappliable = findUnappliable(files, ledger);
  if (unappliable.length > 0) {
    console.error(
      `\n[migration-ledger] ${unappliable.length} migration file(s) can never be applied `
      + `by the approved path (env ${environment}):\n`,
    );
    for (const offender of unappliable) {
      console.error(`  - ${describeUnappliable(offender)}\n`);
    }
    process.exit(UNAPPLIABLE);
  }

  console.log(
    `[migration-ledger] ok — ${files.length} file(s) checked against ${ledger.length} `
    + `ledger row(s) on env ${environment}. Every migration is above the head or already applied.`,
  );
  process.exit(OK);
}

main().catch((error) => {
  cannotVerify((error as Error).message);
});
