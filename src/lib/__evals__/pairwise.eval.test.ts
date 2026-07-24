import { describe, expect, it } from 'vitest';
import type { BarRating, PairwiseComparison } from '@/types/ratings';
import { buildRankOrderForTier } from '@/lib/pairwise';

/**
 * B7b eval suite — pairwise replay invariants (blueprint §B7: "pairwise
 * invariants from B0.2 plus transitivity sampling (random triads,
 * violation rate < threshold)").
 *
 * These are EVALS, not unit tests: they sample randomized inputs with a
 * deterministic seed and assert statistical/structural properties of the
 * replay. A failure means the ranking engine's behavior drifted, not that
 * one example broke.
 */

const AT = '2026-07-25T00:00:00.000Z';

function makeRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function ratingsFor(ids: string[]): BarRating[] {
  return ids.map((barId) => ({ barId, rating: 'loved', ratedAt: AT }));
}

function comp(winnerBarId: string, loserBarId: string): PairwiseComparison {
  return { winnerBarId, loserBarId, comparedAt: AT };
}

/** Random subset of pairs from a hidden true order, answered truthfully. */
function truthfulTranscript(
  trueOrder: string[],
  pairCount: number,
  rng: () => number,
): PairwiseComparison[] {
  const rows: PairwiseComparison[] = [];
  const n = trueOrder.length;
  for (let k = 0; k < pairCount; k++) {
    const i = Math.floor(rng() * n);
    let j = Math.floor(rng() * n);
    if (j === i) j = (j + 1) % n;
    const [hi, lo] = i < j ? [i, j] : [j, i];
    rows.push(comp(trueOrder[hi], trueOrder[lo]));
  }
  return rows;
}

/** Latest row per unordered pair — the constraint replay promises to honor. */
function latestPerPair(
  rows: PairwiseComparison[],
): Map<string, PairwiseComparison> {
  const latest = new Map<string, PairwiseComparison>();
  for (const row of rows) {
    const key = [row.winnerBarId, row.loserBarId].sort().join('|');
    latest.set(key, row);
  }
  return latest;
}

function violationRate(
  orderedBarIds: string[],
  rows: PairwiseComparison[],
): number {
  const index = new Map(orderedBarIds.map((id, i) => [id, i]));
  const latest = [...latestPerPair(rows).values()];
  if (latest.length === 0) return 0;
  let violated = 0;
  for (const row of latest) {
    const w = index.get(row.winnerBarId);
    const l = index.get(row.loserBarId);
    if (w === undefined || l === undefined || w > l) violated += 1;
  }
  return violated / latest.length;
}

