import { describe, expect, it } from 'vitest';
import type { BarRating, PairwiseComparison } from '@/types/ratings';
import {
  MAX_DELTA_PER_EVENT,
  TIER_BANDS,
  applyComparison,
  computeScoresForTier,
  pickComparisonTarget,
  roundScore,
  sortRatingsByScore,
  tierMidpoint,
} from '@/lib/pairwise';

function rating(barId: string, tier: 'loved' | 'liked' | 'pass', score?: number): BarRating {
  return {
    barId,
    rating: tier,
    ratedAt: '2026-05-20T00:00:00.000Z',
    ...(score !== undefined ? { score } : {}),
  };
}

function comp(winnerBarId: string, loserBarId: string): PairwiseComparison {
  return {
    winnerBarId,
    loserBarId,
    comparedAt: '2026-05-20T00:00:00.000Z',
  };
}

describe('tier bands', () => {
  it('are ordered Loved > Liked > Pass without overlap', () => {
    expect(TIER_BANDS.loved.lo).toBeGreaterThan(TIER_BANDS.liked.hi);
    expect(TIER_BANDS.liked.lo).toBeGreaterThan(TIER_BANDS.pass.hi);
  });

  it('tierMidpoint returns the band center rounded to one decimal', () => {
    expect(tierMidpoint('loved')).toBe(9.0);
    expect(tierMidpoint('liked')).toBe(6.5);
    expect(tierMidpoint('pass')).toBe(2.5);
  });
});

describe('roundScore', () => {
  it('quantizes to one decimal', () => {
    expect(roundScore(8.04)).toBe(8.0);
    expect(roundScore(8.05)).toBe(8.1);
    expect(roundScore(9.999)).toBe(10.0);
    expect(roundScore(0)).toBe(0);
  });
});

describe('pickComparisonTarget', () => {
  const ratings: BarRating[] = [
    rating('a', 'loved'),
    rating('b', 'loved'),
    rating('c', 'loved'),
    rating('d', 'liked'),
    rating('e', 'pass'),
  ];

  it('returns null for tier="pass" (Q2 — no Pass-vs-Pass ordering)', () => {
    expect(pickComparisonTarget(ratings, [], 'a', 'pass')).toBeNull();
  });

  it('returns null when no same-tier peer exists', () => {
    // Only 'd' is in 'liked' and we just rated 'd'; nothing to compare against.
    expect(pickComparisonTarget(ratings, [], 'd', 'liked')).toBeNull();
  });

  it('excludes the just-rated bar from candidates', () => {
    const target = pickComparisonTarget(ratings, [], 'a', 'loved', () => 0);
    expect(target).not.toBe('a');
    expect(target === 'b' || target === 'c').toBe(true);
  });

  it('prefers peers with the fewest existing comparisons', () => {
    // 'b' has 2 comparisons, 'c' has 0 — c should be picked even though
    // random=0 would otherwise pick the first eligible.
    const comparisons: PairwiseComparison[] = [comp('a', 'b'), comp('b', 'd')];
    expect(
      pickComparisonTarget(ratings, comparisons, 'a', 'loved', () => 0),
    ).toBe('c');
  });

  it('tiebreaks randomly among equal-count peers using the injected RNG', () => {
    // 'b' and 'c' both have 0 comparisons. random=0 → first, random=0.99 → last.
    const first = pickComparisonTarget(ratings, [], 'a', 'loved', () => 0);
    const last = pickComparisonTarget(ratings, [], 'a', 'loved', () => 0.99);
    expect([first, last].sort()).toEqual(['b', 'c']);
  });
});

