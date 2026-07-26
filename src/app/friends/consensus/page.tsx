'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import Avatar from '@/components/Avatar';
import ShareButton from '@/components/ShareButton';
import TonightSuggestions from '@/components/TonightSuggestions';
import { buildPickPath, sharePickText } from '@/lib/share';
import { useAuth } from '@/hooks/useAuth';
import { useFollows } from '@/hooks/useFollows';
import { useRatings } from '@/hooks/useRatings';
import { getBrowserSupabase } from '@/lib/supabase/client';
import { getCacheEpoch } from '@/lib/accountCache';
import {
  fetchAllFriendRatings,
  type FriendRating,
} from '@/lib/follows.server';
import {
  computeConsensus,
  demoFriends,
  barById,
  type ConsensusParticipant,
  type ConsensusEntry,
} from '@/lib/demo';

const YOU_ID = 'you';

/** A selectable person on the consensus screen — demo or real. */
type Person = {
  id: string;
  label: string;
  initials: string;
  seed: string;
  ratings: ReadonlyArray<{ barId: string; rating: 'loved' | 'liked' | 'pass'; ratedAt: string }>;
};

function initialsFor(label: string): string {
  return label
    .split(/\s+/)
    .map((w) => w[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

export default function ConsensusPage(): JSX.Element {
  const { circle, mode, isFollowing } = useFollows();
  const { ratings } = useRatings();
  const auth = useAuth();
  const isServer = mode === 'server';

  // REAL consensus (operator: "make where should we go real"): in server
  // mode the people are your actual circle and their tier-rated bars come
  // from get_friend_ratings (tier-only — scores never cross the friend
  // boundary; scoreOf falls back to tier midpoints). Demo mode keeps the
  // seeded curators so signed-out visitors still see the feature work.
  const [friendRatings, setFriendRatings] = useState<Record<string, FriendRating[]> | null>(null);
  useEffect(() => {
    if (!isServer || auth.status !== 'signed-in') return;
    const supabase = getBrowserSupabase();
    if (!supabase) return;
    let cancelled = false;
    const epoch = getCacheEpoch();
    void (async () => {
      const grouped = await fetchAllFriendRatings(supabase);
      if (cancelled || getCacheEpoch() !== epoch) return;
      if (grouped !== null) setFriendRatings(grouped);
    })();
    return () => {
      cancelled = true;
    };
  }, [isServer, auth.status, auth.status === 'signed-in' ? auth.user.id : null]);

  const demoFollowed = useMemo(
    () => demoFriends.filter((f) => isFollowing(f.handle)),
    [isFollowing],
  );

  // Unified person list. Real friends with ZERO rated bars are listed
  // separately (they can't contribute picks — showing an inert chip reads
  // as broken).
  const { people, unratedFriendCount } = useMemo(() => {
    if (!isServer) {
      return {
        people: demoFollowed.map((f) => ({
          id: f.handle,
          label: f.displayName.split(' ')[0],
          initials: f.initials,
          seed: f.handle,
          ratings: f.ratings,
        })) as Person[],
        unratedFriendCount: 0,
      };
    }
    const rated: Person[] = [];
    let unrated = 0;
    for (const p of circle) {
      const theirs = friendRatings?.[p.id] ?? [];
      if (theirs.length === 0) {
        unrated++;
        continue;
      }
      const label = (p.displayName ?? `@${p.handle}`).split(' ')[0];
      rated.push({
        id: p.id,
        label,
        initials: initialsFor(p.displayName ?? p.handle),
        seed: p.handle,
        ratings: theirs.map((r) => ({
          barId: r.barId,
          rating: r.rating,
          ratedAt: r.ratedAt,
        })),
      });
    }
    return { people: rated, unratedFriendCount: unrated };
  }, [isServer, demoFollowed, circle, friendRatings]);

  const followedFriends = people;

  const youHasRatings = ratings.length > 0;

  // Selection: start with You (if you have ratings) + everyone followed.
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const effectiveSelected = useMemo(() => {
    if (selected) return selected;
    const init = new Set<string>(followedFriends.map((f) => f.id));
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
      if (effectiveSelected.has(f.id)) {
        list.push({ id: f.id, label: f.label, ratings: f.ratings });
      }
    }
    return list;
  }, [effectiveSelected, followedFriends, ratings, youHasRatings]);

  const { overlap, alsoConsider } = useMemo(
    () => computeConsensus(participants),
    [participants],
  );

  const enoughPeople = participants.length >= 2;

  // UX-B: ONE Group Favorites list — unanimous overlap leads, near-misses
  // fill, capped at 5. (The multi-step vote flow is deleted; People's
  // Choice carries the human signal via suggest + I'm-in.)
  const groupFavorites = useMemo(
    () => [...overlap, ...alsoConsider].slice(0, 5),
    [overlap, alsoConsider],
  );

  return (
    <main className="min-h-screen pb-28">
      {/* UX-B (operator 2026-07-26): minimum words — the two labeled
          sections below do the explaining. */}
      <header className="px-6 pt-8 pb-4">
        <Link
          href="/friends"
          className="text-muted text-sm underline-offset-4 hover:underline min-h-[44px] inline-flex items-center touch-manipulation"
        >
          ← Friends
        </Link>
        <h1 className="font-display text-3xl md:text-4xl mb-2 text-center">
          Plan Night Out
        </h1>
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
              key={f.id}
              label={f.label}
              initials={f.initials}
              seed={f.seed}
              selected={effectiveSelected.has(f.id)}
              onClick={() => toggle(f.id)}
            />
          ))}
        </div>

        {isServer && unratedFriendCount > 0 ? (
          <p className="text-muted text-xs text-center -mt-4 mb-8">
            {unratedFriendCount} of your circle{' '}
            {unratedFriendCount === 1 ? "hasn't" : "haven't"} ranked any bars
            yet — they&apos;ll appear here once they do.
          </p>
        ) : null}

        {/* Part 1 — GROUP FAVORITES: the algorithm's picks for whoever's
            selected (operator structure 2026-07-26). One list; the top
            pick carries the share moment. */}
        {!enoughPeople ? (
          <EmptyState
            youHasRatings={youHasRatings}
            anyFollowed={followedFriends.length > 0}
          />
        ) : (
          <div className="mb-10">
            <h2 className="font-display text-xs uppercase tracking-[0.25em] text-muted mb-4">
              Group Favorites
            </h2>
            {groupFavorites.length === 0 ? (
              <p className="text-muted text-sm leading-relaxed">
                No shared history yet — rate a few bars and this fills in.
              </p>
            ) : (
              <div className="space-y-4">
                {groupFavorites.map((entry, i) => (
                  <ConsensusCard
                    key={entry.barId}
                    entry={entry}
                    rank={i + 1}
                    index={i}
                    highlight={i === 0}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Part 2 — PEOPLE'S CHOICE: the bars people are thinking about
            (suggest + I'm-in live inside; real circles only — demo
            curators can't suggest). */}
        {isServer ? <TonightSuggestions /> : null}
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
      {/* The winner-share moment lives on the TOP pick (works signed-out
          too — the demo path is the share-card loop's entry). */}
      {highlight ? (
        <div className="mt-4">
          <ShareButton
            path={buildPickPath(bar.id)}
            text={sharePickText(bar)}
            label="Share the pick"
            ariaLabel={`Share the pick: ${bar.name}`}
          />
        </div>
      ) : null}
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
