import { describe, expect, it } from 'vitest';
import { NIGHT_ROLLOVER_HOUR } from './nightKey';
import { committedFunctionBody, definingMigration } from './effectiveMigration';

/**
 * ONE ROLLOVER HOUR, ASSERTED IN THE LOCAL GATE.
 *
 * The night boundary is **4:00 AM America/New_York** — contract 3.1.0, decision
 * `D-C-39`, signed in `docs/V8-TRACEABILITY-LEDGER.json`. Two definitions serve
 * it: `NIGHT_ROLLOVER_HOUR` here in the client, and `public.nyc_night_key()` in
 * SQL, whose LAST-DEFINING migration is the one the database runs.
 *
 * WHY A STATIC TEST WHEN A BEHAVIORAL ONE EXISTS. `nightOutsRls.live.test.ts`
 * already asserts the four contract instants through the real function and
 * checks the client helper against it at each one — but that suite needs a live
 * database and is an attended gate. So nothing in the runnable gate noticed when
 * the two halves disagreed, and a round-10 directive proposed re-introducing a
 * 6-hour SQL body on the strength of a reading of `05:00 EDT → 2026-08-17` as a
 * defect. Under a 4:00 AM rollover that answer is CORRECT, and it is the very
 * case the live suite pins ("05:00 EDT — already the new night at 4am"). This
 * file makes the next such attempt fail in `npm test` instead of in staging.
 *
 * It reads the migration TEXT, not a database, so it holds in a credential-less
 * worktree. What it cannot prove is what was applied; that stays the live
 * suite's job.
 */
describe('the night rollover has exactly one hour on both sides', () => {
  it('the client boundary is 4, per D-C-39', () => {
    expect(NIGHT_ROLLOVER_HOUR).toBe(4);
  });

  it('the last migration to define nyc_night_key subtracts the same 4 hours', () => {
    const file = definingMigration('nyc_night_key');
    expect(file, 'no migration defines nyc_night_key').not.toBeNull();

    const body = committedFunctionBody(file as string, 'nyc_night_key');
    expect(body, `could not read the nyc_night_key body out of ${file}`).not.toBeNull();

    const flat = (body as string).replace(/\s+/g, ' ');
    expect(flat, `${file} must subtract the contract's ${NIGHT_ROLLOVER_HOUR} hours`).toContain(
      `interval '${NIGHT_ROLLOVER_HOUR} hours'`,
    );
    // The other half: no OTHER interval hides in the same body. Without this a
    // file could satisfy the line above and still shift the boundary elsewhere.
    const intervals = flat.match(/interval '\d+ hours'/g) ?? [];
    expect(intervals, `${file} states more than one hour offset`).toEqual([
      `interval '${NIGHT_ROLLOVER_HOUR} hours'`,
    ]);
    // And it is New York that is being offset, never UTC.
    expect(flat).toContain("at time zone 'America/New_York'");
    // 30s, not the 5s default: `definingMigration` reads and skeletonises every
    // .sql file in the directory once, cold, and 0066 alone is larger than the
    // whole chain before it. Measured at ~2.4s alone and ~6.8s with the lane's
    // other suites running in parallel workers, so the default fails under load
    // while the assertion itself is fine. A slow read is not a red contract.
  }, 30_000);
});
