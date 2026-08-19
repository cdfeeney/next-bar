import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Which committed migration currently STATES a given function.
 *
 * Test-support only — nothing in the app imports this. It lives here rather
 * than inside one test file because two suites need the same answer and must
 * not drift: `nightOutsMigration.test.ts` reads the resolved file's TEXT, and
 * `nightOutsRls.live.test.ts` asserts that same file is in the serving
 * database's `public.schema_migrations` ledger. A copy in each would let the
 * static guard read one file while the ledger check vouched for another.
 */

export const MIGRATIONS_DIR = path.join(__dirname, '..', '..', 'supabase', 'migrations');

/**
 * The functions whose effective SQL the static ordering guard reads.
 *
 * ONE list, because there were three: the inline literals in
 * nightOutsMigration.test.ts and two hand-kept copies in
 * nightOutsRls.live.test.ts (the signature pin and the ledger check). Adding a
 * fifth name to the static guard left both live controls silently covering four
 * of five, with nothing failing — the same remember-to-update-the-pointer
 * failure this module was extracted to end (round-2 review, Claude, medium).
 * Both live tests are now keyed on this array, so a name added here without a
 * signature entry fails to type-check.
 */
export const GUARDED_FUNCTIONS = [
  'respond_night_out',
  'join_night_out_by_token',
  'decline_night_out_by_token',
  'night_out_seat_count',
] as const;

export type GuardedFunction = (typeof GUARDED_FUNCTIONS)[number];

/**
 * Where `name` is stated in `sql`, or -1. Both statement forms are checked:
 * 0059 states get_night_out as `drop function` + plain `create function`, not
 * `create or replace`, so looking only for the latter would miss it. The open
 * paren is part of the match so get_night_out cannot hit get_night_out_board.
 */
export function definitionIndex(sql: string, name: string): number {
  for (const form of [
    `create or replace function public.${name}(`,
    `create function public.${name}(`,
  ]) {
    const at = sql.indexOf(form);
    if (at > -1) return at;
  }
  return -1;
}

/**
 * The filename of the highest-numbered COMMITTED migration that states `name`,
 * or null when nothing does.
 *
 * This is derived rather than hard-coded on purpose. Every previous version of
 * this lookup named its file literally, and the pointer went stale twice as
 * respond_night_out moved 0046 -> 0048 -> 0059 — each time leaving the ordering
 * invariants asserting against dead text with the suite green, which is the one
 * failure they exist to prevent (round-2 review, Claude, medium). A 0060
 * re-stating any of these functions now moves the guard by itself.
 *
 * What it resolves is the last file in the COMMITTED stream, which is the text
 * the database runs only when that stream is fully applied. This repo routinely
 * carries migrations numbered above the live ledger head (0059 says so in its
 * own header), so the forward direction is a real gap in the static guard, not
 * a hypothetical one — the ledger assertion in nightOutsRls.live.test.ts is
 * what closes it, on the one run that can see a database (round-1 review,
 * Claude, medium).
 *
 * Resolution is by NAME only. It cannot tell one overload from another, nor a
 * real removal from the routine drop of a superseded overload — both need
 * argument-type comparison, which text matching does not do. The control for
 * that is the live catalog probe in nightOutsRls.live.test.ts, which pins the
 * exact overload set of every name resolved here against pg_proc.
 */
export function definingMigration(name: string): string | null {
  // Files only: `revert/` is a subdirectory and its rollback text must never be
  // mistaken for the effective definition. Names are zero-padded, so lexical
  // order is numeric order.
  const defining = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .filter((f) => definitionIndex(
      readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8').toLowerCase(),
      name,
    ) > -1);
  return defining.length ? defining[defining.length - 1] : null;
}

/**
 * The checksum public.schema_migrations records for a migration.
 *
 * NORMALISED, not raw bytes, and that is not a shortcut. The rows in the live
 * ledger were written by nb-overnight's runner via `checksum()` in
 * src/lib/migrationPlan.ts, which LF-normalises and strips trailing whitespace
 * precisely because this repo is developed on Windows with core.autocrlf: the
 * same file hashes differently on two checkouts, and a raw-byte hash would
 * report drift on every one of them.
 *
 * Measured against the serving staging ledger on 2026-08-19 before this was
 * written: hashing raw bytes matches 0 of 55 rows, and 0048/0057/0059 all
 * DIFFER. Normalised, all 35 rows whose file exists on this branch match and
 * none drift — the other 20 name files that live on other branches. So a
 * raw-byte comparison here would be a permanently red test, not a stricter one.
 *
 * This branch also carries scripts/apply-migration-set.ts, which hashes raw
 * bytes. It is NOT what wrote these rows. Do not take its algorithm as the
 * ledger's.
 */
export function migrationChecksum(file: string): string {
  const sql = readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8')
    .replace(/\r\n/g, '\n')
    .replace(/\s+$/, '');
  return createHash('sha256').update(sql, 'utf8').digest('hex');
}
