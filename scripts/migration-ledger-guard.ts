/**
 * migration-ledger-guard.ts — the pure half of the "unappliable migration" check.
 *
 * `scripts/apply-migration-set.ts` refuses any migration that does not sort
 * ABOVE the ledger head. So a branch that forked before trunk advanced can
 * commit, review, merge and ship a migration that is permanently unappliable by
 * the approved path, and nothing says so until someone tries to apply it. This
 * moves that discovery to CI.
 *
 * Kept free of `pg`, `dotenv` and process state on purpose: the interesting
 * logic is arithmetic over two lists of filenames, and it is worth testing
 * without a database. `check-migration-ledger.ts` is the I/O half.
 */

/** `0052_night_outs_my_invites.sql` — a leading number, an underscore, `.sql`. */
const MIGRATION_FILE = /^(\d+)_.*\.sql$/;

/**
 * The convention this guard's arithmetic silently depends on: FOUR digits.
 *
 * `apply-migration-set.ts` decides appliability LEXICALLY (`entry.name <= head`,
 * over a head read as `order by name desc limit 1`); this module decides it
 * numerically. Those two orders coincide only while every prefix is the same
 * width, so one `60_foo.sql` applied against head `0059` breaks the
 * correspondence for good: afterwards apply refuses `0061_bar.sql` ('0061' sorts
 * below '60_') while `findUnappliable` sees 61 > 60 and says nothing.
 */
const CONVENTIONAL_FILE = /^\d{4}_.*\.sql$/;

export type Unappliable = {
  /** The offending file, as it is named in `supabase/migrations/`. */
  name: string;
  /** Its numeric prefix. */
  number: number;
  /** The ledger head it lost to. */
  head: number;
};

/** The numeric prefix of a migration filename, or null if it is not one. */
export function migrationNumber(name: string): number | null {
  const match = MIGRATION_FILE.exec(name);
  return match ? Number.parseInt(match[1], 10) : null;
}

/**
 * The highest numeric prefix PRESENT in the ledger — never a row count, and
 * never an assumption that the numbers are contiguous. The live ledger has real
 * holes (0038-0040 absent; 0055/0056 reserved by another branch and applied
 * nowhere) and a hole is not an error.
 *
 * Returns null when no head can be established, which callers must treat as
 * "could not verify" rather than "nothing to check".
 */
export function ledgerHead(ledgerNames: readonly string[]): number | null {
  const numbers = ledgerNames
    .map(migrationNumber)
    .filter((value): value is number => value !== null);
  return numbers.length > 0 ? Math.max(...numbers) : null;
}

/**
 * Every migration file that can never reach the database by the approved path:
 * numbered at or below the ledger head AND absent from the ledger. Both
 * conditions are required — a below-head file that IS in the ledger is the
 * normal, correct state of every historical migration.
 */
export function findUnappliable(
  files: readonly string[],
  ledgerNames: readonly string[],
): Unappliable[] {
  const head = ledgerHead(ledgerNames);
  if (head === null) return [];
  const applied = new Set(ledgerNames);
  const unappliable: Unappliable[] = [];
  for (const name of files) {
    const number = migrationNumber(name);
    if (number === null) continue;
    if (number > head) continue;
    if (applied.has(name)) continue;
    unappliable.push({ name, number, head });
  }
  return unappliable;
}

/** The failure message: the file, the head it lost to, and the remedy. */
export function describeUnappliable({ name, number, head }: Unappliable): string {
  return (
    `${name} is numbered ${String(number).padStart(4, '0')}, at or below the serving `
    + `ledger head ${String(head).padStart(4, '0')}, and its filename is not in `
    + 'public.schema_migrations. apply-migration-set.ts will refuse it, so it can '
    + 'never reach the database by the approved path.\n'
    + `    Remedy: renumber it above ${String(head).padStart(4, '0')} — but ONLY if it is `
    + 'genuinely unapplied. If this file IS already live under a different ledger row, '
    + 'renaming it breaks the ledger-to-filename correspondence the reverts depend on; '
    + 'reconcile the ledger instead.'
  );
}

/**
 * Every `.sql` file whose name does not follow `NNNN_name.sql`. Callers must
 * treat these as violations rather than skip them: `findUnappliable` cannot
 * reason about a file whose prefix width breaks the numeric/lexical
 * correspondence, and silently ignoring one is how the guard goes blind.
 */
export function findMisnamed(files: readonly string[]): string[] {
  return files.filter((name) => name.endsWith('.sql') && !CONVENTIONAL_FILE.test(name));
}

/**
 * Every LEDGER row that does not follow `NNNN_name.sql` — with no `.sql`
 * precondition, which is the whole reason this is not `findMisnamed`.
 *
 * That precondition exists on the file side to skip directory entries like
 * `README.md`. On the ledger side it would be a hole: `apply-migration-set.ts`
 * takes its head as `order by name desc limit 1` over ALL rows, so a suffix-less
 * row such as `manual-fix-2026` becomes its head while this module's
 * `migrationNumber` returns null for it and `ledgerHead` ignores it entirely.
 * Apply would then refuse every future four-digit migration while the guard
 * stayed green. A ledger row we cannot order is a ledger we cannot trust.
 */
export function findUnconventionalRows(ledgerNames: readonly string[]): string[] {
  return ledgerNames.filter((name) => !CONVENTIONAL_FILE.test(name));
}
