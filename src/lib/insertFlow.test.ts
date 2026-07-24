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
  it('B7a: stale-score divergence no longer conflicts — candidates come from replay, not scores', () => {
    // Persisted scores say a > b, but the prior transcript says b > a. The
    // pre-B7a session ordered candidates by SCORE and this exact scenario
    // ended conflicted. Dynamic candidates order by REPLAY, so the session
    // asks questions in the order replay will honor — no conflict, exact
    // slot.
    const ratings = [
      rating('a', 'loved', 9.9),
      rating('b', 'loved', 9.5),
      rating('x', 'loved'),
    ];
    const prior = [comp('b', 'a')];
    const start = startInsertSession(ratings, prior, 'x', 'loved');
    // Replay order, not score order.
    expect(start.candidates).toEqual(['b', 'a']);
    expect(start.probeBarId).toBe('a');

    // x > a → window narrows above a; next probe is b.
    const first = answerComparison(start, 'x', AT);
    expect(first.session.conflicted).toBe(false);
    expect(first.session.probeBarId).toBe('b');

    // b > x → x lands exactly between b and a. No contradiction anywhere.
    const second = answerComparison(first.session, 'b', AT);
    expect(second.session.conflicted).toBe(false);
    expect(second.session.done).toBe(true);
    expect(insertPosition(second.session)).toBe(1);

    // The replayed chain agrees with the converged slot.
    const { orderedBarIds } = buildRankOrderForTier(
      ratings,
      [...prior, ...second.session.answers],
      'loved',
    );
    expect(orderedBarIds).toEqual(['b', 'x', 'a']);
  });

  it('a mind-change history (repeated pair, opposite outcomes) is NOT a conflict — later row wins, like replay', () => {
    // Prior: chain a > b, then b > x, then the user changed their mind:
    // x > b. Replay resolves cleanly to a > x > b. The window must honor
    // only the LATEST row per pair (Opus B7a review) — folding both rows
    // produced a spurious lo > hi conflict.
    const ratings = [
      rating('a', 'loved', 9),
      rating('b', 'loved', 8),
      rating('x', 'loved'),
    ];
    const prior = [comp('a', 'b'), comp('b', 'x'), comp('x', 'b')];
    const start = startInsertSession(ratings, prior, 'x', 'loved');
    expect(start.conflicted).toBe(false);
    // The x-vs-b relation is pinned (x above b); only x-vs-a is open.
    expect(start.done).toBe(false);
    expect(start.probeBarId).toBe('a');
  });

  it('contradictory PRIOR rows involving the bar end the session conflicted at start', () => {
    // Prior transcript: b > a (chain), x > b (x above the chain) AND
    // a > x (x below the chain) — impossible window (lo > hi).
    const ratings = [
      rating('a', 'loved'),
      rating('b', 'loved'),
      rating('x', 'loved'),
    ];
    const prior = [comp('b', 'a'), comp('x', 'b'), comp('a', 'x')];
    const start = startInsertSession(ratings, prior, 'x', 'loved');
    expect(start.done).toBe(true);
    expect(start.conflicted).toBe(true);
    expect(start.probeBarId).toBeNull();
  });
});

