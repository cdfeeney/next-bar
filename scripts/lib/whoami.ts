/**
 * WHICH DATABASE IS THIS — as a FUNCTION, so the tools that act on the answer hold the same object
 * that produced it.
 *
 * WHY IT MOVED OUT OF THE CLI. `db:dump` and `db:reset-staging` used to answer this question by
 * SPAWNING `db-whoami.mts`, scraping a project ref out of its stdout, and then — separately, later,
 * in the parent — re-reading the secrets file to build the client they actually connected with.
 * Codex found the seam in round 4: the certification and the connection described two different
 * reads of a mutable file, so a secrets file edited (or simply resolving differently) between them
 * meant the printed pre-count named staging while the destructive statements went to production.
 *
 * A child process cannot hand back an object, only text — so the fix is not to parse the text more
 * carefully, it is to stop crossing a process boundary at all. `whoami()` returns the
 * `CertifiedTarget` the guard produced, and every caller connects with THAT. The identity that is
 * printed and the socket that is opened are now the same value, and no re-read can separate them.
 *
 * It also deletes the last consumer of the whoami identity-line regex, which is why that file is
 * gone: a shape that nothing parses cannot drift out of step with a label again (round-3 R3-7).
 *
 * READ-ONLY. Four `select count(*)`-shaped queries and nothing else.
 */
import { existsSync } from 'node:fs';

import { config as loadEnv } from 'dotenv';
import pg from 'pg';

import { readClassification } from './classification';
import {
  deriveLabel, parseApiRef, parseRef, resolveIdentity, TargetRefusal, type CertifiedTarget,
} from './migration-target-guard';

/**
 * SNAPSHOT AT MODULE LOAD, BEFORE ANY dotenv CALL ANYWHERE IN THE PROCESS.
 *
 * A shell `DATABASE_URL` survives every load below (dotenv defaults to override:false) and is
 * afterwards indistinguishable from one a file supplied. The LABEL is captured for the opposite
 * reason: a `--secrets-file` loads with override:true, so a label in that file REPLACES one
 * exported in the shell, and a human who exported a contradicting label would be silently corrected
 * instead of refused. That exact case was found by this tool's own first acceptance run.
 */
const SHELL_DATABASE_URL = process.env.DATABASE_URL;
const SHELL_DECLARED_ENV = process.env.NEXT_BAR_DATABASE_ENVIRONMENT;

export interface WhoamiResult {
  /** The certified target. CONNECT WITH THIS — never with a fresh read of process.env. */
  certified: CertifiedTarget;
  ref: string;
  label: string | null;
  /** The one line an operator reads: ref, label, and the counts that are the evidence. */
  line: string;
  /** Non-empty means REFUSED. The counts are still filled in whenever the connection worked. */
  refusals: string[];
  connected: boolean;
}

async function readCount(client: pg.Client, sql: string): Promise<number | null> {
  try {
    const result = await client.query(sql);
    return Number(result.rows[0]?.n ?? 0);
  } catch {
    // A missing table is a FACT about this database, not an error: an empty project legitimately
    // has no public.bars. It reports as `none`, never 0 — "no rows" and "no such table" are
    // different answers, and conflating them is how an empty database passes for a populated one.
    return null;
  }
}

export class WhoamiConnectionError extends Error {}

/**
 * Loads the environment, certifies the target, and reads the counts.
 *
 * Throws TargetRefusal when the target cannot be certified at all (the caller maps that to exit 2),
 * and WhoamiConnectionError when nothing is wrong except that the database did not answer. A
 * refusal that is merely inconsistent — a contradicting label, an unclassified ref — comes back in
 * `refusals` WITH the counts, because the counts are the evidence and hiding them sends the
 * operator looking somewhere else.
 */
export async function whoami(secretsFile: string | null): Promise<WhoamiResult> {
  if (secretsFile !== null) {
    if (secretsFile === '') throw new TargetRefusal('--secrets-file needs a path');
    if (!existsSync(secretsFile)) throw new TargetRefusal(`--secrets-file ${secretsFile} does not exist`);
    loadEnv({ path: secretsFile, override: true });
  }
  loadEnv({ path: '.env.local' });
  loadEnv({ path: '.env' });

  const classification = readClassification();
  const databaseUrl = process.env.DATABASE_URL;
  const apiUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const declared = process.env.NEXT_BAR_DATABASE_ENVIRONMENT;

  if (!databaseUrl) throw new TargetRefusal('DATABASE_URL is not set');

  const certified = resolveIdentity(databaseUrl);
  const ref = certified.ref;
  const apiRef = parseApiRef(apiUrl);

  const refusals: string[] = [];

  // RULE 1 — the pair must name one project. The pooler hostname is shared, so a mismatched pair
  // is how a production connection string ends up carrying a staging API URL, or the reverse.
  if (ref !== apiRef) {
    refusals.push(
      `DATABASE_URL names ${ref} but NEXT_PUBLIC_SUPABASE_URL names ${apiRef} — `
      + 'the pooler hostname is shared, so this pairing is exactly how a connection string ends up '
      + "wearing another project's identity",
    );
  }
  if (SHELL_DATABASE_URL && parseRef(SHELL_DATABASE_URL) !== ref) {
    refusals.push(
      `a DATABASE_URL exported in this shell names ${parseRef(SHELL_DATABASE_URL)} while the loaded `
      + `environment names ${ref} — one is wrong and this script will not choose`,
    );
  }

  // RULE 2 — an unclassified project is not a project this tooling may act on.
  const label = deriveLabel(ref, classification);
  if (!label) {
    refusals.push(
      `unknown project ${ref} — operator must classify it in .env.local via `
      + 'NEXT_BAR_PRODUCTION_PROJECT_REF or NEXT_BAR_STAGING_PROJECT_REFS',
    );
  }

  // RULE 3 — the environment may not contradict the ref. It does not get to NAME the database; its
  // only power is to be wrong, and being wrong is a refusal.
  for (const [source, value] of [['shell', SHELL_DECLARED_ENV], ['loaded environment', declared]] as const) {
    if (value && label && value.trim().toLowerCase() !== label) {
      refusals.push(
        `NEXT_BAR_DATABASE_ENVIRONMENT in the ${source} says "${value}" but ref ${ref} is `
        + `${label} — the ref decides. This is the pairing that destroyed the staging project: a `
        + 'label from one source married to a connection from another',
      );
      break;
    }
  }

  let line = `${ref} ${label ?? 'unknown'}`;
  const client = new pg.Client({ connectionString: certified.connectionString });
  let connected = false;
  try {
    await client.connect();
    connected = true;
  } catch (error) {
    if (refusals.length === 0) throw new WhoamiConnectionError(`could not connect: ${(error as Error).message}`);
    refusals.push(`could not connect: ${(error as Error).message}`);
  }

  if (connected) {
    try {
      const users = await readCount(client, 'select count(*)::int n from auth.users');
      const profiles = await readCount(client, 'select count(*)::int n from public.profiles');
      const bars = await readCount(client, 'select count(*)::int n from public.bars');
      let ledger: string | null = null;
      try {
        const r = await client.query(
          'select name from public.schema_migrations order by name desc limit 1',
        );
        ledger = (r.rows[0]?.name as string | undefined) ?? null;
      } catch { ledger = null; }
      const show = (n: number | null) => (n === null ? 'none' : String(n));
      line += ` users=${show(users)} profiles=${show(profiles)} bars=${show(bars)}`
        + ` ledger=${ledger ?? 'none'}`;
    } finally {
      await client.end();
    }
  }

  return { certified, ref, label, line, refusals, connected };
}
