/**
 * Every refusal that decides WHICH database `apply-migration-set.ts` is about to
 * write to, in one pure function.
 *
 * It lives here rather than inline in the script because the script calls
 * `main()` at import time and opens a `pg` connection: the guard that matters
 * most on the live-revenue path was the one part of it no test could reach.
 * Nothing here does I/O — the caller loads the files and passes what it found.
 *
 * THE LABEL IS DERIVED FROM THE PROJECT REF. NOTHING ELSE GETS A VOTE.
 *
 * This function used to trust `NEXT_BAR_DATABASE_ENVIRONMENT` and merely check it against `--env`.
 * That is the defect class that destroyed the staging project on 2026-08-28, and it was caught
 * again the same day by `db:whoami`'s first acceptance run: `.env.staging.local` carried a
 * connection string and NO label, dotenv's `override: false` let `.env.local` supply the word, and
 * the staging project reported itself as `production`. Under the old rule
 * `--env production --execute` would have been ACCEPTED while pointed at staging, and
 * `--env staging` REFUSED — the guard inverted by file layout alone, with nothing typed wrong.
 *
 * So the ref decides. `NEXT_BAR_PRODUCTION_PROJECT_REF` and `NEXT_BAR_STAGING_PROJECT_REFS` are
 * operator-set in the repo-root `.env.local` and are the only classification input; the caller
 * reads them from that FILE, never from `process.env`, so a `--secrets-file` cannot supply or
 * shadow them. `NEXT_BAR_DATABASE_ENVIRONMENT` keeps exactly one power: to CONTRADICT the ref,
 * which is a refusal.
 *
 * The old secrets-file pairing rules are GONE, deliberately. They existed to stop a URL from one
 * file marrying a label from another; with the label derived from the ref there is no marriage to
 * police, and keeping them would refuse the legitimate case this repo actually has — a secrets file
 * that supplies a connection string and lets everything else fall through.
 */

export class TargetRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TargetRefusal';
  }
}

export interface Classification {
  /** `NEXT_BAR_PRODUCTION_PROJECT_REF` from the repo-root `.env.local` FILE. */
  productionRef: string | null;
  /** `NEXT_BAR_STAGING_PROJECT_REFS` from the same file, split on commas/whitespace. */
  stagingRefs: string[];
}

export interface TargetInput {
  /** The `--env` label the operator named on the command line. */
  env: string;
  /** `process.env.DATABASE_URL` snapshotted BEFORE any dotenv load ran. */
  shellDatabaseUrl: string | undefined;
  /** `process.env.NEXT_BAR_DATABASE_ENVIRONMENT` snapshotted BEFORE any dotenv load ran. */
  shellDeclaredEnv: string | undefined;
  /** `process.env.DATABASE_URL` after every load. */
  databaseUrl: string | undefined;
  /** `process.env.NEXT_PUBLIC_SUPABASE_URL` after every load. */
  apiUrl: string | undefined;
  /** `process.env.NEXT_BAR_DATABASE_ENVIRONMENT` after every load. */
  actualEnv: string | undefined;
  /** Operator-set project lists, read from the repo-root `.env.local` FILE. */
  classification: Classification;
}

function refuse(message: string): never {
  throw new TargetRefusal(message);
}

/**
 * The project ref out of a Supabase connection string or API URL.
 *
 * The pooler puts the ref in the USERNAME (`postgres.<ref>@aws-0-…`); the API URL puts it in the
 * HOST (`https://<ref>.supabase.co`); a direct connection uses `db.<ref>.supabase.co`. Anything
 * else returns null and is treated as unidentifiable rather than guessed at.
 */
export function parseRef(value: string | undefined): string | null {
  if (!value) return null;
  const pooler = value.match(/postgres\.([a-z0-9]{16,})[:@]/i);
  if (pooler) return pooler[1].toLowerCase();
  const host = value.match(/(?:^|\/\/|@)(?:db\.)?([a-z0-9]{16,})\.supabase\.(?:co|net)/i);
  if (host) return host[1].toLowerCase();
  return null;
}