describe('computeScoresForTier', () => {
  it('assigns the tier midpoint when no comparisons exist', () => {
    const ratings: BarRating[] = [
      rating('a', 'loved'),
      rating('b', 'loved'),
    ];
    const scores = computeScoresForTier(ratings, [], 'loved');
    expect(scores.get('a')).toBe(9.0);
    expect(scores.get('b')).toBe(9.0);
  });

  it('puts a perfect winner at the band ceiling and a perfect loser at the floor', () => {
    const ratings: BarRating[] = [
      rating('a', 'loved'),
      rating('b', 'loved'),
    ];
    const scores = computeScoresForTier(ratings, [comp('a', 'b')], 'loved');
    expect(scores.get('a')).toBe(10.0);
    expect(scores.get('b')).toBe(8.0);
  });

  it('uses winrate proportionally — 2 wins + 1 loss = band.lo + 2/3 * span', () => {
    const ratings: BarRating[] = [
      rating('a', 'liked'),
      rating('b', 'liked'),
      rating('c', 'liked'),
    ];
    const comparisons: PairwiseComparison[] = [
      comp('a', 'b'),
      comp('a', 'c'),
      comp('b', 'a'),
    ];
    const scores = computeScoresForTier(ratings, comparisons, 'liked');
    // 'a': 2 wins, 1 loss → 2/3 winrate → 5.0 + (2/3) * 2.9 = ~6.93 → 6.9
    expect(scores.get('a')).toBe(6.9);
    // 'b': 1 win, 1 loss → 50% → 5.0 + 0.5 * 2.9 = 6.45 → 6.5
    expect(scores.get('b')).toBe(6.5);
    // 'c': 0 wins, 1 loss → 0% → 5.0
    expect(scores.get('c')).toBe(5.0);
  });

  it('ignores comparisons that involve a bar outside the tier', () => {
    const ratings: BarRating[] = [
      rating('a', 'loved'),
      rating('b', 'loved'),
      rating('c', 'liked'),
    ];
    // Cross-tier comparison should not affect Loved's internal scores.
    const scores = computeScoresForTier(ratings, [comp('a', 'c')], 'loved');
    expect(scores.get('a')).toBe(9.0);
    expect(scores.get('b')).toBe(9.0);
  });

  it('returns scores only for bars rated in the requested tier', () => {
    const ratings: BarRating[] = [
      rating('a', 'loved'),
      rating('b', 'liked'),
    ];
    const scores = computeScoresForTier(ratings, [], 'loved');
    expect([...scores.keys()]).toEqual(['a']);
  });
});

