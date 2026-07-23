import { describe, expect, it } from 'vitest';
import type { BarRating, PairwiseComparison } from '@/types/ratings';
import {
  buildRankOrderForTier,
  computeScoresForTier,
  tierMidpoint,
} from '@/lib/pairwise';
import {
  answerComparison,
  insertPosition,
  skipSession,
  startInsertSession,
  type InsertSession,
} from '@/lib/insertFlow';

const AT = '2026-07-23T00:00:00.000Z';

function rating(
  barId: string,
  tier: 'loved' | 'liked' | 'pass',
  score?: number,
  ratedAt: string = AT,
): BarRating {
  return {
    barId,
    rating: tier,
    ratedAt,
    ...(score !== undefined ? { score } : {}),
  };
}

function comp(winnerBarId: string, loserBarId: string): PairwiseComparison {
  return { winnerBarId, loserBarId, comparedAt: AT };
}

/**
 * Deterministic LCG so property loops are reproducible — Math.random would
 * make a failing seed unrecoverable.
 */
function makeRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

/**
 * Build n loved-tier peers fully ordered by a prior comparison chain
 * (a0 > a1 > … > a(n-1)) with matching persisted scores, plus the new bar.
 */
function orderedFixture(n: number): {
  ratings: BarRating[];
  prior: PairwiseComparison[];
  peerIds: string[];
} {
  const peerIds = Array.from({ length: n }, (_, i) => `a${i}`);
  const prior: PairwiseComparison[] = [];
  for (let i = 0; i + 1 < n; i++) prior.push(comp(peerIds[i], peerIds[i + 1]));
  const scores = new Map(
    computeScoresForTier(
      peerIds.map((id) => rating(id, 'loved')),
      prior,
      'loved',
    ),
  );
  const ratings = [
    ...peerIds.map((id) => rating(id, 'loved', scores.get(id))),
    rating('new-bar', 'loved'),
  ];
  return { ratings, prior, peerIds };
}

/** Drive a session to completion, answering via `pickNewBarWins(step)`. */
function runSession(
  start: InsertSession,
  pickNewBarWins: (step: number) => boolean,
): { session: InsertSession; answers: PairwiseComparison[] } {
  let session = start;
  const answers: PairwiseComparison[] = [];
  let guard = 0;
  while (!session.done && session.probeBarId !== null) {
    if (guard++ > 50) throw new Error('session failed to terminate');
    const winnerId = pickNewBarWins(session.step)
      ? session.barId
      : session.probeBarId;
    const result = answerComparison(session, winnerId, AT);
    if (result.comparison) answers.push(result.comparison);
    session = result.session;
  }
  return { session, answers };
}

describe('startInsertSession', () => {
  it('orders candidates by effective rank (score desc) excluding the new bar', () => {
    const { ratings, prior } = orderedFixture(4);
    const session = startInsertSession(ratings, prior, 'new-bar', 'loved');
    expect(session.candidates).toEqual(['a0', 'a1', 'a2', 'a3']);
    expect(session.candidates).not.toContain('new-bar');
  });

  it('probes the midpoint of the candidate list first', () => {
    const { ratings, prior } = orderedFixture(4);
    const session = startInsertSession(ratings, prior, 'new-bar', 'loved');
    // Window [0, 4] → probe index floor(4/2) = 2.
    expect(session.probeBarId).toBe('a2');
    expect(session.done).toBe(false);
    expect(session.step).toBe(0);
  });

  it('includes unordered peers (no comparisons yet) as candidates', () => {
    const ratings = [
      rating('u1', 'liked', undefined, '2026-07-22T00:00:00.000Z'),
      rating('u2', 'liked', undefined, '2026-07-21T00:00:00.000Z'),
      rating('new-bar', 'liked'),
    ];
    const session = startInsertSession(ratings, [], 'new-bar', 'liked');
    // Both peers sit at the band midpoint → recency tiebreak (newer first).
    expect(session.candidates).toEqual(['u1', 'u2']);
    expect(session.probeBarId).toBe('u2');
  });

  it('is done immediately when the tier has no peers', () => {
    const session = startInsertSession(
      [rating('new-bar', 'loved')],
      [],
      'new-bar',
      'loved',
    );
    expect(session.done).toBe(true);
    expect(session.probeBarId).toBeNull();
    expect(session.maxSteps).toBe(0);
  });

  it('is done immediately for tier="pass" (Q2 — no Pass-vs-Pass ordering)', () => {
    const ratings = [
      rating('p1', 'pass'),
      rating('p2', 'pass'),
      rating('new-bar', 'pass'),
    ];
    const session = startInsertSession(ratings, [], 'new-bar', 'pass');
    expect(session.done).toBe(true);
    expect(session.probeBarId).toBeNull();
  });

  it('caps maxSteps at min(ceil(log2(n+1)), 7)', () => {
    for (const [n, expected] of [
      [1, 1],
      [2, 2],
      [3, 2],
      [4, 3],
      [7, 3],
      [8, 4],
      [200, 7],
    ] as const) {
      const { ratings, prior } = orderedFixture(n);
      const session = startInsertSession(ratings, prior, 'new-bar', 'loved');
      expect(session.maxSteps).toBe(expected);
    }
  });
});

