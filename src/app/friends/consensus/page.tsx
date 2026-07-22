'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import Avatar from '@/components/Avatar';
import { useFollows } from '@/hooks/useFollows';
import { useRatings } from '@/hooks/useRatings';
import {
  computeConsensus,
  demoFriends,
  barById,
  type ConsensusParticipant,
  type ConsensusEntry,
} from '@/lib/demo';

const YOU_ID = 'you';

export default function ConsensusPage(): JSX.Element {
  const { isFollowing } = useFollows();
  const { ratings } = useRatings();

  const followedFriends = useMemo(
    () => demoFriends.filter((f) => isFollowing(f.handle)),
    [isFollowing],
  );

  const youHasRatings = ratings.length > 0;

  // Selection: start with You (if you have ratings) + everyone followed.
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const effectiveSelected = useMemo(() => {
    if (selected) return selected;
    const init = new Set<string>(followedFriends.map((f) => f.handle));
    if (youHasRatings) init.add(YOU_ID);
    return init;
  }, [selected, followedFriends, youHasRatings]);

  const toggle = (id: string) => {
    const next = new Set(effectiveSelected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  const participants: ConsensusParticipant[] = useMemo(() => {
    const list: ConsensusParticipant[] = [];
    if (effectiveSelected.has(YOU_ID) && youHasRatings) {
      list.push({ id: YOU_ID, label: 'You', ratings });
    }
    for (const f of followedFriends) {
      if (effectiveSelected.has(f.handle)) {
        list.push({ id: f.handle, label: f.displayName.split(' ')[0], ratings: f.ratings });
      }
    }
    return list;
  }, [effectiveSelected, followedFriends, ratings, youHasRatings]);

  const { overlap, alsoConsider } = useMemo(
    () => computeConsensus(participants),
    [participants],
  );

  const enoughPeople = participants.length >= 2;

  return (
    <main className="min-h-screen pb-28">
      <header className="px-6 pt-8 pb-4">
        <Link
          href="/friends"
          className="text-muted text-sm underline-offset-4 hover:underline min-h-[44px] inline-flex items-center touch-manipulation"
        >
          ← Friends
        </Link>
        <p className="text-accent uppercase tracking-[0.25em] text-xs mt-4 mb-2 text-center">
          Group pick
        </p>
        <h1 className="font-display text-3xl md:text-4xl mb-2 text-center">
          Where should we go?
        </h1>
        <p className="text-muted text-sm max-w-md mx-auto text-center">
          Pick who&apos;s out tonight. We&apos;ll surface the bars everyone&apos;s
          rated highly — and quietly drop the ones anyone passed on.
        </p>
      </header>

      <section className="max-w-md mx-auto px-6">
        {/* Participant selector */}
        <div className="flex flex-wrap gap-2 justify-center mb-8" role="group" aria-label="Choose who's going">
          {youHasRatings ? (
            <PersonChip
              label="You"
              initials="YOU"
              seed="you"
              selected={effectiveSelected.has(YOU_ID)}
              onClick={() => toggle(YOU_ID)}
            />
          ) : null}
          {followedFriends.map((f) => (
            <PersonChip
              key={f.handle}
              label={f.displayName.split(' ')[0]}
              initials={f.initials}
              seed={f.handle}
              selected={effectiveSelected.has(f.handle)}
              onClick={() => toggle(f.handle)}
            />
          ))}
        </div>

        {!enoughPeople ? (
          <EmptyState
            youHasRatings={youHasRatings}
            anyFollowed={followedFriends.length > 0}
          />
        ) : (
          <>
            <h2 className="font-display text-xs uppercase tracking-[0.25em] text-muted mb-4">
              {overlap.length > 0
                ? `You all agree on ${overlap.length}`
                : 'No unanimous picks yet'}
            </h2>

            {overlap.length > 0 ? (
              <div className="space-y-4">
                {overlap.map((entry, i) => (
                  <ConsensusCard
                    key={entry.barId}
                    entry={entry}
                    rank={i + 1}
                    index={i}
                    highlight={i === 0}
                  />
                ))}
              </div>
            ) : (
              <p className="text-muted text-sm mb-6 leading-relaxed">
                This group hasn&apos;t all been to the same bar yet. Here&apos;s
                where most of you have had good nights:
              </p>
            )}

            {alsoConsider.length > 0 ? (
              <div className="mt-10">
                <h2 className="font-display text-xs uppercase tracking-[0.25em] text-muted mb-4">
                  Also worth a look
                </h2>
                <div className="space-y-4">
                  {alsoConsider.slice(0, 5).map((entry, i) => (
                    <ConsensusCard key={entry.barId} entry={entry} index={i} />
                  ))}
                </div>
              </div>
            ) : null}
          </>
        )}
      </section>
    </main>
  );
}

function PersonChip({
  label,
  initials,
  seed,
  selected,
  onClick,
}: {
  label: string;
  initials: string;
  seed: string;
  selected: boolean;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={[
        'flex items-center gap-2 pl-1 pr-4 py-1 rounded-full border transition-colors min-h-[44px] touch-manipulation',
        selected
          ? 'border-accent bg-accent/10 text-text'
          : 'border-border bg-surface text-muted',
      ].join(' ')}
    >
      <Avatar initials={initials} seed={seed} size="sm" />
      <span className="font-display text-sm">{label}</span>
      <span
        aria-hidden="true"
        className={selected ? 'text-accent' : 'text-muted'}
      >
        {selected ? '✓' : '+'}
      </span>
    </button>
  );
}

function ConsensusCard({
  entry,
  rank,
  index = 0,
  highlight = false,
}: {
  entry: ConsensusEntry;
  rank?: number;
  index?: number;
  highlight?: boolean;
}): JSX.Element {
  const bar = barById(entry.barId);
  if (!bar) return <></>;
  return (
    <article
      className={[
        'rise rounded-3xl p-5 border',
        highlight
          ? 'glow-accent border-accent bg-gradient-to-b from-accent/[0.08] to-surface'
          : 'bg-surface border-border',
      ].join(' ')}
      style={{ ['--rise-delay' as string]: `${Math.min(index, 8) * 70}ms` }}
    >
      {highlight ? (
        <p className="text-accent text-[11px] uppercase tracking-[0.2em] font-display mb-2">
          ★ Top group pick
        </p>
      ) : null}
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="font-display text-xl leading-tight">
          {rank ? (
            <span className="text-accent mr-2 tabular-nums">{rank}.</span>
          ) : null}
          {bar.name}
        </h3>
        <span
          className="font-display text-2xl tabular-nums text-accent shrink-0"
          aria-label={`Group score ${entry.avgScore.toFixed(1)} out of 10`}
        >
          {entry.avgScore.toFixed(1)}
        </span>
      </div>
      <p className="text-muted text-xs uppercase tracking-wider mt-1">
        {bar.neighborhood} · {'$'.repeat(bar.priceTier)}
      </p>
      <p className="text-sm italic mt-2">{bar.blurb}</p>
      <div className="flex flex-wrap gap-1.5 mt-3">
        {entry.votes.map((v) => (
          <span
            key={v.id}
            className="text-[11px] px-2 py-1 rounded-full bg-bg border border-border text-muted"
          >
            {v.label} {v.score.toFixed(1)}
          </span>
        ))}
      </div>
    </article>
  );
}

function EmptyState({
  youHasRatings,
  anyFollowed,
}: {
  youHasRatings: boolean;
  anyFollowed: boolean;
}): JSX.Element {
  return (
    <div className="bg-surface border border-border rounded-3xl p-6 text-center">
      <p className="font-display text-xl mb-2">Pick at least two people.</p>
      <p className="text-muted text-sm leading-relaxed mb-5">
        Consensus needs a group. Select two or more of the people above to find
        the bars you all agree on.
      </p>
      {!anyFollowed ? (
        <Link
          href="/friends"
          className="inline-flex items-center justify-center bg-accent text-bg font-display text-sm px-5 py-3 rounded-full min-h-[44px] touch-manipulation"
        >
          Follow some friends →
        </Link>
      ) : !youHasRatings ? (
        <Link
          href="/rankings"
          className="inline-flex items-center justify-center bg-accent text-bg font-display text-sm px-5 py-3 rounded-full min-h-[44px] touch-manipulation"
        >
          Add your own ratings →
        </Link>
      ) : null}
    </div>
  );
}