describe('applyComparison', () => {
  it('does not mutate the input array or any of its entries', () => {
    const ratings: BarRating[] = [
      rating('a', 'loved', 9.0),
      rating('b', 'loved', 9.0),
    ];
    const snapshot = JSON.parse(JSON.stringify(ratings));
    const next = applyComparison(ratings, [], comp('a', 'b'));
    expect(ratings).toEqual(snapshot);
    expect(next).not.toBe(ratings);
  });

  it('moves the winner up and the loser down within the band', () => {
    const ratings: BarRating[] = [
      rating('a', 'loved', 9.0),
      rating('b', 'loved', 9.0),
    ];
    const next = applyComparison(ratings, [], comp('a', 'b'));
    const a = next.find((r) => r.barId === 'a');
    const b = next.find((r) => r.barId === 'b');
    expect(a?.score).toBeGreaterThan(9.0);
    expect(b?.score).toBeLessThan(9.0);
  });

  it('clamps |delta| ≤ MAX_DELTA_PER_EVENT for the two involved bars (R8)', () => {
    // Start with extreme prior scores so the "ideal" is far away.
    const ratings: BarRating[] = [
      rating('a', 'loved', 8.0), // prior was the band floor
      rating('b', 'loved', 10.0), // prior was the band ceiling
    ];
    // Single comparison a > b → ideal would flip them: a=10, b=8.
    // Delta for 'a' is +2.0 → clamped to +1.0 → a=9.0.
    // Delta for 'b' is -2.0 → clamped to -1.0 → b=9.0.
    const next = applyComparison(ratings, [], comp('a', 'b'));
    const a = next.find((r) => r.barId === 'a');
    const b = next.find((r) => r.barId === 'b');
    expect(a?.score).toBe(roundScore(8.0 + MAX_DELTA_PER_EVENT));
    expect(b?.score).toBe(roundScore(10.0 - MAX_DELTA_PER_EVENT));
  });

  it('starts from the tier midpoint when an involved bar has no prior score', () => {
    const ratings: BarRating[] = [
      rating('a', 'loved'), // no score yet
      rating('b', 'loved'), // no score yet
    ];
    const next = applyComparison(ratings, [], comp('a', 'b'));
    const a = next.find((r) => r.barId === 'a');
    const b = next.find((r) => r.barId === 'b');
    // Midpoint is 9.0; ideal post-comparison is a=10, b=8.
    // Delta=+1.0 / -1.0 stays within clamp, so we land exactly at the ideal.
    expect(a?.score).toBe(10.0);
    expect(b?.score).toBe(8.0);
  });

  it('updates uninvolved same-tier bars to the new ideal without clamping', () => {
    // 'c' is in the same tier but wasn't part of this comparison. Its ideal
    // score may shift if the comparison graph changes its winrate — passive
    // recompute shouldn't lag behind.
    const ratings: BarRating[] = [
      rating('a', 'loved', 9.0),
      rating('b', 'loved', 9.0),
      rating('c', 'loved', 9.0),
    ];
    const next = applyComparison(ratings, [], comp('a', 'b'));
    const c = next.find((r) => r.barId === 'c');
    // 'c' has 0 wins, 0 losses → still midpoint (9.0). No shift.
    expect(c?.score).toBe(9.0);
  });

  it('leaves bars in other tiers untouched (referential equality preserved)', () => {
    const lovedA = rating('a', 'loved', 9.0);
    const lovedB = rating('b', 'loved', 9.0);
    const likedC = rating('c', 'liked', 6.5);
    const next = applyComparison(
      [lovedA, lovedB, likedC],
      [],
      comp('a', 'b'),
    );
    expect(next.find((r) => r.barId === 'c')).toBe(likedC);
  });

  it('is a no-op when winner or loser is not in the ratings list', () => {
    const ratings: BarRating[] = [rating('a', 'loved', 9.0)];
    const next = applyComparison(ratings, [], comp('a', 'ghost'));
    expect(next).toHaveLength(1);
    expect(next[0].score).toBe(9.0);
  });

  it('is a no-op when winner and loser are in different tiers', () => {
    const ratings: BarRating[] = [
      rating('a', 'loved', 9.0),
      rating('b', 'liked', 6.5),
    ];
    const next = applyComparison(ratings, [], comp('a', 'b'));
    expect(next.find((r) => r.barId === 'a')?.score).toBe(9.0);
    expect(next.find((r) => r.barId === 'b')?.score).toBe(6.5);
  });
});

describe('sortRatingsByScore', () => {
  it('puts scored bars above unscored bars regardless of tier', () => {
    // A scored Liked bar should rank above an unscored Loved bar — scoring
    // is the user's authoritative ordering once it exists.
    const ratings: BarRating[] = [
      rating('unscored-loved', 'loved'),
      rating('scored-liked', 'liked', 7.5),
    ];
    const sorted = sortRatingsByScore(ratings);
    expect(sorted[0].barId).toBe('scored-liked');
    expect(sorted[1].barId).toBe('unscored-loved');
  });

  it('sorts scored bars by score descending', () => {
    const ratings: BarRating[] = [
      rating('a', 'loved', 9.5),
      rating('b', 'loved', 10.0),
      rating('c', 'loved', 8.5),
    ];
    expect(sortRatingsByScore(ratings).map((r) => r.barId)).toEqual([
      'b',
      'a',
      'c',
    ]);
  });

  it('falls back to tier-then-recency among unscored bars', () => {
    const ratings: BarRating[] = [
      { barId: 'a', rating: 'pass', ratedAt: '2026-05-20T00:00:00.000Z' },
      { barId: 'b', rating: 'loved', ratedAt: '2026-05-19T00:00:00.000Z' },
      { barId: 'c', rating: 'loved', ratedAt: '2026-05-20T00:00:00.000Z' },
      { barId: 'd', rating: 'liked', ratedAt: '2026-05-21T00:00:00.000Z' },
    ];
    expect(sortRatingsByScore(ratings).map((r) => r.barId)).toEqual([
      'c',
      'b',
      'd',
      'a',
    ]);
  });

  it('does not mutate input', () => {
    const ratings: BarRating[] = [
      rating('a', 'loved', 9.0),
      rating('b', 'loved', 10.0),
    ];
    const before = [...ratings];
    sortRatingsByScore(ratings);
    expect(ratings).toEqual(before);
  });
});
