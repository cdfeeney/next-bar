/**
 * Every refusal that decides WHICH database `apply-migration-set.ts` is about to
 * write to, in one pure function.
 *
 * It lives here rather than inline in the script because the script calls
 * `main()` at import time and opens a `pg` connection: the guard that matters
 * most on the live-revenue path was the one part of it no test could reach.
 * Nothing here does I/O — the caller loads the files and passes what it found.
 */

export class TargetRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TargetRefusal';
  }
}

export interface TargetInput {
  /** The `--env` label the operator named on the command line. */
  env: string;
  /** Path passed to `--secrets-file`, or null when none was given. */
  secretsFile: string | null;
  /** `dotenv`'s `parsed` for the secrets file — what THAT file itself set. */
  secretsParsed: Record<string, string> | undefined;
  /** `process.env.DATABASE_URL` snapshotted BEFORE any dotenv load ran. */
  shellDatabaseUrl: string | undefined;
  /** `process.env.DATABASE_URL` after every load. */
  databaseUrl: string | undefined;
  /** `process.env.NEXT_BAR_DATABASE_ENVIRONMENT` after every load. */
  actualEnv: string | undefined;
}

function refuse(message: string): never {
  throw new TargetRefusal(message);
}

export function resolveTarget(input: TargetInput): { databaseUrl: string; actualEnv: string } {
  const {
    env, secretsFile, secretsParsed, shellDatabaseUrl, databaseUrl, actualEnv,
  } = input;

  if (secretsFile !== null) {
    // The URL and the LABEL must come from the SAME file.
    //
    // `.env.local` is loaded WITHOUT override, so it fills in anything the
    // secrets file left unset. That is the desired behaviour for most variables
    // and catastrophic for these two: a secrets file carrying only DATABASE_URL
    // lets the label fall through from .env.local, so a production connection
    // string gets paired with the word "staging" — and a secrets file carrying
    // only the label lets the URL fall through the same way, so a "production"
    // label gets paired with the staging connection string. Either half
    // inherited from elsewhere breaks the pairing the check below relies on.
    if (!secretsParsed?.NEXT_BAR_DATABASE_ENVIRONMENT) {
      refuse(
        `--secrets-file ${secretsFile} sets no NEXT_BAR_DATABASE_ENVIRONMENT. `
        + 'A secrets file that names a target must also name WHICH target it is; '
        + 'otherwise the label is inherited from .env.local and can disagree with '
        + 'the connection string this file supplies.',
      );
    }
    if (!secretsParsed?.DATABASE_URL) {
      refuse(
        `--secrets-file ${secretsFile} sets no DATABASE_URL. `
        + 'A secrets file that names WHICH target it is must also supply that '
        + "target's connection string; otherwise the URL is inherited from "
        + '.env.local and can disagree with the label this file supplies.',
      );
    }
  } else if (shellDatabaseUrl !== undefined) {
    // dotenv defaults to `override: false`, so a DATABASE_URL already exported
    // in the shell survives every load and gets paired with .env.local's label.
    // A production connection string then passes `--env staging --execute`
    // while every line this script prints says staging. The redacted shared
    // pooler URL cannot tell the two apart, so nothing downstream can catch it.
    refuse(
      'DATABASE_URL is already set in the environment, so it did not come from '
      + 'the same file as the label and the two cannot be checked against each '
      + 'other. Unset it, or pass --secrets-file with both DATABASE_URL and '
      + 'NEXT_BAR_DATABASE_ENVIRONMENT in it.',
    );
  }

  if (!databaseUrl) refuse('DATABASE_URL is not set');
  if (!actualEnv) {
    refuse('NEXT_BAR_DATABASE_ENVIRONMENT is not set, so the target cannot be identified');
  }
  if (actualEnv !== env) {
    refuse(
      `you named --env ${JSON.stringify(env)} but the loaded environment is `
      + `${JSON.stringify(actualEnv)}. The connection string cannot tell these apart; `
      + 'the label is the only thing that can.',
    );
  }

  // Returned rather than merely asserted so the caller connects with the exact
  // pair this function approved, and cannot re-read a wider-typed process.env.
  return { databaseUrl, actualEnv };
}
