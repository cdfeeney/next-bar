import { createHash } from 'node:crypto';

/**
 * Decide which migrations to apply, given a ledger of what already ran.
 *
 * Why this exists: until now `apply-migrations.ts` re-ran EVERY .sql file on
 * every `npm run db:migrate`, relying on each file being idempotent. That has
 * two teeth:
 *
 *  1. Re-running 0020 re-creates and re-GRANTs the `pending_change_count(uuid)`
 *     function that 0021 exists to remove. Within one run the files apply in
 *     lexical order so it self-heals, but any window where 0020 ran and 0021
 *     did not leaves an over-permissive definer function live.
 *  2. Nothing detects an ALREADY-APPLIED migration being edited afterwards.
 *     That is the dangerous case: the file and the database silently disagree
 *     forever, and the next fresh environment gets different schema.
 *
 * So: hash every file, record it on success, skip it next time, and REFUSE to
 * run at all if a recorded file's contents changed. Drift is a hard stop, not
 * a warning — a warning in a script nobody watches is not a control.
 *
 * Pure and DB-free so it can actually be tested; the script owns the I/O.
 */

export type MigrationFile = { name: string; sql: string };

/** A row from the schema_migrations ledger. */
export type AppliedMigration = { name: string; checksum: string };

export type MigrationDrift = {
  name: string;
  recorded: string;
  current: string;
};

export type MigrationPlan = {
  /** Files to run, in lexical order. Empty when drift is present. */
  apply: MigrationFile[];
  /** Names already applied with matching checksums. */
  skip: string[];
  /** Applied files whose contents changed since. Non-empty ⇒ do not proceed. */
  drift: MigrationDrift[];
};

/**
 * SHA-256 of a migration's contents, normalised first.
 *
 * Line endings are normalised because this repo is developed on Windows with
 * `core.autocrlf` active — the same file can be read as CRLF on one machine and
 * LF on another. Hashing raw bytes would report drift on every checkout and
 * make the drift guard useless noise. A trailing-newline difference is likewise
 * not a schema change.
 */
export function checksum(sql: string): string {
  const normalised = sql.replace(/\r\n/g, '\n').replace(/\s+$/, '');
  return createHash('sha256').update(normalised, 'utf8').digest('hex');
}

export function planMigrations(
  files: readonly MigrationFile[],
  applied: readonly AppliedMigration[],
): MigrationPlan {
  const recorded = new Map(applied.map((a) => [a.name, a.checksum]));

  const apply: MigrationFile[] = [];
  const skip: string[] = [];
  const drift: MigrationDrift[] = [];

  for (const file of files) {
    const current = checksum(file.sql);
    const previous = recorded.get(file.name);

    if (previous === undefined) {
      apply.push(file);
    } else if (previous === current) {
      skip.push(file.name);
    } else {
      drift.push({ name: file.name, recorded: previous, current });
    }
  }

  // Fail closed: if ANY applied migration was edited, run nothing. Applying
  // the untouched remainder would leave the schema in a state no single
  // commit describes, which is worse than doing nothing and saying so.
  return drift.length > 0 ? { apply: [], skip, drift } : { apply, skip, drift };
}