describe('answerComparison', () => {
  it('produces the persistable comparison with correct winner and loser', () => {
    const { ratings, prior } = orderedFixture(3);
    const session = startInsertSession(ratings, prior, 'new-bar', 'loved');
    const probe = session.probeBarId as string;
    const { comparison } = answerComparison(session, 'new-bar', AT);
    expect(comparison).toEqual({
      winnerBarId: 'new-bar',
      loserBarId: probe,
      comparedAt: AT,
    });
  });

  it('halves the window upward on a win (next probe ranks higher)', () => {
    const { ratings, prior } = orderedFixture(4);
    const start = startInsertSession(ratings, prior, 'new-bar', 'loved');
    expect(start.probeBarId).toBe('a2');
    const { session } = answerComparison(start, 'new-bar', AT);
    // Window [0, 2] → probe index 1.
    expect(session.probeBarId).toBe('a1');
    expect(session.done).toBe(false);
    expect(session.step).toBe(1);
  });

  it('halves the window downward on a loss (next probe ranks lower)', () => {
    const { ratings, prior } = orderedFixture(4);
    const start = startInsertSession(ratings, prior, 'new-bar', 'loved');
    const { session } = answerComparison(start, 'a2', AT);
    // Window [3, 4] → probe index 3.
    expect(session.probeBarId).toBe('a3');
    expect(session.done).toBe(false);
  });

  it('finishes when the window collapses', () => {
    const { ratings, prior } = orderedFixture(1);
    const start = startInsertSession(ratings, prior, 'new-bar', 'loved');
    const { session } = answerComparison(start, 'new-bar', AT);
    expect(session.done).toBe(true);
    expect(session.probeBarId).toBeNull();
    expect(insertPosition(session)).toBe(0);
  });

  it('ignores a winner id that is neither the new bar nor the probe', () => {
    const { ratings, prior } = orderedFixture(3);
    const session = startInsertSession(ratings, prior, 'new-bar', 'loved');
    const result = answerComparison(session, 'ghost', AT);
    expect(result.comparison).toBeNull();
    expect(result.session).toBe(session);
  });

  it('is a no-op on an already-done session', () => {
    const session = startInsertSession(
      [rating('new-bar', 'loved')],
      [],
      'new-bar',
      'loved',
    );
    const result = answerComparison(session, 'new-bar', AT);
    expect(result.comparison).toBeNull();
    expect(result.session).toBe(session);
  });

  it('never mutates the input session', () => {
    const { ratings, prior } = orderedFixture(4);
    const start = startInsertSession(ratings, prior, 'new-bar', 'loved');
    const snapshot = JSON.parse(JSON.stringify(start));
    answerComparison(start, 'new-bar', AT);
    expect(JSON.parse(JSON.stringify(start))).toEqual(snapshot);
  });
});

describe('skipSession', () => {
  it('skip before any answer leaves the bar at the tier midpoint', () => {
    const { ratings, prior } = orderedFixture(3);
    const start = startInsertSession(ratings, prior, 'new-bar', 'loved');
    const skipped = skipSession(start);
    expect(skipped.done).toBe(true);
    expect(skipped.skipped).toBe(true);
    expect(skipped.answers).toHaveLength(0);
    // No comparisons recorded → replay of the untouched transcript scores
    // the new bar at the band midpoint.
    const scores = computeScoresForTier(ratings, prior, 'loved');
    expect(scores.get('new-bar')).toBe(tierMidpoint('loved'));
  });

  it('preserves already-answered comparisons (they stay persisted)', () => {
    const { ratings, prior } = orderedFixture(4);
    const start = startInsertSession(ratings, prior, 'new-bar', 'loved');
    const { session: mid } = answerComparison(start, 'new-bar', AT);
    const skipped = skipSession(mid);
    expect(skipped.done).toBe(true);
    expect(skipped.answers).toHaveLength(1);
  });
});

