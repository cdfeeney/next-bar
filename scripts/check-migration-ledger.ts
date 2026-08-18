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
import { join, resolve } from 'node:path';
import { Client } from 'pg';
import {
  describeUnappliable, findMisnamed, findUnappliable, ledgerHead,
} from './migration-ledger-guard';

// Normally the worktree's own migrations. CI overrides it so the code that RUNS
// comes from the trusted base commit while the PR's tree is read only as data —
// see the migration-ledger job in .github/workflows/ci.yml. Only filenames are
// ever read from here; nothing in it is executed.
const MIGRATIONS_DIR = process.env.MIGRATION_LEDGER_DIR
  ? resolve(process.env.MIGRATION_LEDGER_DIR)
  : join(process.cwd(), 'supabase', 'migrations');
const OK = 0;
const UNAPPLIABLE = 1;
const COULD_NOT_VERIFY = 2;

// pg defaults BOTH of these to unlimited. Without them a target that drops
// packets or stalls the handshake hangs until the workflow's own 5-minute
// timeout kills the job — a generic cancellation instead of the distinct
// COULD NOT VERIFY this guard promises. Finite timeouts route the same failure
// through the ordinary catch path.
const CONNECT_TIMEOUT_MS = 15_000;
const QUERY_TIMEOUT_MS = 30_000;

function cannotVerify(message: string): never {
  console.error(`\n[migration-ledger] COULD NOT VERIFY: ${message}\n`);
  process.exit(COULD_NOT_VERIFY);
}

/** Reads the ledger. Any failure is the caller's "could not verify", never an empty list. */
async function readLedger(databaseUrl: string): Promise<string[]> {
  const client = new Client({
    connectionString: databaseUrl,
    connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
    query_timeout: QUERY_TIMEOUT_MS,
  });
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
  //
  // BOTH the user and the host carry the ref, in different connection shapes:
  // a pooler URL is `postgres.<ref>@aws-0-....pooler.supabase.com`, a DIRECT
  // one is `postgres@db.<ref>.supabase.co`. Reading only the user derived the
  // literal string "postgres" for every direct URL, which matches no production
  // ref, so a direct production URL walked straight through this gate and was
  // stopped only by DNS. Collect every ref the connection can be read as and
  // refuse if ANY of them is production.
  const probe = new Client({ connectionString: databaseUrl }) as unknown as {
    connectionParameters?: { user?: string; host?: string };
  };
  const { user = '', host = '' } = probe.connectionParameters ?? {};
  const refs = [
    // `postgres.<ref>` — a plain `postgres` yields nothing, not a bogus ref.
    user.includes('.') ? user.split('.').pop() ?? '' : '',
    // `db.<ref>.supabase.co`
    /^db\.([^.]+)\./.exec(host)?.[1] ?? '',
  ].filter(Boolean);

  if (refs.length === 0) {
    cannotVerify('could not determine the Supabase project ref from DATABASE_URL');
  }
  if (refs.includes(productionRef)) {
    cannotVerify(
      `NEXT_BAR_DATABASE_ENVIRONMENT says ${JSON.stringify(environment)} but DATABASE_URL `
      + 'points at the PRODUCTION project ref.',
    );
  }

  // The same allowlist apply-migration-set.ts enforces, and the positive half of
  // the check: "not production" only rules out the one ref we can name, while an
  // allowlist also excludes any third project nobody meant to touch. Optional,
  // exactly as it is there: unset means there is no allowlist to check against.
  const stagingRefs = (process.env.NEXT_BAR_STAGING_PROJECT_REFS ?? '')
    .split(',').map((value) => value.trim()).filter(Boolean);
  if (stagingRefs.length > 0 && !refs.some((value) => stagingRefs.includes(value))) {
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

  // apply-migration-set.ts compares filenames LEXICALLY (`entry.name <= head`,
  // and its head is `order by name desc limit 1`); this guard compares the
  // numeric prefix. The two orders agree only while every prefix is the same
  // width. One `60_foo.sql` applied against head `0059` is enough to break the
  // correspondence permanently: after it, apply refuses `0061_bar.sql`
  // ('0061...' < '60_...') while this guard sees 61 > 60 and stays green — the
  // guard would then be blind to exactly what it exists to catch. Cheaper to
  // refuse the filename than to model two orderings.
  const misnamed = findMisnamed(files);
  if (misnamed.length > 0) {
    console.error(
      `\n[migration-ledger] ${misnamed.length} migration file(s) do not use the `
      + 'NNNN_name.sql convention:\n',
    );
    for (const name of misnamed) {
      console.error(
        `  - ${name}\n`
        + '    Remedy: rename it to a four-digit prefix. apply-migration-set.ts orders\n'
        + '    migrations lexically and this guard orders them numerically; those agree\n'
        + '    only at a fixed width, and one file of another width makes this guard\n'
        + '    blind to the unappliable migrations it exists to catch.\n',
      );
    }
    process.exit(UNAPPLIABLE);
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
  // The same convention, enforced on the OTHER side. findMisnamed over the files
  // keeps THIS repo from minting an off-width name, but a row can reach the
  // ledger by a path this guard does not control (nb-overnight's runner, a
  // manual apply, another branch). Once '60_foo.sql' is a ledger row, the
  // numeric head is 60 while apply-migration-set.ts's lexical head is
  // '60_foo.sql', and it refuses every later four-digit file while this guard
  // sees 61 > 60 and stays green. A ledger we cannot order is one we cannot
  // check against, so it is a could-not-verify, not a repo violation.
  const misnamedRows = findMisnamed(ledger);
  if (misnamedRows.length > 0) {
    cannotVerify(
      `public.schema_migrations contains ${misnamedRows.length} row(s) that do not use the `
      + `NNNN_name.sql convention (${misnamedRows.slice(0, 3).join(', ')}), so its lexical `
      + 'order and the numeric order used here disagree, so no head can be trusted.',
    );
  }

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
