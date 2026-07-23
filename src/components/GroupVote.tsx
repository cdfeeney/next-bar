'use client';

/**
 * GroupVote — the "put it to a vote" loop on /friends/consensus (blueprint
 * B1). Candidates are the group's top consensus picks; demo friends
 * auto-vote their favorite via pickFavorite, and the user's tap decides it.
 * If the user isn't in the group (no ratings yet), friends' votes settle it
 * instantly and we jump straight to the result.
 *
 * Session state lives here (plain useState over the pure reducer). The page
 * keys this component on the participant set, so changing who's going
 * resets any vote in progress.
 */

import { useState } from 'react';
import { barById, type ConsensusParticipant } from '@/lib/demo';
import {
  createSession,
  castVote,
  tally,
  winner,
  pickFavorite,
  type VoteSession,
} from '@/lib/groupVote';

const YOU_ID = 'you';

export default function GroupVote({
  participants,
  candidates,
}: {
  participants: ConsensusParticipant[];
  /** Candidate barIds ranked best-first (the tie-break order). */
  candidates: string[];
}): JSX.Element {
  const [session, setSession] = useState<VoteSession | null>(null);

  const start = (): void => {
    let s = createSession(
      candidates,
      participants.map((p) => ({ id: p.id, label: p.label })),
    );
    for (const p of participants) {
      if (p.id === YOU_ID) continue;
      s = castVote(s, p.id, pickFavorite(p.ratings, s.candidates));
    }
    setSession(s);
  };

  if (!session) {
    return (
      <div className="mt-10 text-center">
        <button
          type="button"
          onClick={start}
          className="inline-flex items-center justify-center bg-accent text-bg font-display text-sm px-6 py-3 rounded-full min-h-[44px] touch-manipulation"
        >
          Put it to a vote →
        </button>
        <p className="text-muted text-xs mt-3">
          Everyone picks one — winner is where you&apos;re going.
        </p>
      </div>
    );
  }

  if (session.status === 'voting') {
    return (
      <VotingScreen
        session={session}
        onVote={(barId) => setSession(castVote(session, YOU_ID, barId))}
      />
    );
  }

  return <ResultScreen session={session} onReset={() => setSession(null)} />;
}

function VotingScreen({
  session,
  onVote,
}: {
  session: VoteSession;
  onVote: (barId: string) => void;
}): JSX.Element {
  const friendVotesFor = (barId: string) =>
    session.participants.filter(
      (p) => p.id !== YOU_ID && session.votes[p.id] === barId,
    );

  return (
    <section className="mt-10" aria-label="Group vote">
      <h2 className="font-display text-xs uppercase tracking-[0.25em] text-muted mb-1">
        The vote is on
      </h2>
      <p className="text-sm mb-4">
        Your call — tap your pick and it&apos;s settled.
      </p>
      <div className="space-y-3" role="group" aria-label="Tap your pick">
        {session.candidates.map((barId) => {
          const bar = barById(barId);
          if (!bar) return null;
          const backers = friendVotesFor(barId);
          return (
            <button
              key={barId}
              type="button"
              aria-label={`Vote for ${bar.name}`}
              onClick={() => onVote(barId)}
              className="w-full text-left rounded-3xl p-4 border bg-surface border-border hover:border-accent transition-colors touch-manipulation"
            >
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-display text-lg leading-tight">
                  {bar.name}
                </span>
                <span className="text-muted text-xs uppercase tracking-wider shrink-0">
                  {bar.neighborhood}
                </span>
              </div>
              {backers.length > 0 ? (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {backers.map((p) => (
                    <span
                      key={p.id}
                      className="text-[11px] px-2 py-1 rounded-full bg-bg border border-border text-muted"
                    >
                      {p.label} voted
                    </span>
                  ))}
                </div>
              ) : null}
            </button>
          );
        })}
      </div>
    </section>
  );
}

function ResultScreen({
  session,
  onReset,
}: {
  session: VoteSession;
  onReset: () => void;
}): JSX.Element {
  const winnerId = winner(session);
  const bar = winnerId ? barById(winnerId) : undefined;
  const rows = tally(session);

  if (!bar) return <></>;

  return (
    <section className="mt-10" aria-label="Vote result">
      <div className="rise rounded-3xl p-6 border glow-accent border-accent bg-gradient-to-b from-accent/[0.08] to-surface text-center">
        <p className="text-accent text-[11px] uppercase tracking-[0.2em] font-display mb-2">
          ★ Tonight&apos;s pick
        </p>
        <h2 className="font-display text-3xl leading-tight mb-1">{bar.name}</h2>
        <p className="text-muted text-xs uppercase tracking-wider">
          {bar.neighborhood} · {'$'.repeat(bar.priceTier)}
        </p>
        <p className="text-sm italic mt-3">{bar.blurb}</p>
      </div>

      <div className="mt-4 space-y-2">
        {rows.map((row) => {
          const rowBar = barById(row.barId);
          if (!rowBar) return null;
          const backers = session.participants.filter(
            (p) => session.votes[p.id] === row.barId,
          );
          return (
            <div
              key={row.barId}
              className="flex items-center justify-between gap-3 text-sm px-4 py-2 rounded-2xl bg-surface border border-border"
            >
              <span className="truncate">{rowBar.name}</span>
              <span className="text-muted text-xs shrink-0">
                {row.count} {row.count === 1 ? 'vote' : 'votes'}
                {backers.length > 0
                  ? ` · ${backers.map((p) => p.label).join(', ')}`
                  : ''}
              </span>
            </div>
          );
        })}
      </div>

      <div className="text-center mt-6">
        <button
          type="button"
          onClick={onReset}
          className="text-muted text-sm underline-offset-4 hover:underline min-h-[44px] inline-flex items-center touch-manipulation"
        >
          Vote again
        </button>
      </div>
    </section>
  );
}