describe('conflict flag', () => {
  it('flags a session whose answer the transcript replay contradicts, and ends it', () => {
    // Persisted scores say a > b, but the prior transcript says b > a — a
    // stale-score divergence. Candidates order (from scores) disagrees with
    // replay order, so consistent-looking answers can contradict replay.
    const ratings = [
      rating('a', 'loved', 9.9),
      rating('b', 'loved', 9.5),
      rating('x', 'loved'),
    ];
    const prior = [comp('b', 'a')];
    const start = startInsertSession(ratings, prior, 'x', 'loved');
    expect(start.candidates).toEqual(['a', 'b']);
    expect(start.probeBarId).toBe('b');

    // x > b: replay puts x above b → consistent so far.
    const first = answerComparison(start, 'x', AT);
    expect(first.session.conflicted).toBe(false);
    expect(first.session.probeBarId).toBe('a');

    // a > x: replay moves x below a, which sits below b → the earlier
    // "x > b" answer is now contradicted → conflicted, ended gracefully.
    const second = answerComparison(first.session, 'a', AT);
    expect(second.session.conflicted).toBe(true);
    expect(second.session.done).toBe(true);
    // The answer is STILL recorded — replay's later-wins handles it.
    expect(second.comparison).toEqual({
      winnerBarId: 'a',
      loserBarId: 'x',
      comparedAt: AT,
    });
    expect(second.session.answers).toHaveLength(2);
  });
});

describe('session properties', () => {
  it('terminates within min(ceil(log2(n))+1, 7) answers for n = 1..20', () => {
    const rng = makeRng(42);
    for (let n = 1; n <= 20; n++) {
      for (let trial = 0; trial < 10; trial++) {
        const { ratings, prior } = orderedFixture(n);
        const start = startInsertSession(ratings, prior, 'new-bar', 'loved');
        const { session } = runSession(start, () => rng() < 0.5);
        const bound = Math.min(Math.ceil(Math.log2(n)) + 1, 7);
        expect(session.done).toBe(true);
        expect(session.step).toBeLessThanOrEqual(bound);
        expect(session.answers.length).toBe(session.step);
      }
    }
  });

  it('hard-caps a 200-candidate session at 7 answers', () => {
    const rng = makeRng(7);
    const { ratings, prior } = orderedFixture(200);
    const start = startInsertSession(ratings, prior, 'new-bar', 'loved');
    const { session } = runSession(start, () => rng() < 0.5);
    expect(session.done).toBe(true);
    expect(session.step).toBeLessThanOrEqual(7);
  });

  it('final insert position matches the transcript replay of the answers', () => {
    const rng = makeRng(1234);
    for (let n = 1; n <= 12; n++) {
      for (let trial = 0; trial < 10; trial++) {
        const { ratings, prior, peerIds } = orderedFixture(n);
        const start = startInsertSession(ratings, prior, 'new-bar', 'loved');
        const { session, answers } = runSession(start, () => rng() < 0.5);
        if (session.conflicted || session.step >= 7) continue;

        const replay = buildRankOrderForTier(
          ratings,
          [...prior, ...answers],
          'loved',
        );
        const replayIndex = replay.orderedBarIds.indexOf('new-bar');
        expect(replayIndex).toBe(insertPosition(session));
        // Sanity: peers keep their relative order.
        expect(
          replay.orderedBarIds.filter((id) => id !== 'new-bar'),
        ).toEqual(peerIds);
      }
    }
  });

  it('replay honors every answer even against unordered peers', () => {
    const rng = makeRng(99);
    for (let trial = 0; trial < 20; trial++) {
      // No prior transcript: every candidate is unordered (midpoint).
      const ratings = [
        rating('u1', 'liked', undefined, '2026-07-22T03:00:00.000Z'),
        rating('u2', 'liked', undefined, '2026-07-22T02:00:00.000Z'),
        rating('u3', 'liked', undefined, '2026-07-22T01:00:00.000Z'),
        rating('new-bar', 'liked'),
      ];
      const start = startInsertSession(ratings, [], 'new-bar', 'liked');
      const { session, answers } = runSession(start, () => rng() < 0.5);
      if (session.conflicted) continue;

      const replay = buildRankOrderForTier(ratings, answers, 'liked');
      const indexOf = (id: string) => replay.orderedBarIds.indexOf(id);
      for (const answer of answers) {
        expect(indexOf(answer.winnerBarId)).toBeGreaterThanOrEqual(0);
        expect(indexOf(answer.winnerBarId)).toBeLessThan(
          indexOf(answer.loserBarId),
        );
      }
    }
  });

  it('is deterministic: identical inputs and answers produce identical sessions', () => {
    const { ratings, prior } = orderedFixture(6);
    const answerPattern = (step: number) => step % 2 === 0;
    const runA = runSession(
      startInsertSession(ratings, prior, 'new-bar', 'loved'),
      answerPattern,
    );
    const runB = runSession(
      startInsertSession(ratings, prior, 'new-bar', 'loved'),
      answerPattern,
    );
    expect(runA.session).toEqual(runB.session);
    expect(runA.answers).toEqual(runB.answers);
  });
});
