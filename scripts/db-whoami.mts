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
 * So the only trusted inputs are the operator-set lists in the REPO-ROOT `.env.local`:
 * NEXT_BAR_PRODUCTION_PROJECT_REF and NEXT_BAR_STAGING_PROJECT_REFS. They are read from that file
 * DIRECTLY, not from process.env, so a --secrets-file cannot supply or shadow them. The ref decides
 * the label; the environment only gets to CONTRADICT it, which is a refusal.
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
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { config as loadEnv, parse as parseEnv } from 'dotenv';
import pg from 'pg';

function fail(message: string, code: number): never {
  process.stderr.write(`[db:whoami] ${message}\n`);
  process.exit(code);
}

/**
 * The project ref out of a Supabase connection string or API URL.
 *
 * Two shapes, deliberately both: the pooler puts the ref in the USERNAME
 * (`postgres.<ref>@aws-0-…`), the API URL puts it in the HOST (`https://<ref>.supabase.co`), and a
 * direct connection uses `db.<ref>.supabase.co`. Anything else returns null and is treated as
 * unidentifiable rather than guessed at — a wrong guess here is the whole incident.
 */
export function parseRef(value: string | undefined): string | null {
  if (!value) return null;
  const pooler = value.match(/postgres\.([a-z0-9]{16,})[:@]/i);
  if (pooler) return pooler[1].toLowerCase();
  const host = value.match(/(?:^|\/\/|@)(?:db\.)?([a-z0-9]{16,})\.supabase\.(?:co|net)/i);
  if (host) return host[1].toLowerCase();
  return null;
}

export type Classification = {
  productionRef: string | null;
  stagingRefs: string[];
};

/** The operator-set lists, read from the repo-root .env.local FILE — never from process.env. */
export function readClassification(envLocalPath: string): Classification {
  if (!existsSync(envLocalPath)) {
    fail(`${envLocalPath} does not exist; the operator-set project lists live only there`, 2);
  }
  const parsed = parseEnv(readFileSync(envLocalPath));
  const staging = (parsed.NEXT_BAR_STAGING_PROJECT_REFS ?? '')
    .split(/[,\s]+/)
    .map((r) => r.trim().toLowerCase())
    .filter(Boolean);
  return {
    productionRef: (parsed.NEXT_BAR_PRODUCTION_PROJECT_REF ?? '').trim().toLowerCase() || null,
    stagingRefs: staging,
  };
}

/** production | staging | null. The ref decides; nothing else gets a vote. */
export function deriveLabel(ref: string, classification: Classification): string | null {
  if (classification.productionRef && ref === classification.productionRef) return 'production';
  if (classification.stagingRefs.includes(ref)) return 'staging';
  return null;
}

async function readCount(client: pg.Client, sql: string): Promise<number | null> {
  try {
    const result = await client.query(sql);
    return Number(result.rows[0]?.n ?? 0);
  } catch {
    // A missing table is a FACT about this database, not an error: an empty project legitimately
    // has no public.bars. It prints as `none`, never as 0 — "no rows" and "no such table" are
    // different answers, and conflating them is how an empty database passes for a populated one.
    return null;
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const secretsIndex = args.indexOf('--secrets-file');
  const secretsFile = secretsIndex >= 0 ? args[secretsIndex + 1] ?? '' : null;

  // Snapshot BEFORE any dotenv load: override:false means a shell DATABASE_URL survives every load
  // below and is afterwards indistinguishable from one a file supplied.
  //
  // The LABEL is snapshotted for the opposite reason. A --secrets-file loads with override:true, so
  // a label in that file OVERWRITES one forced in the shell — which means a human who exports a
  // contradicting label would be silently corrected instead of refused. Found by this tool's own
  // acceptance check: forcing NEXT_BAR_DATABASE_ENVIRONMENT=production against staging exited 0,
  // because .env.staging.local's own `staging` had already replaced it. Both values are checked.
  const shellDatabaseUrl = process.env.DATABASE_URL;
  const shellDeclared = process.env.NEXT_BAR_DATABASE_ENVIRONMENT;

  if (secretsFile !== null) {
    if (secretsFile === '') fail('--secrets-file needs a path', 2);
    if (!existsSync(secretsFile)) fail(`--secrets-file ${secretsFile} does not exist`, 2);
    loadEnv({ path: secretsFile, override: true });
  }
  loadEnv({ path: '.env.local' });
  loadEnv({ path: '.env' });

  const classification = readClassification(path.resolve('.env.local'));
  const databaseUrl = process.env.DATABASE_URL;
  const apiUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const declared = process.env.NEXT_BAR_DATABASE_ENVIRONMENT;

  if (!databaseUrl) fail('DATABASE_URL is not set', 2);

  const urlRef = parseRef(databaseUrl);
  const apiRef = parseRef(apiUrl);
  if (!urlRef) fail('could not parse a project ref from DATABASE_URL — refusing to guess', 2);

  // Collected, then reported together with the counts, because the counts ARE the evidence and a
  // refusal that hides them makes the operator go and look another way.
  const refusals: string[] = [];

  // RULE 1 — the pair must name one project. The pooler hostname is shared, so a mismatched pair
  // is how a production connection string ends up carrying a staging API URL, or the reverse.
  if (!apiRef) {
    refusals.push('could not parse a project ref from NEXT_PUBLIC_SUPABASE_URL — refusing to guess');
  } else if (urlRef !== apiRef) {
    refusals.push(
      `DATABASE_URL names ${urlRef} but NEXT_PUBLIC_SUPABASE_URL names ${apiRef} — `
      + 'the pooler hostname is shared, so this pairing is exactly how a connection string ends up '
      + 'wearing another project\'s identity',
    );
  }
  if (shellDatabaseUrl && parseRef(shellDatabaseUrl) !== urlRef) {
    refusals.push(
      `a DATABASE_URL exported in this shell names ${parseRef(shellDatabaseUrl)} while the loaded `
      + `environment names ${urlRef} — one is wrong and this script will not choose`,
    );
  }

  // RULE 2 — an unclassified project is not a project this tooling may act on.
  const derived = deriveLabel(urlRef, classification);
  if (!derived) {
    refusals.push(
      `unknown project ${urlRef} — operator must classify it in .env.local via `
      + 'NEXT_BAR_PRODUCTION_PROJECT_REF or NEXT_BAR_STAGING_PROJECT_REFS',
    );
  }

  // RULE 3 — the environment may not contradict the ref. It does not get to NAME the database;
  // its only power is to be wrong, and being wrong is a refusal.
  for (const [source, value] of [['shell', shellDeclared], ['loaded environment', declared]] as const) {
    if (value && derived && value.trim().toLowerCase() !== derived) {
      refusals.push(
        `NEXT_BAR_DATABASE_ENVIRONMENT in the ${source} says "${value}" but ref ${urlRef} is `
        + `${derived} — the ref decides. This is the pairing that destroyed the staging project: a `
        + 'label from one source married to a connection from another',
      );
      break;
    }
  }

  let line = `${urlRef} ${derived ?? 'unknown'}`;
  const client = new pg.Client({ connectionString: databaseUrl });
  let connected = false;
  try {
    await client.connect();
    connected = true;
  } catch (error) {
    if (refusals.length === 0) fail(`could not connect: ${(error as Error).message}`, 1);
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

  process.stdout.write(`${line}\n`);
  if (refusals.length > 0) {
    for (const reason of refusals) process.stderr.write(`[db:whoami] REFUSED: ${reason}\n`);
    process.exit(2);
  }
}

await main();