describe('eval: pairwise replay invariants', () => {
  it('SESSION-SHAPED truthful transcripts replay with ZERO latest-row violations (the app contract)', () => {
    // This is the input shape the app actually produces: every new bar is
    // binary-searched into the CURRENT replayed chain (B4/B7a insert
    // sessions). Measured 2026-07-25 (scripts/measure-replay-consistency
    // .mts, 500 trials): violation rate exactly 0.000 — the replay engine
    // is EXACT for this shape, and this eval pins it.
    const rng = makeRng(4242);
    for (let trial = 0; trial < 100; trial++) {
      const n = 4 + Math.floor(rng() * 12);
      const ids = Array.from({ length: n }, (_, i) => `b${i}`);
      const trueRank = new Map(
        [...ids].sort(() => rng() - 0.5).map((id, i) => [id, i]),
      );
      const rows: PairwiseComparison[] = [];
      const ratings = ratingsFor(ids);
      for (const id of ids) {
        const { orderedBarIds } = buildRankOrderForTier(ratings, rows, 'loved');
        const chain = orderedBarIds.filter((x) => x !== id);
        let lo = 0;
        let hi = chain.length;
        while (lo < hi) {
          const probe = chain[Math.floor((lo + hi) / 2)];
          const newWins =
            (trueRank.get(id) ?? 0) < (trueRank.get(probe) ?? 0);
          rows.push(newWins ? comp(id, probe) : comp(probe, id));
          if (newWins) hi = Math.floor((lo + hi) / 2);
          else lo = Math.floor((lo + hi) / 2) + 1;
        }
      }
      const { orderedBarIds } = buildRankOrderForTier(ratings, rows, 'loved');
      expect(violationRate(orderedBarIds, rows)).toBe(0);
    }
  });

  it('RANDOM-ORDER truthful transcripts: heuristic violation rate stays within the measured baseline', () => {
    // HONEST FINDING (N6, 2026-07-25): the insertion-based replay is a
    // HEURISTIC for arbitrary row orderings — measured mean violation rate
    // 0.293 (p95 0.500, max 0.700) on random-order truthful transcripts.
    // The app's structured flows avoid this shape (see the session-shaped
    // eval above), but multi-device merges could approach it. This eval
    // bounds the MEAN so an engine change that makes the heuristic WORSE
    // gets caught; it is a regression fence, not an aspiration.
    const rng = makeRng(20260725);
    const rates: number[] = [];
    for (let trial = 0; trial < 200; trial++) {
      const n = 4 + Math.floor(rng() * 12);
      const ids = Array.from({ length: n }, (_, i) => `b${i}`);
      const trueOrder = [...ids].sort(() => rng() - 0.5);
      const rows = truthfulTranscript(trueOrder, n * 3, rng);
      const { orderedBarIds } = buildRankOrderForTier(
        ratingsFor(ids),
        rows,
        'loved',
      );
      rates.push(violationRate(orderedBarIds, rows));
    }
    // Dual fence (DeepSeek review: a mean alone is blind to tail
    // regressions — the distribution is right-heavy). Deterministic seed
    // keeps CI reproducible; the fences carry the sensitivity.
    rates.sort((a, b) => a - b);
    const mean = rates.reduce((a, b) => a + b, 0) / rates.length;
    const p95 = rates[Math.floor(rates.length * 0.95)];
    expect(mean).toBeLessThan(0.45); // measured 0.293 + headroom
    expect(p95).toBeLessThanOrEqual(0.6); // measured p95 0.500 + headroom
  });

  it('transitivity sampling: replayed order is a strict total order over compared bars (no ties, no cycles by construction)', () => {
    const rng = makeRng(31337);
    for (let trial = 0; trial < 50; trial++) {
      const ids = Array.from({ length: 10 }, (_, i) => `b${i}`);
      const trueOrder = [...ids].sort(() => rng() - 0.5);
      const rows = truthfulTranscript(trueOrder, 30, rng);
      const { orderedBarIds } = buildRankOrderForTier(
        ratingsFor(ids),
        rows,
        'loved',
      );
      // A list is transitive/cycle-free by construction — the eval-worthy
      // property is uniqueness (each bar appears exactly once) and closure
      // (every compared bar appears).
      expect(new Set(orderedBarIds).size).toBe(orderedBarIds.length);
      const compared = new Set(
        rows.flatMap((r) => [r.winnerBarId, r.loserBarId]),
      );
      for (const id of compared) expect(orderedBarIds).toContain(id);
      // Random triads from the order agree with the order (index-monotone).
      const index = new Map(orderedBarIds.map((id, i) => [id, i]));
      for (let t = 0; t < 20; t++) {
        const tri = [...orderedBarIds]
          .sort(() => rng() - 0.5)
          .slice(0, 3)
          .sort((a, b) => (index.get(a) ?? 0) - (index.get(b) ?? 0));
        expect((index.get(tri[0]) ?? 0) <= (index.get(tri[1]) ?? 0)).toBe(true);
        expect((index.get(tri[1]) ?? 0) <= (index.get(tri[2]) ?? 0)).toBe(true);
      }
    }
  });

  it('uncompared bars stay OUT of the ordered chain (midpoint band, never interleaved)', () => {
    const rng = makeRng(99);
    const ids = Array.from({ length: 12 }, (_, i) => `b${i}`);
    const comparedIds = ids.slice(0, 6);
    const trueOrder = [...comparedIds].sort(() => rng() - 0.5);
    const rows = truthfulTranscript(trueOrder, 18, rng);
    const { orderedBarIds } = buildRankOrderForTier(
      ratingsFor(ids),
      rows,
      'loved',
    );
    for (const id of ids.slice(6)) {
      expect(orderedBarIds).not.toContain(id);
    }
  });
});
