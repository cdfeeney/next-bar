import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { NIGHT_ROLLOVER_HOUR } from './nightKey';
import {
  MIGRATIONS_DIR,
  committedFunctionBody,
  definingMigration,
  sqlView,
} from './effectiveMigration';

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

    /**
     * EXACTLY ONE DEFINITION, AND IT IS THE timestamptz ONE (round-10 round 2,
     * Codex). `committedFunctionBody` returns the LAST definition of the name
     * in the file, and `definingMigration` resolves by NAME, not by signature.
     * So a migration that first moved `nyc_night_key(timestamptz)` to six hours
     * and then added a `date` overload carrying the expected four-hour body
     * would satisfy the expression check below while every real call — which
     * passes a timestamptz or no argument at all — used the wrong boundary.
     *
     * Asserting the count rather than trying to parse overloads is deliberate:
     * this function has exactly one signature today, a second one is a decision
     * somebody should have to make on purpose, and a test that fails and says
     * why is a better answer here than a resolver that tries to be clever.
     */
    const raw = readFileSync(path.join(MIGRATIONS_DIR, file as string), 'utf8')
      .replace(/\r\n/g, '\n');
    const headers = sqlView(raw).skeleton.match(
      /create\s+(or\s+replace\s+)?function\s+public\.nyc_night_key\s*\(/g,
    ) ?? [];
    expect(headers.length, `${file} must define nyc_night_key exactly once`).toBe(1);
    expect(
      sqlView(raw).skeleton,
      `${file} must define the timestamptz signature, not another overload`,
    ).toMatch(/public\.nyc_night_key\s*\(\s*p_at\s+timestamptz/);

    const body = committedFunctionBody(file as string, 'nyc_night_key');
    expect(body, `could not read the nyc_night_key body out of ${file}`).not.toBeNull();

    /**
     * THE COMMENT-FREE VIEW, and the WHOLE expression (round-10 panel, both
     * lanes). Two holes closed here, both of which let the boundary move while
     * this test stayed green.
     *
     * `committedFunctionBody` returns the RAW body, comments included, so
     * `- make_interval(hours => 6)  -- was interval '4 hours'` satisfied a
     * `toContain` on the 4-hour text and even a count of interval literals,
     * because the only match was inside the comment. `sqlView(...).code` strips
     * comments and keeps literal contents, which is exactly the view this
     * assertion needs.
     *
     * And matching fragments could not see the SIGN: `+ interval '4 hours'`
     * passed every previous assertion while advancing the date around 8:00 PM.
     * So the whole normalised expression is compared, derived from the constant
     * so the two halves cannot drift. Any redefinition of this function now
     * fails here and has to be re-derived deliberately — which, for the one
     * expression the entire night boundary rests on, is the point.
     */
    const flat = sqlView(body as string).code.replace(/\s+/g, ' ').trim();
    expect(flat, `${file}'s nyc_night_key body is not the D-C-39 expression`).toBe(
      `select (((p_at at time zone 'America/New_York') - interval '${NIGHT_ROLLOVER_HOUR} hours'))::date`,
    );
    // 30s, not the 5s default: `definingMigration` reads and skeletonises every
    // .sql file in the directory once, cold, and 0066 alone is larger than the
    // whole chain before it. Measured at ~2.4s alone and ~6.8s with the lane's
    // other suites running in parallel workers, so the default fails under load
    // while the assertion itself is fine. A slow read is not a red contract.
  }, 30_000);
});
