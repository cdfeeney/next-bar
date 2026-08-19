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
