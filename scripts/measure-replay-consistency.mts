/**
 * One-off measurement (N6 eval calibration): how often does the insertion-
 * based replay contradict the latest row of a pair, for (a) random-order
 * truthful transcripts, (b) session-shaped transcripts, (c) 10%-noise?
 * Run: npx tsx scripts/measure-replay-consistency.mts
 */
import { buildRankOrderForTier } from '../src/lib/pairwise';
import type { BarRating, PairwiseComparison } from '../src/types/ratings';

const AT = '2026-07-25T00:00:00.000Z';
function makeRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}
const ratingsFor = (ids: string[]): BarRating[] =>
  ids.map((barId) => ({ barId, rating: 'loved', ratedAt: AT }));
const comp = (w: string, l: string): PairwiseComparison => ({
  winnerBarId: w,
  loserBarId: l,
  comparedAt: AT,
});

function violationRate(ordered: string[], rows: PairwiseComparison[]): number {
  const index = new Map(ordered.map((id, i) => [id, i]));
  const latest = new Map<string, PairwiseComparison>();
  for (const row of rows)
    latest.set([row.winnerBarId, row.loserBarId].sort().join('|'), row);
  const list = [...latest.values()];
  if (!list.length) return 0;
  let bad = 0;
  for (const row of list) {
    const w = index.get(row.winnerBarId);
    const l = index.get(row.loserBarId);
    if (w === undefined || l === undefined || w > l) bad++;
  }
  return bad / list.length;
}

function stats(label: string, rates: number[]): void {
  rates.sort((a, b) => a - b);
  const mean = rates.reduce((a, b) => a + b, 0) / rates.length;
  console.log(
    `${label}: mean=${mean.toFixed(3)} p50=${rates[Math.floor(rates.length * 0.5)].toFixed(3)} p95=${rates[Math.floor(rates.length * 0.95)].toFixed(3)} max=${rates[rates.length - 1].toFixed(3)}`,
  );
}

// (a) random-order truthful
{
  const rng = makeRng(20260725);
  const rates: number[] = [];
  for (let t = 0; t < 500; t++) {
    const n = 4 + Math.floor(rng() * 12);
    const ids = Array.from({ length: n }, (_, i) => `b${i}`);
    const order = [...ids].sort(() => rng() - 0.5);
    const rows: PairwiseComparison[] = [];
    for (let k = 0; k < n * 3; k++) {
      const i = Math.floor(rng() * n);
      let j = Math.floor(rng() * n);
      if (j === i) j = (j + 1) % n;
      const [hi, lo] = i < j ? [i, j] : [j, i];
      rows.push(comp(order[hi], order[lo]));
    }
    rates.push(
      violationRate(
        buildRankOrderForTier(ratingsFor(ids), rows, 'loved').orderedBarIds,
        rows,
      ),
    );
  }
  stats('random-order truthful', rates);
}

// (b) session-shaped: each new bar binary-searched into the current replayed order
{
  const rng = makeRng(4242);
  const rates: number[] = [];
  for (let t = 0; t < 500; t++) {
    const n = 4 + Math.floor(rng() * 12);
    const ids = Array.from({ length: n }, (_, i) => `b${i}`);
    const trueRank = new Map(
      [...ids].sort(() => rng() - 0.5).map((id, i) => [id, i]),
    );
    const rows: PairwiseComparison[] = [];
    const ratings = ratingsFor(ids);
    for (const id of ids) {
      // current ordered chain
      const { orderedBarIds } = buildRankOrderForTier(ratings, rows, 'loved');
      const chain = orderedBarIds.filter((x) => x !== id);
      let lo = 0;
      let hi = chain.length;
      while (lo < hi) {
        const probe = chain[Math.floor((lo + hi) / 2)];
        const newWins = trueRank.get(id)! < trueRank.get(probe)!;
        rows.push(newWins ? comp(id, probe) : comp(probe, id));
        if (newWins) hi = Math.floor((lo + hi) / 2);
        else lo = Math.floor((lo + hi) / 2) + 1;
      }
    }
    rates.push(
      violationRate(
        buildRankOrderForTier(ratings, rows, 'loved').orderedBarIds,
        rows,
      ),
    );
  }
  stats('session-shaped truthful', rates);
}
