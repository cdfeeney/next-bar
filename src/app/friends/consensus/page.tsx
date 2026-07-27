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
import { useVibeVotes } from '@/hooks/useVibeVotes';
import VibeVotePoll from '@/components/VibeVotePoll';
import { boostByWinningVibe } from '@/lib/vibeVotes';
import { displayTag } from '@/lib/tagDisplay';
import type { VibeTag } from '@/types';
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

  // UX-E: tonight's vibe poll (dark until migration 0017 is applied —
  // votes stays null and the poll renders nothing).
  const vibeVotes = useVibeVotes();

  // UX-B: ONE Group Favorites list — unanimous overlap leads, near-misses
  // fill, capped at 5. (The multi-step vote flow is deleted; People's
  // Choice carries the human signal via the suggest/vote poll.)
  // UX-E: the winning vibe SEEDS the list — matching favorites float
  // (stable partition, applied before the cap so a vibe match can enter
  // the top 5), with the chip in the heading explaining why.
  const groupFavorites = useMemo(
    () =>
      boostByWinningVibe(
        [...overlap, ...alsoConsider],
        vibeVotes.winner,
        (entry) => barById(entry.barId)?.tags ?? [],
      ).slice(0, 5),
    [overlap, alsoConsider, vibeVotes.winner],
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
        <div className="flex flex-wrap gap-2 justify-center mb-4" role="group" aria-label="Choose who's going">
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

        {/* UX-F v1 nudge, moved UNDER the chips (QA3: the operator
            couldn't find it in the header on mobile) — an invite link
            that works with zero server state; recipients land on /join. */}
        <div className="mb-8">
          <ShareButton
            path="/join"
            text="Out tonight? Pick the bar with us on Next Bar."
            label="Invite friends"
            ariaLabel="Invite friends to plan tonight"
            wide
          />
        </div>

        {isServer && unratedFriendCount > 0 ? (
          <p className="text-muted text-xs text-center mb-8">
            {unratedFriendCount} of your circle{' '}
            {unratedFriendCount === 1 ? "hasn't" : "haven't"} ranked any bars
            yet — they&apos;ll appear here once they do.
          </p>
        ) : null}

        {/* UX-E — TONIGHT'S VIBE poll (0017; renders nothing while the
            migration is unapplied). Sits above Group Favorites because
            the winner seeds them. Real circles only, like People's
            Choice. */}
        {isServer ? <VibeVotePoll {...vibeVotes} /> : null}

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
              {vibeVotes.winner ? (
                <span
                  data-testid="winning-vibe-chip"
                  className="ml-2 normal-case tracking-normal inline-flex items-center rounded-full border border-accent px-2 py-0.5 text-[11px] text-accent"
                >
                  Tonight: {displayTag(vibeVotes.winner as VibeTag)}
                </span>
              ) : null}
            </h2>
            {groupFavorites.length === 0 ? (
              <p className="text-muted text-sm leading-relaxed">
                No shared history yet — rate a few bars and this fills in.
              </p>
            ) : (
              <div className="space-y-2">
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

        {/* Part 2 — PEOPLE'S CHOICE: the tabular poll (photo + name +
            vote tally; real circles only — demo curators can't suggest). */}
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

/**
 * Compact tile (operator 2026-07-26: "the tiles need to be smaller") —
 * name, score, one meta line. Blurb and per-person score chips are gone;
 * the top pick keeps its glow + the share moment.
 */
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
        'rise rounded-2xl px-4 py-3 border',
        highlight
          ? 'glow-accent border-accent bg-gradient-to-b from-accent/[0.08] to-surface'
          : 'bg-surface border-border',
      ].join(' ')}
      style={{ ['--rise-delay' as string]: `${Math.min(index, 8) * 70}ms` }}
    >
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="font-display text-base leading-tight truncate">
          {rank ? (
            <span className="text-accent mr-2 tabular-nums">{rank}.</span>
          ) : null}
          {highlight ? (
            <span className="text-accent" aria-hidden="true">★ </span>
          ) : null}
          {bar.name}
        </h3>
        <span
          className="font-display text-lg tabular-nums text-accent shrink-0"
          aria-label={`Group score ${entry.avgScore.toFixed(1)} out of 10`}
        >
          {entry.avgScore.toFixed(1)}
        </span>
      </div>
      <p className="text-muted text-xs uppercase tracking-wider truncate mt-0.5">
        {bar.neighborhood} · {'$'.repeat(bar.priceTier)}
      </p>
      {/* The winner-share moment lives on the TOP pick (works signed-out
          too — the share-card loop's entry). QA3: a labeled solid-outline
          button spanning the card so it's findable on mobile. */}
      {highlight ? (
        <div className="mt-3">
          <ShareButton
            path={buildPickPath(bar.id)}
            text={sharePickText(bar)}
            label="Share the pick"
            ariaLabel={`Share the pick: ${bar.name}`}
            variant="outline"
            wide
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
