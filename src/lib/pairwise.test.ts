import { describe, expect, it } from 'vitest';
import type { BarRating, PairwiseComparison } from '@/types/ratings';
import {
  TIER_BANDS,
  applyComparison,
  buildRankOrderForTier,
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
  it('use the agreed loved 8-10, liked 5-8, and pass 0-5 bands', () => {
    expect(TIER_BANDS).toEqual({
      loved: { lo: 8, hi: 10 },
      liked: { lo: 5, hi: 8 },
      pass: { lo: 0, hi: 5 },
    });
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

  it('interpolates ordered-list indices across the tier band', () => {
    const ratings: BarRating[] = [
      rating('a', 'liked'),
      rating('b', 'liked'),
      rating('c', 'liked'),
    ];
    const comparisons: PairwiseComparison[] = [
      comp('a', 'b'),
      comp('b', 'c'),
    ];
    const scores = computeScoresForTier(ratings, comparisons, 'liked');
    expect(scores.get('a')).toBe(8.0);
    expect(scores.get('b')).toBe(6.5);
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

describe('rank-order properties', () => {
  it('preserves every uninvolved bar relative order when a bar is inserted', () => {
    const ratings: BarRating[] = ['a', 'b', 'c', 'd', 'x'].map((barId) =>
      rating(barId, 'loved'),
    );
    const seed = [comp('a', 'b'), comp('b', 'c'), comp('c', 'd')];
    const before = buildRankOrderForTier(ratings, seed, 'loved');
    const after = buildRankOrderForTier(
      ratings,
      [...seed, comp('x', 'b')],
      'loved',
    );

    expect(before.orderedBarIds).toEqual(['a', 'b', 'c', 'd']);
    expect(after.orderedBarIds).toEqual(['a', 'x', 'b', 'c', 'd']);
    expect(after.orderedBarIds.filter((barId) => barId !== 'x')).toEqual(
      before.orderedBarIds,
    );
  });

  it('keeps every score inside its tier band, including unscored bars', () => {
    const ratings: BarRating[] = [
      rating('l1', 'loved'),
      rating('l2', 'loved'),
      rating('l0', 'loved'),
      rating('k1', 'liked'),
      rating('k2', 'liked'),
      rating('k0', 'liked'),
      rating('p1', 'pass'),
      rating('p2', 'pass'),
      rating('p0', 'pass'),
    ];
    const transcript = [
      comp('l1', 'l2'),
      comp('k1', 'k2'),
      comp('p1', 'p2'),
    ];

    for (const tier of ['loved', 'liked', 'pass'] as const) {
      const rankOrder = buildRankOrderForTier(ratings, transcript, tier);
      const band = TIER_BANDS[tier];
      for (const score of rankOrder.scores.values()) {
        expect(score).toBeGreaterThanOrEqual(band.lo);
        expect(score).toBeLessThanOrEqual(band.hi);
      }
      const unscoredId = { loved: 'l0', liked: 'k0', pass: 'p0' }[tier];
      expect(rankOrder.scores.get(unscoredId)).toBe(tierMidpoint(tier));
    }
  });

  it('prevents cross-tier inversion with compared and unscored bars', () => {
    const ratings: BarRating[] = [
      rating('loved-winner', 'loved'),
      rating('loved-loser', 'loved'),
      rating('loved-unscored', 'loved'),
      rating('liked-winner', 'liked'),
      rating('liked-loser', 'liked'),
      rating('liked-unscored', 'liked'),
      rating('pass-winner', 'pass'),
      rating('pass-loser', 'pass'),
      rating('pass-unscored', 'pass'),
    ];
    const transcript = [
      comp('loved-winner', 'loved-loser'),
      comp('liked-winner', 'liked-loser'),
      comp('pass-winner', 'pass-loser'),
    ];
    const loved = [...buildRankOrderForTier(ratings, transcript, 'loved').scores.values()];
    const liked = [...buildRankOrderForTier(ratings, transcript, 'liked').scores.values()];
    const pass = [...buildRankOrderForTier(ratings, transcript, 'pass').scores.values()];

    expect(Math.min(...loved)).toBeGreaterThanOrEqual(Math.max(...liked));
    expect(Math.min(...liked)).toBeGreaterThanOrEqual(Math.max(...pass));
  });

  it('replays the same append-only transcript idempotently', () => {
    const ratings: BarRating[] = ['a', 'b', 'c', 'd'].map((barId) =>
      rating(barId, 'loved'),
    );
    const transcript = [
      comp('a', 'b'),
      comp('b', 'c'),
      comp('c', 'a'),
      comp('d', 'a'),
    ];
    let incrementallyApplied = ratings;
    const prior: PairwiseComparison[] = [];
    for (const comparison of transcript) {
      incrementallyApplied = applyComparison(
        incrementallyApplied,
        prior,
        comparison,
      );
      prior.push(comparison);
    }

    const firstReplay = buildRankOrderForTier(ratings, transcript, 'loved');
    const secondReplay = buildRankOrderForTier(ratings, transcript, 'loved');
    expect(secondReplay.orderedBarIds).toEqual(firstReplay.orderedBarIds);
    expect(secondReplay.scores).toEqual(firstReplay.scores);
    expect(secondReplay.comparisonCounts).toEqual(
      firstReplay.comparisonCounts,
    );
    expect(
      new Map(incrementallyApplied.map((item) => [item.barId, item.score])),
    ).toEqual(firstReplay.scores);
  });

  it('derives one deterministic binary-insert order and comparison counts from a transcript', () => {
    const transcript = [
      comp('a', 'b'),
      comp('c', 'b'),
      comp('a', 'c'),
      comp('d', 'c'),
      comp('a', 'd'),
    ];
    const forwardRatings: BarRating[] = ['a', 'b', 'c', 'd', 'e'].map(
      (barId) => rating(barId, 'liked'),
    );
    const reverseRatings = forwardRatings.slice().reverse();
    const forward = buildRankOrderForTier(
      forwardRatings,
      transcript,
      'liked',
    );
    const reverse = buildRankOrderForTier(
      reverseRatings,
      transcript,
      'liked',
    );

    expect(forward.orderedBarIds).toEqual(['a', 'd', 'c', 'b']);
    expect(reverse.orderedBarIds).toEqual(forward.orderedBarIds);
    expect(forward.comparisonCounts).toEqual(
      new Map([
        ['a', 3],
        ['b', 2],
        ['c', 3],
        ['d', 2],
        ['e', 0],
      ]),
    );
    expect(forward.scores.get('e')).toBe(tierMidpoint('liked'));
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

  it('recomputes involved bars from their transcript-derived positions', () => {
    // Existing scores are not another source of truth: transcript order wins.
    const ratings: BarRating[] = [
      rating('a', 'loved', 8.0), // prior was the band floor
      rating('b', 'loved', 10.0), // prior was the band ceiling
    ];
    const next = applyComparison(ratings, [], comp('a', 'b'));
    const a = next.find((r) => r.barId === 'a');
    const b = next.find((r) => r.barId === 'b');
    expect(a?.score).toBe(10.0);
    expect(b?.score).toBe(8.0);
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

  it('preserves prior refinement for uninvolved same-tier bars', () => {
    const ratings: BarRating[] = [
      rating('a', 'loved', 9.0),
      rating('b', 'loved', 9.0),
      rating('c', 'loved', 10.0),
      rating('d', 'loved', 8.0),
    ];
    const next = applyComparison(ratings, [comp('c', 'd')], comp('a', 'b'));
    const c = next.find((r) => r.barId === 'c');
    const d = next.find((r) => r.barId === 'd');
    expect(c?.score).toBeGreaterThan(d?.score as number);
    expect(c?.score).not.toBe(tierMidpoint('loved'));
    expect(d?.score).not.toBe(tierMidpoint('loved'));
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
  it('keeps tier precedence when compared and unscored bars are mixed', () => {
    const ratings: BarRating[] = [
      rating('unscored-loved', 'loved'),
      rating('scored-liked', 'liked', 7.5),
      rating('unscored-liked', 'liked'),
      rating('scored-pass', 'pass', 5.0),
    ];
    const sorted = sortRatingsByScore(ratings);
    expect(sorted.map((item) => item.barId)).toEqual([
      'unscored-loved',
      'scored-liked',
      'unscored-liked',
      'scored-pass',
    ]);
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
