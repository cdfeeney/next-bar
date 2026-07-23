/**
 * Group vote session — the "converge on ONE bar" half of the consensus flow
 * (blueprint B1, Partiful-style "where do we go tonight").
 *
 * `computeConsensus` (src/lib/demo/consensus.ts) answers "what does the group
 * agree on?"; this module answers "which single bar are we actually going
 * to?". The page seeds a session with the top consensus picks as candidates
 * (ranked best-first — that order doubles as the deterministic tie-break),
 * demo friends auto-vote via `pickFavorite`, and the user casts the last
 * vote to decide it.
 *
 * Pure module: no storage, no React. State is immutable — every transition
 * returns a new session (or the same reference when the input is a no-op),
 * so it drops straight into a useState/useReducer.
 */

import type { BarRating, Rating } from '@/types/ratings';

export type VoteParticipant = {
  /** Stable id — handle for friends, 'you' for the signed-in user. */
  id: string;
  /** Display label shown on vote chips. */
  label: string;
};

export type VoteSession = {
  status: 'voting' | 'decided';
  /** Candidate barIds, ranked best-first. Order is the tie-break. */
  candidates: ReadonlyArray<string>;
  participants: ReadonlyArray<VoteParticipant>;
  /** participantId -> the barId they voted for. */
  votes: Readonly<Record<string, string>>;
};

export type TallyRow = {
  barId: string;
  count: number;
};

// Tier midpoints, duplicated as plain numbers to keep this module free of a
// dependency cycle with pairwise.ts. Kept in sync with TIER_BANDS there.
const TIER_MIDPOINT: Record<Rating, number> = {
  loved: 9.0,
  liked: 6.45,
  pass: 2.45,
};

function dedupe(ids: ReadonlyArray<string>): string[] {
  return [...new Set(ids)];
}

/**
 * Start a vote over ranked candidates. Duplicate candidates/participants are
 * dropped (first occurrence wins). Throws when the result is too small to be
 * a vote — callers gate the UI on group size, so this only fires on bugs.
 */
export function createSession(
  candidates: ReadonlyArray<string>,
  participants: ReadonlyArray<VoteParticipant>,
): VoteSession {
  const uniqueCandidates = dedupe(candidates);
  const seen = new Set<string>();
  const uniqueParticipants = participants.filter((p) => {
    if (seen.has(p.id)) return false;
    seen.add(p.id);
    return true;
  });

  if (uniqueCandidates.length < 2) {
    throw new Error('A vote needs at least 2 candidate bars.');
  }
  if (uniqueParticipants.length < 2) {
    throw new Error('A vote needs at least 2 participants.');
  }

  return {
    status: 'voting',
    candidates: uniqueCandidates,
    participants: uniqueParticipants,
    votes: {},
  };
}

/**
 * Record (or change) a participant's vote. Unknown participants/candidates
 * and votes after the session is decided are ignored — the same session
 * reference comes back so React state updates are free no-ops.
 */
export function castVote(
  session: VoteSession,
  participantId: string,
  barId: string,
): VoteSession {
  if (session.status !== 'voting') return session;
  if (!session.participants.some((p) => p.id === participantId)) return session;
  if (!session.candidates.includes(barId)) return session;

  const votes = { ...session.votes, [participantId]: barId };
  const everyoneVoted = session.participants.every((p) => p.id in votes);

  return {
    ...session,
    votes,
    status: everyoneVoted ? 'decided' : 'voting',
  };
}

/**
 * Vote counts for every candidate (including zero-vote ones, so the UI can
 * render a stable list), ranked by count desc then candidate order — the
 * group's own ranking settles ties.
 */
export function tally(session: VoteSession): TallyRow[] {
  const counts = new Map<string, number>(
    session.candidates.map((barId) => [barId, 0]),
  );
  for (const barId of Object.values(session.votes)) {
    counts.set(barId, (counts.get(barId) ?? 0) + 1);
  }
  return session.candidates
    .map((barId) => ({ barId, count: counts.get(barId) ?? 0 }))
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return (
        session.candidates.indexOf(a.barId) -
        session.candidates.indexOf(b.barId)
      );
    });
}

/** The winning barId once every participant has voted; null while open. */
export function winner(session: VoteSession): string | null {
  if (session.status !== 'decided') return null;
  return tally(session)[0]?.barId ?? null;
}

/**
 * A demo friend's auto-vote: their highest-scored candidate, never one they
 * passed on. Falls back to the top-ranked candidate when they haven't rated
 * any — the group's #1 is the natural "sure, whatever you all think" vote.
 */
export function pickFavorite(
  ratings: ReadonlyArray<BarRating>,
  candidates: ReadonlyArray<string>,
): string {
  let best: { barId: string; score: number } | null = null;
  for (const r of ratings) {
    if (r.rating === 'pass') continue;
    if (!candidates.includes(r.barId)) continue;
    const score =
      typeof r.score === 'number' ? r.score : TIER_MIDPOINT[r.rating];
    if (!best || score > best.score) {
      best = { barId: r.barId, score };
    }
  }
  return best ? best.barId : candidates[0];
}
