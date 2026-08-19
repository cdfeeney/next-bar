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
  'night_out_is_full_by_token',
] as const;

export type GuardedFunction = (typeof GUARDED_FUNCTIONS)[number];

/**
 * Where `name` is stated in `sql`, or -1.
 *
 * `create or replace` is optional because 0059 states get_night_out as
 * `drop function` + a plain `create function`. The schema qualifier is optional
 * and the whitespace is a run, because this used to be two exact byte-sequences:
 * a newline after `function`, two spaces, or a bare `create function
 * respond_night_out(` all returned -1, and definingMigration then resolved
 * BACKWARDS to the previous file and asserted against dead text with nothing
 * failing (round-3 review, Claude, medium). The open paren is still required so
 * get_night_out cannot hit get_night_out_board.
 */
export function definitionIndex(sql: string, name: string): number {
  return sql.search(
    new RegExp(String.raw`create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?${name}\s*\(`),
  );
}

/**
 * True when `sql` names `name` in something that looks like a definition but is
 * not one this module can read.
 *
 * A near-miss must be LOUD. Silently skipping the file is what let the resolver
 * walk backwards to superseded text; refusing is the fail-closed answer, and a
 * file that merely CALLS the function is not a near miss.
 */
export function looksLikeUnreadableDefinition(sql: string, name: string): boolean {
  if (definitionIndex(sql, name) > -1) return false;
  return new RegExp(String.raw`create\s+(?:or\s+replace\s+)?function[^;]{0,200}?${name}`).test(sql);
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
  const defining: string[] = [];
  for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()) {
    const sql = readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8').toLowerCase();
    if (definitionIndex(sql, name) > -1) defining.push(file);
    else if (looksLikeUnreadableDefinition(sql, name)) {
      throw new Error(
        `${file} appears to define ${name} in a form this resolver cannot read. `
        + 'Refusing rather than resolving to an older file, which would guard dead text.',
      );
    }
  }
  return defining.length ? defining[defining.length - 1] : null;
}

/**
 * The checksum public.schema_migrations records for a migration.
 *
 * NORMALISED — LF-normalise, strip trailing whitespace — and that is not a
 * shortcut. It is what the ledger actually holds. The repo is developed on
 * Windows with core.autocrlf, so the same file hashes differently on two
 * checkouts and a raw-byte hash reports drift on every one of them.
 *
 * MEASURED, not assumed. Read directly from the serving staging ledger
 * (2026-08-19T02:00Z, the evening of 2026-08-18 local) before this function was
 * written, over all 55 schema_migrations rows: normalised matched all 35 rows
 * whose file exists on this branch with ZERO drift; raw bytes matched ZERO of
 * 35. The decisive single row is 0044_night_outs.sql, whose recorded checksum is
 * 3514e43e… — the normalised hash of the committed file, not its raw hash
 * (5578e1af…). The remaining 20 rows name files that live only on other
 * branches.
 *
 * TWO COMMITTED CLAIMS ARE WRONG ABOUT THIS, both in the same direction, and
 * both were written by comparing raw bytes to a normalised ledger:
 *   - scripts/apply-migration-set.ts said raw bytes were "the convention the
 *     existing ledger already uses (verified against 0044's recorded row)".
 *     0044's row is exactly what disproves it. That script now calls this
 *     function, so the two cannot drift apart again (round-3 review, Claude,
 *     medium: an apply through it would have written rows this gate rejects).
 *   - CLAUDE.md said eleven 0000–0010 files "differ from the checksums recorded
 *     in the live ledger". Under the ledger's own algorithm they do not: all
 *     eleven are present and all eleven match. Corrected there.
 */
export function migrationChecksum(file: string): string {
  const sql = readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8')
    .replace(/\r\n/g, '\n')
    .replace(/\s+$/, '');
  return createHash('sha256').update(sql, 'utf8').digest('hex');
}
