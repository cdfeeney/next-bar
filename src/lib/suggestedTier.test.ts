import { describe, expect, it } from 'vitest';
import { MIN_COHORT_FOR_TIERS, SUGGESTED_CAP, suggestedCount } from './suggestedTier';

/**
 * Goal g-44007df6, acceptance criterion 3: map prominence must recompute from
 * the ACTIVE MAP INTENT over the FILTERED set — and "the suggested tier must not
 * degenerate".
 *
 * Degeneracy is the real risk once filtering feeds ranking: filter down to eight
 * bars, rank them, mark the top ten "suggested", and every marker on the map is
 * now glowing. The tier stops meaning anything at exactly the moment the user
 * has narrowed hardest, which is when they were paying most attention.
 */
describe('suggestedCount', () => {
  it('marks nothing when the cohort is empty', () => {
    expect(suggestedCount(0)).toBe(0);
  });

  it('marks nothing when a single bar matches — "1 of 1 is special" says nothing', () => {
    expect(suggestedCount(1)).toBe(0);
  });

  it('marks nothing for a cohort too small for a tier to carry information', () => {
    for (let n = 0; n < MIN_COHORT_FOR_TIERS; n += 1) {
      expect(suggestedCount(n), `cohort ${n}`).toBe(0);
    }
  });

  it('marks a strict minority for a small-but-real cohort', () => {
    const n = 5;
    const picked = suggestedCount(n);
    expect(picked).toBeGreaterThan(0);
    expect(picked).toBeLessThan(n); // never "all of them"
  });

  it('caps at SUGGESTED_CAP for a large cohort rather than scaling forever', () => {
    expect(suggestedCount(50)).toBe(SUGGESTED_CAP);
    expect(suggestedCount(975)).toBe(SUGGESTED_CAP);
  });

  it('never marks the whole cohort, at any size', () => {
    for (const n of [0, 1, 2, 3, 4, 5, 9, 10, 11, 40, 100, 975]) {
      expect(suggestedCount(n), `cohort ${n}`).toBeLessThan(Math.max(n, 1));
    }
  });

  it('is monotonic — narrowing the filter never marks MORE bars', () => {
    let prev = 0;
    for (let n = 0; n <= 120; n += 1) {
      const cur = suggestedCount(n);
      expect(cur, `cohort ${n}`).toBeGreaterThanOrEqual(prev);
      prev = cur;
    }
  });
});