describe('B7a dynamic candidates', () => {
  it("Codex's u1/u2/u3 interleave case: unordered peers are never probed and cannot sit inside the probed window", () => {
    // Ordered chain a > b > c (transcript) + unordered u1/u2/u3 whose
    // midpoint scores interleave with the chain in the DISPLAYED sort.
    // Pre-B7a the session probed by displayed order, so u's could tie or
    // interleave past the probed window and the slot went approximate.
    const mid = tierMidpoint('loved');
    const ratings = [
      rating('a', 'loved', 10),
      rating('b', 'loved', mid + 0.1),
      rating('u1', 'loved', mid),
      rating('u2', 'loved', mid),
      rating('u3', 'loved', mid),
      rating('c', 'loved', mid - 0.1),
      rating('x', 'loved'),
    ];
    const prior = [comp('a', 'b'), comp('b', 'c')];
    const start = startInsertSession(ratings, prior, 'x', 'loved');

    // Probe set = the replay-ordered chain ONLY.
    expect(start.candidates).toEqual(['a', 'b', 'c']);

    // Drive every possible answer path; no probe may ever be an unordered
    // peer, and the converged slot must equal x's replayed position within
    // the ordered chain.
    for (let mask = 0; mask < 8; mask++) {
      let session = start;
      let bit = 0;
      while (!session.done && session.probeBarId !== null) {
        expect(['a', 'b', 'c']).toContain(session.probeBarId);
        const newBarWins = ((mask >> bit) & 1) === 1;
        bit += 1;
        session = answerComparison(
          session,
          newBarWins ? 'x' : session.probeBarId,
          AT,
        ).session;
      }
      expect(session.conflicted).toBe(false);

      const { orderedBarIds } = buildRankOrderForTier(
        ratings,
        [...prior, ...session.answers],
        'loved',
      );
      // x's replayed position among the ordered chain = the session slot.
      const chainPositions = orderedBarIds.filter((id) =>
        ['a', 'b', 'c', 'x'].includes(id),
      );
      expect(chainPositions.indexOf('x')).toBe(insertPosition(session));
      // The u's remain unordered — outside the replayed chain entirely.
      for (const u of ['u1', 'u2', 'u3']) {
        expect(orderedBarIds).not.toContain(u);
      }
    }
  });

  it('pure bootstrap: an all-unordered tier probes one peer, orders it, and stops', () => {
    const ratings = [
      rating('u1', 'loved'),
      rating('u2', 'loved'),
      rating('u3', 'loved'),
      rating('x', 'loved'),
    ];
    const start = startInsertSession(ratings, [], 'x', 'loved');
    // Bootstrap probe set: every peer (no chain exists yet).
    expect(start.candidates).toEqual(['u1', 'u2', 'u3']);
    expect(start.probeBarId).not.toBeNull();

    const probed = start.probeBarId as string;
    const result = answerComparison(start, 'x', AT);
    // After one answer an order EXISTS (x > probed) — the remaining
    // unordered peers leave the probe set and the window collapses.
    expect(result.session.done).toBe(true);
    expect(result.session.conflicted).toBe(false);
    expect(result.session.candidates).toEqual([probed]);
    expect(insertPosition(result.session)).toBe(0);
  });

  it('bootstrap probe joins the chain and the session continues on ordered peers only', () => {
    // One ordered pair (a > b) + unordered u1. Start probes the chain;
    // u1 never enters.
    const ratings = [
      rating('a', 'loved', 9),
      rating('b', 'loved', 8),
      rating('u1', 'loved'),
      rating('x', 'loved'),
    ];
    const prior = [comp('a', 'b')];
    let session = startInsertSession(ratings, prior, 'x', 'loved');
    expect(session.candidates).toEqual(['a', 'b']);
    while (!session.done && session.probeBarId !== null) {
      expect(session.probeBarId).not.toBe('u1');
      session = answerComparison(session, session.probeBarId, AT).session;
    }
    expect(session.conflicted).toBe(false);
  });

  it('n ≥ 128: the 7-probe cap leaves placement EXPLICITLY approximate (window wider than one slot)', () => {
    // 300 ordered candidates → 301 slots. Seven halvings cannot resolve a
    // single slot (2^7 = 128 < 301): the session must end at the cap with
    // a window still wider than one slot, not conflicted — approximate
    // placement is the POLICY, and replay lands inside the final window.
    const { ratings, prior } = orderedFixture(300);
    const start = startInsertSession(ratings, prior, 'new-bar', 'loved');
    expect(start.maxSteps).toBe(7);

    // Alternate answers to keep the window interior (worst case-ish).
    let session = start;
    let flip = false;
    while (!session.done && session.probeBarId !== null) {
      session = answerComparison(
        session,
        flip ? 'new-bar' : session.probeBarId,
        AT,
      ).session;
      flip = !flip;
    }
    expect(session.step).toBe(7);
    expect(session.done).toBe(true);
    expect(session.conflicted).toBe(false);
    // Approximate: the window did NOT collapse to a point.
    expect(session.hi - session.lo).toBeGreaterThanOrEqual(1);

    // Replay places the bar inside the final window (relative to the
    // ordered candidates).
    const { orderedBarIds } = buildRankOrderForTier(
      ratings,
      [...prior, ...session.answers],
      'loved',
    );
    const barPos = orderedBarIds.indexOf('new-bar');
    expect(barPos).toBeGreaterThanOrEqual(session.lo);
    expect(barPos).toBeLessThanOrEqual(session.hi);
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
