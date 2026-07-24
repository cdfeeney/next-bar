/**
 * insertFlow.ts — B4 binary-insertion session model over ONE tier's rank
 * order (the Beli-style "more or less than X?" chain), hardened per B7a
 * with DYNAMIC candidates.
 *
 * A session binary-searches the tier's transcript-ordered chain for the
 * new bar's slot. Each answered probe emits one PairwiseComparison for the
 * caller to persist (dual-mode paths already exist in usePairwise); the
 * authoritative final position always comes from replaying the transcript
 * (src/lib/pairwise.ts), NOT from the session — the session only decides
 * which questions to ask.
 *
 * B7a dynamic candidates (queued from Codex's B4 review): the candidate
 * list is RECOMPUTED from transcript replay after every answer, and
 * unordered (band-midpoint) peers are EXCLUDED from the probe set once any
 * replay order exists — they only participate in the pure-bootstrap case
 * (a tier with no ordered peers at all). Probing only replay-ordered peers
 * makes the converged slot exact with respect to the replayed chain:
 * unordered peers can no longer tie/interleave past the probed window,
 * because they were never inside it.
 *
 * Invariants:
 *   - Pure + immutable: every function returns fresh objects.
 *   - ≤ min(ceil(log2(n+1)), MAX_COMPARISONS_PER_ADD) answers per add.
 *   - n ≥ 128 ordered candidates exceeds what 7 probes can resolve —
 *     placement is EXPLICITLY approximate there (window may end wider than
 *     one slot); replay places the bar inside the final window.
 *   - Skip ends the session; with no answers the bar stays unordered and
 *     replay scores it at the tier band midpoint.
 *   - Conflict flag: if applying an answer leaves the replayed order
 *     contradicting ANY answer of this session, or collapses the window to
 *     an impossibility (lo > hi from contradictory prior rows), the
 *     session ends gracefully with conflicted=true. The answer is still
 *     recorded — replay's later-wins handles it.
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
  /** Every tier peer (excl. barId) — the replay universe. */
  readonly allPeerIds: readonly string[];
  /**
   * The CURRENT probe list (best first). Replay-ordered peers only, except
   * in pure bootstrap (no ordered peers yet) where it is every peer in
   * effective rank order. Recomputed from replay after each answer (B7a).
   */
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

/** Synthesized in-tier ratings for replay over the session's universe. */
function replayRatings(session: {
  barId: string;
  allPeerIds: readonly string[];
  tier: Tier;
}): BarRating[] {
  return [session.barId, ...session.allPeerIds].map((barId) => ({
    barId,
    rating: session.tier,
    ratedAt: '1970-01-01T00:00:00.000Z',
  }));
}

/**
 * Replay-ordered peers (excl. the bar) for the given transcript. Empty when
 * the tier has no transcript-ordered peers at all (pure bootstrap).
 */
function orderedPeers(
  session: { barId: string; allPeerIds: readonly string[]; tier: Tier },
  transcript: readonly PairwiseComparison[],
): string[] {
  const { orderedBarIds } = buildRankOrderForTier(
    replayRatings(session),
    transcript,
    session.tier,
  );
  return orderedBarIds.filter((id) => id !== session.barId);
}

/**
 * Window over `candidates` slots implied by the transcript rows involving
 * the bar: a peer that beat the bar pushes lo below it; a peer the bar
 * beat pulls hi above it. lo > hi signals contradictory rows (handled by
 * the caller as a conflict).
 *
 * LATER-WINS PER PAIR (Opus B7a review): replay honors only the LATEST
 * row for a repeated pair — a mind-change history like [b>x, x>b] resolves
 * cleanly to x-above-b. Folding BOTH rows here produced lo > hi, a
 * spurious conflict replay itself doesn't have. So constraints are
 * deduplicated to each pair's newest row first, mirroring replay.
 */
function windowFromConstraints(
  barId: string,
  candidates: readonly string[],
  transcript: readonly PairwiseComparison[],
): { lo: number; hi: number } {
  const index = new Map(candidates.map((id, i) => [id, i]));
  // peer id → true when the LATEST row has the peer above the bar.
  const latestPeerAbove = new Map<string, boolean>();
  for (const row of transcript) {
    if (row.winnerBarId === barId) latestPeerAbove.set(row.loserBarId, false);
    else if (row.loserBarId === barId) {
      latestPeerAbove.set(row.winnerBarId, true);
    }
  }

  let lo = 0;
  let hi = candidates.length;
  for (const [peerId, peerAbove] of latestPeerAbove) {
    const i = index.get(peerId);
    if (i === undefined) continue;
    if (peerAbove) lo = Math.max(lo, i + 1);
    else hi = Math.min(hi, i);
  }
  return { lo, hi };
}

