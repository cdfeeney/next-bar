import { describe, expect, it } from 'vitest';
import {
  MIN_COHORT_FOR_TIERS,
  SUGGESTED_CAP,
  stableSuggestions,
  suggestedCount,
} from './suggestedTier';

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

/**
 * Highlight stability. Found independently by two reviewers: ranking inside the
 * filtered cohort meant narrowing could swap most of the glowing pins, so the
 * map "jumped" for an action that should only remove bars.
 */
describe('stableSuggestions', () => {
  it('keeps previously-highlighted survivors instead of re-picking from scratch', () => {
    const previous = ['a', 'b', 'c'];
    // The ranker would rather have x and y, but a and b are still eligible.
    const ranked = ['x', 'y', 'a', 'b'];
    expect(stableSuggestions(previous, ranked, 2)).toEqual(['a', 'b']);
  });

  it('drops only the survivors that no longer qualify', () => {
    // `b` filtered out; `a` and `c` survive.
    expect(stableSuggestions(['a', 'b', 'c'], ['a', 'c', 'z'], 3)).toEqual(['a', 'c', 'z']);
  });

  it('tops up from the current ranking when survivors fall short of budget', () => {
    expect(stableSuggestions(['a'], ['a', 'p', 'q'], 3)).toEqual(['a', 'p', 'q']);
  });

  it('never exceeds the budget, even with many survivors', () => {
    expect(stableSuggestions(['a', 'b', 'c', 'd'], ['a', 'b', 'c', 'd'], 2)).toEqual(['a', 'b']);
  });

  it('never emits a duplicate', () => {
    const out = stableSuggestions(['a', 'a'], ['a', 'b'], 2);
    expect(new Set(out).size).toBe(out.length);
  });

  it('is a no-op at zero budget — a cohort too small for a tier stays untiered', () => {
    expect(stableSuggestions(['a', 'b'], ['a', 'b'], 0)).toEqual([]);
  });

  it('narrowing only ever REMOVES highlights, never swaps them for strangers', () => {
    const wide = ['w1', 'w2', 'w3', 'w4'];
    // Cohort narrows: w2 and w4 survive, plus a newly-eligible bar.
    const narrowRanked = ['n1', 'w4', 'w2'];
    const out = stableSuggestions(wide, narrowRanked, 2);
    // Both slots go to survivors — the stranger n1 does NOT displace them.
    expect(out).toEqual(['w2', 'w4']);
  });
});

it('is idempotent — safe to re-run on its own output (React StrictMode double-invoke)', () => {
  // The map feeds the previous result back in via a ref that is updated inside
  // a useMemo. StrictMode calls that factory twice with the same inputs, so the
  // second call receives the FIRST call's output as `previous`. If that were
  // not a fixed point, the highlighted set would differ between renders.
  const ranked = ['a', 'b', 'c', 'd'];
  const once = stableSuggestions(['b', 'z'], ranked, 3);
  const twice = stableSuggestions(once, ranked, 3);
  expect(twice).toEqual(once);
});

/**
 * The window. A reviewer built the repro these pin: with plain cohort
 * membership as the eligibility test, a highlight could persist forever once
 * the caller started ranking the whole cohort — a bar that stopped being a good
 * answer kept glowing until some unrelated hard filter removed it.
 */
describe('stableSuggestions — the stability window', () => {
  it('drops a survivor that has fallen far down the ranking, with no hard filter involved', () => {
    // `stale` is still in the cohort, but now ranks 20th of 20.
    const ranked = Array.from({ length: 19 }, (_, i) => `r${i}`).concat('stale');
    const out = stableSuggestions(['stale'], ranked, 2);
    expect(out).not.toContain('stale');
    expect(out).toEqual(['r0', 'r1']);
  });

  it('keeps a survivor that only slipped a little — ordinary jitter must not blink highlights', () => {
    // budget 2, window 3 → eligible = top 6. `kept` sits 5th, inside it.
    const ranked = ['a', 'b', 'c', 'd', 'kept', 'f', 'g', 'h'];
    expect(stableSuggestions(['kept'], ranked, 2)).toEqual(['kept', 'a']);
  });

  it('the window is a multiple of the budget, so a bigger tier tolerates more slip', () => {
    const ranked = Array.from({ length: 40 }, (_, i) => `r${i}`);
    // budget 10 → window covers the top 30; r25 survives.
    expect(stableSuggestions(['r25'], ranked, 10)).toContain('r25');
    // budget 1 → window covers only the top 3; r25 does not.
    expect(stableSuggestions(['r25'], ranked, 1)).not.toContain('r25');
  });

  it('is still a fixed point with the window applied', () => {
    const ranked = ['a', 'b', 'c', 'd', 'e', 'f'];
    const once = stableSuggestions(['c', 'z'], ranked, 2);
    expect(stableSuggestions(once, ranked, 2)).toEqual(once);
  });
});