/** production | staging | null. */
export function deriveLabel(ref: string, classification: Classification): string | null {
  if (classification.productionRef && ref === classification.productionRef) return 'production';
  if (classification.stagingRefs.includes(ref)) return 'staging';
  return null;
}

export function resolveTarget(input: TargetInput): { databaseUrl: string; actualEnv: string } {
  const {
    env, shellDatabaseUrl, shellDeclaredEnv, databaseUrl, apiUrl, actualEnv, classification,
  } = input;

  if (!databaseUrl) refuse('DATABASE_URL is not set');

  const urlRef = parseRef(databaseUrl);
  if (!urlRef) {
    refuse('could not parse a project ref from DATABASE_URL — refusing to guess which database this is');
  }

  // A shell DATABASE_URL naming a DIFFERENT project than the loaded one is genuine ambiguity, and
  // this function will not choose between them. (Naming the SAME project is harmless: the ref is
  // the identity, and it agrees.)
  if (shellDatabaseUrl && parseRef(shellDatabaseUrl) !== urlRef) {
    refuse(
      `a DATABASE_URL exported in this shell names ${parseRef(shellDatabaseUrl)} while the loaded `
      + `environment names ${urlRef} — one of them is wrong and this script will not choose`,
    );
  }

  // RULE 1 — the connection string and the API URL must name ONE project. Supabase's pooler
  // hostname is shared across projects, so a mismatched pair is precisely how a connection string
  // ends up carrying another project's identity, and nothing downstream can tell them apart.
  const apiRef = parseRef(apiUrl);
  if (!apiRef) {
    refuse('could not parse a project ref from NEXT_PUBLIC_SUPABASE_URL — refusing to guess');
  }
  if (urlRef !== apiRef) {
    refuse(
      `DATABASE_URL names ${urlRef} but NEXT_PUBLIC_SUPABASE_URL names ${apiRef}. `
      + 'The pooler hostname is shared, so these cannot be told apart by inspection — fix the pair '
      + 'before anything writes to it.',
    );
  }

  // RULE 2 — an unclassified project is not one this tooling may write to.
  const derived = deriveLabel(urlRef, classification);
  if (!derived) {
    refuse(
      `unknown project ${urlRef} — operator must classify it in .env.local via `
      + 'NEXT_BAR_PRODUCTION_PROJECT_REF or NEXT_BAR_STAGING_PROJECT_REFS before it can be written to',
    );
  }

  // RULE 3 — the declared label may not contradict the ref, from EITHER source. The shell value is
  // checked separately because a `--secrets-file` loads with `override: true` and would otherwise
  // silently correct a human who exported the wrong label instead of refusing.
  for (const [source, value] of [
    ['shell', shellDeclaredEnv],
    ['loaded environment', actualEnv],
  ] as const) {
    if (value && value.trim().toLowerCase() !== derived) {
      refuse(
        `NEXT_BAR_DATABASE_ENVIRONMENT in the ${source} says ${JSON.stringify(value)} but ref `
        + `${urlRef} is ${derived}. The ref decides; the label is only ever able to be wrong.`,
      );
    }
  }

  // AND `--env` must equal the DERIVED label — not the declared one. This is the check that used to
  // compare `--env` against `NEXT_BAR_DATABASE_ENVIRONMENT`, which made the guard only as truthful
  // as whichever file happened to supply that word.
  if (env !== derived) {
    refuse(
      `you named --env ${JSON.stringify(env)} but ref ${urlRef} is ${JSON.stringify(derived)}. `
      + 'The project ref decides which database this is, not the --env flag and not any label.',
    );
  }

  // Returned rather than merely asserted so the caller connects with the exact pair this function
  // approved, and cannot re-read a wider-typed process.env.
  return { databaseUrl, actualEnv: derived };
}