/**
 * Start a binary-insertion session for `barId` into `tier`.
 *
 * Candidates (B7a): the tier's replay-ORDERED peers, in replay order —
 * the transcript-established chain. Only when that chain is empty (pure
 * bootstrap: nothing in the tier has ever been compared) does the session
 * fall back to probing all peers in effective rank order; the first answer
 * orders the probed peer and the session continues on the ordered chain.
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
  const allPeerIds =
    tier === 'pass'
      ? []
      : sortRatingsByScore(
          ratings.filter((r) => r.rating === tier && r.barId !== barId),
        ).map((r) => r.barId);

  const shell = { barId, tier, allPeerIds };
  const ordered = orderedPeers(shell, comparisons);
  // Pure bootstrap only: no ordered chain exists → probe the effective
  // rank order (unordered peers at their midpoint slots).
  const candidates = ordered.length > 0 ? ordered : allPeerIds;

  // Prior rows involving the bar (a re-rated bar) already constrain the
  // window — start from them rather than re-asking settled questions.
  const { lo, hi } = windowFromConstraints(barId, candidates, comparisons);

  // Pure bootstrap always resolves in ONE answer (the ordered chain after
  // it is just the probed peer, and the window collapses) — advertise 1,
  // not log2(all peers), so the progress UI doesn't overstate (Opus).
  const isBootstrap = ordered.length === 0 && allPeerIds.length > 0;

  const base = {
    ...shell,
    candidates,
    lo,
    hi,
    step: 0,
    maxSteps:
      candidates.length === 0
        ? 0
        : isBootstrap
          ? 1
          : Math.min(
              Math.ceil(Math.log2(candidates.length + 1)),
              MAX_COMPARISONS_PER_ADD,
            ),
    answers: [] as PairwiseComparison[],
    priorComparisons: comparisons.slice(),
    skipped: false,
    conflicted: false,
  };

  if (candidates.length === 0 || lo >= hi) {
    // No peers, or prior rows already pin (or contradict) the slot.
    return { ...base, probeBarId: null, done: true, conflicted: lo > hi };
  }
  return {
    ...base,
    probeBarId: candidates[probeIndex(lo, hi)],
    done: false,
  };
}

/**
 * Record the user's answer for the current probe. `winnerId` must be the
 * session's bar or the current probe; anything else (or a done session)
 * returns the session unchanged with comparison=null.
 *
 * B7a: after recording, the candidate list is rebuilt from replay of
 * [prior + this session's answers] and the window is re-derived from ALL
 * rows involving the bar — so the probe set always reflects the chain the
 * replay will actually produce, and freshly-ordered peers (the bootstrap
 * probe) join it while never-probed unordered peers stay out.
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

  const answers = [...session.answers, comparison];
  const step = session.step + 1;
  const transcript = [...session.priorComparisons, ...answers];

  // B7a recompute: the ordered chain after this answer (always non-empty
  // now — the probe itself just became ordered).
  const candidates = orderedPeers(session, transcript);
  const { lo, hi } = windowFromConstraints(
    session.barId,
    candidates,
    transcript,
  );

  const next: InsertSession = {
    ...session,
    candidates,
    lo,
    hi,
    answers,
    step,
  };

  if (lo > hi || hasReplayConflict(next)) {
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

  const probeBarId = candidates[probeIndex(lo, hi)];
  // Defensive: a probe target the session already answered against means
  // the constraint bookkeeping and replay disagree (contradictory priors
  // that later-wins silently absorbed) — end rather than re-ask or loop.
  const alreadyAsked = answers.some(
    (a) => a.winnerBarId === probeBarId || a.loserBarId === probeBarId,
  );
  if (alreadyAsked) {
    return {
      session: { ...next, probeBarId: null, done: true },
      comparison,
    };
  }
  return { session: { ...next, probeBarId }, comparison };
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
 * candidates.length = below every candidate — relative to the session's
 * FINAL candidate list (the replay-ordered chain, B7a).
 *
 * EXACTNESS (B7a): for a session that finished by window collapse without
 * conflict, this slot now matches the replayed position within the ordered
 * chain — unordered peers are outside the probe set, so they cannot
 * interleave into the probed window. For n ≥ 128 ordered candidates the
 * 7-probe cap leaves the window wider than one slot: placement is
 * approximate BY POLICY, and replay places the bar inside [lo, hi].
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
  const { orderedBarIds } = buildRankOrderForTier(
    replayRatings(session),
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
