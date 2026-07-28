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

/**
 * Strip SQL comments before any structural analysis.
 *
 * Load-bearing, not hygiene: every migration in this repo ends with its rollback
 * statements in trailing `--` comments. Counting those as real DDL would invent
 * expectations that were never meant to execute, and the baseline guard below
 * would then refuse on a perfectly healthy database.
 */
function stripSqlComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');
}

/**
 * `CREATE TABLE [IF NOT EXISTS] [schema.]name` — the optional schema group is
 * greedy so `public.bars` yields `bars`, not `public`.
 *
 * `CREATE TEMP TABLE` / `CREATE TEMPORARY TABLE` are excluded for free: the
 * intervening keyword means they never match `create\s+table`. That is
 * deliberate — a temp table is not evidence a migration ran.
 */
const CREATE_TABLE_RE =
  /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:"?[a-z_][a-z0-9_]*"?\s*\.\s*)?"?([a-z_][a-z0-9_]*)"?/gi;

/**
 * Tables this migration set is expected to have created, lowercased, deduplicated,
 * in first-appearance order.
 *
 * Derived from the files rather than hardcoded so the baseline guard cannot go
 * stale as migrations are added — a hardcoded "does `bars` exist" check would
 * still pass on a database that stopped at migration 1.
 *
 * Known limits, stated rather than hidden: a table created inside a `DO $$`
 * block built by string concatenation is invisible here, and a table created by
 * one migration and dropped by a later one would be a false expectation. Neither
 * shape exists in this repo today; if one is added, this returns a weaker
 * signal, never a wrong ledger, because the guard only ever refuses.
 */
export function expectedTablesFromMigrations(
  files: readonly MigrationFile[],
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const file of files) {
    const sql = stripSqlComments(file.sql);
    for (const m of sql.matchAll(CREATE_TABLE_RE)) {
      const name = m[1]?.toLowerCase();
      if (name && !seen.has(name)) {
        seen.add(name);
        out.push(name);
      }
    }
  }
  return out;
}

export type BaselineCheck = {
  ok: boolean;
  /** Tables the migration files say should exist. */
  expected: string[];
  /** Expected tables absent from the database. Non-empty ⇒ refuse. */
  missing: string[];
  /** Set only when the premise could not be evaluated at all. */
  reason?: string;
};

/**
 * Verify the premise `--baseline` asserts: "every file on disk has already been
 * applied to this database."
 *
 * That cannot be proven in general — SQL is not introspectable to that depth —
 * but the catastrophic case can be refused outright. Pointed at a fresh database,
 * baseline would record all migrations as applied without running them, and the
 * next run would report "up to date" while no schema exists at all. Checking
 * every expected table also catches the partially-migrated case, not just the
 * empty one.
 *
 * Fails CLOSED when no expectation can be derived: no evidence of a migrated
 * database is not the same as evidence, and a guard that passes vacuously is not
 * a guard.
 */
export function checkBaselinePremise(
  files: readonly MigrationFile[],
  existingTables: readonly string[],
): BaselineCheck {
  const expected = expectedTablesFromMigrations(files);
  if (expected.length === 0) {
    return {
      ok: false,
      expected,
      missing: [],
      reason:
        'no expectation could be derived from the migration files, so the baseline premise cannot be verified',
    };
  }
  const have = new Set(existingTables.map((t) => t.toLowerCase()));
  const missing = expected.filter((t) => !have.has(t));
  return { ok: missing.length === 0, expected, missing };
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
