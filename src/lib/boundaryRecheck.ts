/**
 * WHEN to ask the server again about a boundary only the server owns.
 *
 * Two surfaces re-read a server-owned instant on a timer — the recap's media
 * window (V8-R-NO-008) and the plan's voting deadline (V8-R-NO-005) — and both
 * had their own copy of this arithmetic. Round 8 fixed a defect in one copy and
 * left the other; round 9's panel then filed the SAME defect twice, once per
 * file. One copy is the fix: a rule that has to be applied in two places is a
 * rule that will be applied in one.
 *
 * The device clock chooses only WHEN to ask. It never decides which side of the
 * boundary we are on — that is the database's answer, which is the whole reason
 * these surfaces read a window or a predicate instead of comparing instants.
 */

/**
 * A second past the boundary, so the server has unambiguously crossed it by its
 * own clock when we ask.
 */
export const BOUNDARY_GRACE_MS = 1_000;

/**
 * The floor for a boundary this device believes is ALREADY BEHIND IT — the
 * disagreement case, where the answer cannot change until the server's own
 * clock catches up. One read a minute for as long as the two disagree, which
 * ends the moment the server crosses.
 *
 * It is NOT a floor on a boundary still ahead. Applying it there (round-9
 * panel, both files) made a boundary six seconds away wait a full minute, so
 * media controls and vote controls stayed on the wrong side of a boundary the
 * server had already passed for the best part of a minute. A future boundary is
 * waited for exactly.
 */
export const MIN_RECHECK_MS = 60_000;

/**
 * The longest single wait before the timer re-arms. `setTimeout` silently fires
 * immediately past ~24.8 days, so a far-future boundary is stepped towards
 * rather than handed over whole.
 */
export const MAX_REARM_MS = 6 * 60 * 60 * 1_000;

/**
 * How long to wait before re-reading the server's answer for a boundary at
 * `boundaryAt` (epoch ms).
 */
export function boundaryRecheckMs(
  boundaryAt: number,
  now: number = Date.now(),
): number {
  const delay = boundaryAt - now + BOUNDARY_GRACE_MS;
  return Math.min(delay > 0 ? delay : MIN_RECHECK_MS, MAX_REARM_MS);
}
