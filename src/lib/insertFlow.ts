/**
 * insertFlow.ts — B4 binary-insertion session model over ONE tier's rank
 * order (the Beli-style "more or less than X?" chain).
 *
 * A session binary-searches the tier's current effective ranking for the
 * new bar's slot. Each answered probe emits one PairwiseComparison for the
 * caller to persist (dual-mode paths already exist in usePairwise); the
 * authoritative final position always comes from replaying the transcript
 * (src/lib/pairwise.ts), NOT from the session — the session only decides
 * which questions to ask.
 *
 * Invariants:
 *   - Pure + immutable: every function returns fresh objects.
 *   - ≤ min(ceil(log2(n+1)), MAX_COMPARISONS_PER_ADD) answers per add.
 *   - The wider initial window while the new bar has < 3 comparisons is
 *     inherent — a new bar starts at 0 comparisons with the full window.
 *   - Skip ends the session; with no answers the bar stays unordered and
 *     replay scores it at the tier band midpoint.
 *   - Conflict flag: if applying an answer leaves the replayed order
 *     contradicting ANY answer of this session (possible when persisted
 *     scores drifted from the transcript, or the transcript itself has
 *     contradictions), the session ends gracefully with conflicted=true.
 *     The answer is still recorded — replay's later-wins handles it.
 */

import type { BarRating, PairwiseComparison } from '@/types/ratings';
import {
  buildRankOrderForTier,
  sortRatingsByScore,
  type Tier,
} from '@/lib/pairwise';

/** Hard cap on comparisons per add (B4). */
export const MAX_COMPARISONS_PER_ADD = 7;

export type InsertSession = {
  /** The bar being inserted. */
  readonly barId: string;
  readonly tier: Tier;
  /** Tier peers in current effective rank order (best first), excl. barId. */
  readonly candidates: readonly string[];
  /** Insertion window start (inclusive index into insertion slots). */
  readonly lo: number;
  /** Insertion window end (inclusive index into insertion slots). */
  readonly hi: number;
  /** The peer to ask about next; null when the session is done. */
  readonly probeBarId: string | null;
  /** Number of answers recorded so far. */
  readonly step: number;
  /** Worst-case number of answers for this session. */
  readonly maxSteps: number;
  /** Comparisons produced by this session, in answer order. */
  readonly answers: readonly PairwiseComparison[];
  /** The tier-relevant transcript as of session start (for replay checks). */
  readonly priorComparisons: readonly PairwiseComparison[];
  readonly done: boolean;
  readonly skipped: boolean;
  readonly conflicted: boolean;
};

export type AnswerResult = {
  readonly session: InsertSession;
  /** The row to persist, or null when the input was invalid / already done. */
  readonly comparison: PairwiseComparison | null;
};

function probeIndex(lo: number, hi: number): number {
  return Math.floor((lo + hi) / 2);
}

/**
 * Start a binary-insertion session for `barId` into `tier`.
 *
 * Candidates are the tier's other rated bars in effective rank order —
 * transcript-ordered bars by score, unordered bars at the band midpoint,
 * recency tiebreak — i.e. exactly the order /rankings shows. The first
 * probe is the midpoint of that list.
 *
 * Returns an already-done session when the tier is 'pass' (Q2: no
 * Pass-vs-Pass ordering) or has no peers.
 */
export function startInsertSession(
  ratings: ReadonlyArray<BarRating>,
  comparisons: ReadonlyArray<PairwiseComparison>,
  barId: string,
  tier: Tier,
): InsertSession {
  const peers =
    tier === 'pass'
      ? []
      : sortRatingsByScore(
          ratings.filter((r) => r.rating === tier && r.barId !== barId),
        ).map((r) => r.barId);

  const base = {
    barId,
    tier,
    candidates: peers,
    lo: 0,
    hi: peers.length,
    step: 0,
    maxSteps:
      peers.length === 0
        ? 0
        : Math.min(
            Math.ceil(Math.log2(peers.length + 1)),
            MAX_COMPARISONS_PER_ADD,
          ),
    answers: [] as PairwiseComparison[],
    priorComparisons: comparisons.slice(),
    skipped: false,
    conflicted: false,
  };

  if (peers.length === 0) {
    return { ...base, probeBarId: null, done: true };
  }
  return {
    ...base,
    probeBarId: peers[probeIndex(0, peers.length)],
    done: false,
  };
}

