import { describe, expect, test } from 'vitest';
import {
  BOUNDARY_GRACE_MS,
  MAX_REARM_MS,
  MIN_RECHECK_MS,
  boundaryRecheckMs,
} from './boundaryRecheck';

/**
 * THE FLOOR BELONGS TO ONE CASE, NOT TO EVERY DELAY (round-9 panel, filed
 * against both copies of this arithmetic).
 *
 * `Math.max(delay, MIN_RECHECK_MS)` read as "never poll faster than once a
 * minute" and behaved as "never notice a boundary sooner than a minute". A
 * media window opening in five seconds, or a voting deadline five seconds
 * away, was re-read after sixty — so Add-a-photo, Archive, Suggest, Vote and
 * Remove all sat on the wrong side of a boundary the server had already
 * crossed for the best part of a minute, and the first tap in that window was
 * refused rather than the surface having gone read-only.
 */

const NOW = Date.parse('2026-08-28T22:00:00.000Z');

describe('boundaryRecheckMs', () => {
  test('waits for a near-future boundary exactly, not for a minute', () => {
    expect(boundaryRecheckMs(NOW + 5_000, NOW)).toBe(5_000 + BOUNDARY_GRACE_MS);
  });

  test('a boundary a minute out is still just that boundary plus the grace', () => {
    expect(boundaryRecheckMs(NOW + 90_000, NOW)).toBe(90_000 + BOUNDARY_GRACE_MS);
  });

  test('a boundary already behind this device falls back to the floor', () => {
    // The disagreement case: the answer cannot change until the server's own
    // clock catches up, so asking faster than once a minute buys nothing.
    expect(boundaryRecheckMs(NOW - 30_000, NOW)).toBe(MIN_RECHECK_MS);
  });

  test('a boundary within the grace of now also takes the floor', () => {
    // Exactly on the boundary: grace alone would fire a millisecond later and
    // spin against a server that has not moved.
    expect(boundaryRecheckMs(NOW - BOUNDARY_GRACE_MS, NOW)).toBe(MIN_RECHECK_MS);
  });

  test('a far-future boundary is stepped towards, never handed over whole', () => {
    // setTimeout silently fires immediately past ~24.8 days.
    expect(boundaryRecheckMs(NOW + 40 * 24 * 60 * 60 * 1_000, NOW)).toBe(MAX_REARM_MS);
  });
});