/**
 * Record the user's answer for the current probe. `winnerId` must be the
 * session's bar or the current probe; anything else (or a done session)
 * returns the session unchanged with comparison=null.
 *
 * `comparedAt` is injectable for deterministic tests; defaults to now.
 */
export function answerComparison(
  session: InsertSession,
  winnerId: string,
  comparedAt: string = new Date().toISOString(),
): AnswerResult {
  if (session.done || session.probeBarId === null) {
    return { session, comparison: null };
  }
  if (winnerId !== session.barId && winnerId !== session.probeBarId) {
    return { session, comparison: null };
  }

  const newBarWon = winnerId === session.barId;
  const comparison: PairwiseComparison = {
    winnerBarId: newBarWon ? session.barId : session.probeBarId,
    loserBarId: newBarWon ? session.probeBarId : session.barId,
    comparedAt,
  };

  const probe = probeIndex(session.lo, session.hi);
  const lo = newBarWon ? session.lo : probe + 1;
  const hi = newBarWon ? probe : session.hi;
  const answers = [...session.answers, comparison];
  const step = session.step + 1;
  const next: InsertSession = { ...session, lo, hi, answers, step };

  if (hasReplayConflict(next)) {
    return {
      session: { ...next, probeBarId: null, done: true, conflicted: true },
      comparison,
    };
  }
  if (lo >= hi || step >= session.maxSteps) {
    return {
      session: { ...next, probeBarId: null, done: true },
      comparison,
    };
  }
  return {
    session: { ...next, probeBarId: session.candidates[probeIndex(lo, hi)] },
    comparison,
  };
}

/**
 * End the session without asking further questions (Skip). Already-answered
 * comparisons stay recorded/persisted; with zero answers the bar has no
 * transcript rows, so replay leaves it at the tier band midpoint.
 */
export function skipSession(session: InsertSession): InsertSession {
  if (session.done) return session;
  return { ...session, probeBarId: null, done: true, skipped: true };
}

/**
 * The insertion slot the window converged on: 0 = above every candidate,
 * candidates.length = below every candidate. Meaningful for a session that
 * finished by window collapse without conflict; the authoritative position
 * is always the transcript replay.
 *
 * EXACTNESS SCOPE (Codex B4 review): the slot equals the replayed position
 * only when the probed candidates form a replay-established total order.
 * UNORDERED (midpoint) peers are probed too — required for bootstrap — but
 * a peer the session never probes stays at the band midpoint and can tie/
 * interleave with the new bar in the displayed sort (recency tiebreak).
 * The visible ranking is still 100% transcript-consistent; only this
 * advisory slot is approximate in that case. Dynamic-candidate refinement
 * (recompute candidates from replay after each answer) is queued as B7
 * algorithm hardening — see BLUEPRINT §B7.
 */
export function insertPosition(session: InsertSession): number {
  return session.lo;
}

/**
 * Replay [prior transcript + this session's answers] and check whether any
 * of this session's answers is contradicted by the resulting order (answer
 * says A > B but B sits above A). Tier membership is synthesized from the
 * session — candidates and the new bar are by construction all in-tier.
 */
function hasReplayConflict(session: InsertSession): boolean {
  const replayRatings: BarRating[] = [
    session.barId,
    ...session.candidates,
  ].map((barId) => ({
    barId,
    rating: session.tier,
    ratedAt: '1970-01-01T00:00:00.000Z',
  }));
  const { orderedBarIds } = buildRankOrderForTier(
    replayRatings,
    [...session.priorComparisons, ...session.answers],
    session.tier,
  );
  const indexOf = new Map(orderedBarIds.map((barId, i) => [barId, i]));
  return session.answers.some((answer) => {
    const winner = indexOf.get(answer.winnerBarId);
    const loser = indexOf.get(answer.loserBarId);
    return winner === undefined || loser === undefined || winner > loser;
  });
}
