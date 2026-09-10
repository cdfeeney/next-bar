'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import ShareButton from '@/components/ShareButton';
import TonightSuggestions from '@/components/TonightSuggestions';
import { deriveInviteeIds, mergeSelection } from '@/lib/inviteeSelection';
import StartNightOutButton from '@/components/StartNightOutButton';
import { buildPickPath, sharePickText } from '@/lib/share';
import { useAuth } from '@/hooks/useAuth';
import { useFollows } from '@/hooks/useFollows';
import { useRatings } from '@/hooks/useRatings';
import type { BarRating } from '@/types/ratings';
import { useVibeVotes } from '@/hooks/useVibeVotes';
import VibeVotePoll from '@/components/VibeVotePoll';
import { boostByWinningVibe } from '@/lib/vibeVotes';
import { displayTag } from '@/lib/tagDisplay';
import { useBars } from '@/lib/useBars';
import { getBrowserSupabase } from '@/lib/supabase/client';
import { getCacheEpoch } from '@/lib/accountCache';
import {
  fetchAllFriendRatings,
  type FriendRating,
} from '@/lib/follows.server';
import {
  computeConsensus,
  deriveConsensusParticipants,
  demoFriends,
  barById,
  type ConsensusParticipant,
  type ConsensusEntry,
} from '@/lib/demo';

import RecipientPicker, { PersonChip } from './RecipientPicker';
import type { GroupMember } from '@/lib/groups.server';

const YOU_ID = 'you';

/**
 * V9-05: how many bars the organizer can put on the plan's board from the
 * planning flow — `suggest_night_out_bar`'s own cap of three live suggestions
 * per member (0044:648), so the form cannot offer what the server refuses.
 */
const SHORTLIST_CAP = 3;
const SHORTLIST_MATCHES = 6;

/**
 * A consensus entry plus the partition it came from. Near-misses stay in the
 * one Group Favorites list (the standing UX-B invariant — unanimous picks
 * lead) but must never be *labelled* as Group Favorites, so the flag travels
 * with the entry all the way to the card.
 */
type RankedEntry = ConsensusEntry & { isGroupFavorite: boolean };

/** A selectable person on the consensus screen — demo or real. */
type Person = {
  id: string;
  label: string;
  initials: string;
  seed: string;
  /** Full rating shape — `score` is what Group Favorites reads. */
  ratings: ReadonlyArray<BarRating>;
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
  const auth = useAuth();
  return <ConsensusContent key={auth.status === 'signed-in' ? auth.user.id : auth.status} />;
}

function ConsensusContent(): JSX.Element {
  // 0019 swap-day rule: barById feeds Group Favorites — subscribe so a
  // live server-catalog swap re-renders (checklist in catalog.ts). V9-05 also
  // searches it for the shortlist.
  const bars = useBars();
  // `loading` is consumed, not merely destructured: `inviteeIds` below is
  // derived from `circle`, which is EMPTY until follows resolve. Dropping it
  // is what let the Start button send a plan with an empty invitee list.
  //
  // `circleReady` closes the same hole on the FAILURE path (round-2 panel,
  // Codex, HIGH): a fetch that returns null still resolves `loading`, leaving
  // an empty circle that reads as "nobody to invite" rather than "we don't
  // know yet" — a real plan with no guests again, one error away.
  const {
    circle,
    mode,
    isFollowing,
    loading: followsLoading,
    circleReady,
    circleFailed,
  } = useFollows();
  const { ratings } = useRatings();
  const auth = useAuth();
  const isServer = mode === 'server';

  // REAL consensus (operator: "make where should we go real"): in server
  // mode the people are your actual circle and their bars come from
  // get_friend_ratings, which is TIER-ONLY by a hard security rule (0007 /
  // 0015: scores never cross the friend boundary). Group Favorites is a
  // score rule since 2026-08-19 — every member needs a personal score >= 8.0
  // — so a real circle contributes no qualifying scores today and the list
  // stays empty until that boundary carries the signal. Demo mode keeps the
  // seeded curators, whose ratings DO carry scores, so signed-out visitors
  // still see the feature work.
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
          label: f.displayName,
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
      const label = (p.displayName ?? `@${p.handle}`);
      rated.push({
        id: p.id,
        label,
        initials: initialsFor(p.displayName ?? p.handle),
        seed: p.handle,
        // `score` MUST be carried. Group Favorites is a score rule and imputes
        // nothing, so dropping it here made every friend a participant who had
        // scored nothing: votes.length never equalled participants.length and
        // the list was permanently empty. It was invisible while 0007/0015 kept
        // the friend boundary tier-only - there was no score to drop - and
        // migration 0064, which carries the score across that boundary, is what
        // turned a harmless omission into the feature not working.
        ratings: theirs.map((r) => ({
          barId: r.barId,
          rating: r.rating,
          ratedAt: r.ratedAt,
          ...(typeof r.score === 'number' ? { score: r.score } : {}),
        })),
      });
    }
    return { people: rated, unratedFriendCount: unrated };
  }, [isServer, demoFollowed, circle, friendRatings]);

  const followedFriends = people;

  /**
   * Circle members with no ranked bars. They are invitable and selectable — they
   * just contribute no picks — so the picker shows them alongside the rest
   * rather than hiding them until they rate something.
   */
  const unratedCircle = useMemo(() => {
    if (!isServer) return [] as Person[];
    const rated = new Set(people.map((f) => f.id));
    return circle
      .filter((p) => !rated.has(p.id))
      .map((p) => ({
        id: p.id,
        label: (p.displayName ?? `@${p.handle}`),
        initials: initialsFor(p.displayName ?? p.handle),
        seed: p.handle,
        ratings: [],
      })) as Person[];
  }, [isServer, circle, people]);

  const youHasRatings = ratings.length > 0;

  // V9-04: the default is EVERYONE you follow — but explicit, never silent. The
  // RecipientPicker shows it as "Selected · N people" with a remove control per
  // person, so the recipients are clear before submission and editable without
  // the whole circle rendering as a wall of chips. (An empty default was tried
  // and emptied Group Favorites on arrival, which is the approved UX-B view of
  // the selected circle.) You still participates when rated.
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const defaultSelection = useMemo(
    () =>
      new Set<string>([
        ...(youHasRatings ? [YOU_ID] : []),
        ...(isServer ? circle.map((p) => p.id) : followedFriends.map((f) => f.id)),
      ]),
    [youHasRatings, isServer, circle, followedFriends],
  );
  const [groupMembers, setGroupMembers] = useState<Record<string, GroupMember[]>>({});
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [membersLoading, setMembersLoading] = useState(false);
  const groupPeople = useMemo<Person[]>(() => {
    const known = new Set([...people, ...unratedCircle].map((p) => p.id));
    const members = new Map(Object.values(groupMembers).flat().map((p) => [p.profileId, p]));
    return [...members.values()].filter((p) => !known.has(p.profileId)).map((p) => ({
      id: p.profileId,
      label: p.displayName ?? (p.handle ? `@${p.handle}` : p.profileId),
      initials: initialsFor(p.displayName ?? p.handle ?? '?'),
      seed: p.handle ?? p.profileId,
      ratings: [],
    }));
  }, [groupMembers, people, unratedCircle]);
  const recipientPeople = useMemo(() => [...people, ...unratedCircle, ...groupPeople],
    [people, unratedCircle, groupPeople]);
  const effectiveSelected = useMemo(() => {
    const direct = selected ?? defaultSelection;
    const merged = mergeSelection({ direct, groupMembers: Object.values(groupMembers).map(
      (members) => members.map((p) => p.profileId),
    ) });
    const known = new Set(recipientPeople.map((p) => p.id));
    return new Set([...merged].filter((id) => !excluded.has(id)
      && (id === YOU_ID || known.has(id))));
  }, [selected, groupMembers, excluded, youHasRatings, recipientPeople]);

  const toggle = (id: string) => {
    const next = new Set(selected ?? defaultSelection);
    const removed = new Set(excluded);
    if (effectiveSelected.has(id)) {
      next.delete(id);
      removed.add(id);
    } else {
      next.add(id);
      removed.delete(id);
    }
    setSelected(next);
    setExcluded(removed);
  };

  const changeGroup = (id: string, members: GroupMember[] | null) => {
    setGroupMembers((current) => {
      const next = { ...current };
      if (members === null) delete next[id];
      else next[id] = members;
      return next;
    });
    if (members) setExcluded((current) => new Set([...current].filter(
      (id) => !members.some((p) => p.profileId === id),
    )));
  };

  /**
   * Who gets INVITED when a Night Out is started.
   *
   * Cold panel (Codex, HIGH): this used to derive from `followedFriends`, which
   * is the RATING-QUALIFIED subset — friends with zero rated bars are excluded
   * from it on purpose, because an inert consensus chip reads as broken. That
   * filter is right for the picker and wrong for invitations: being invited out
   * and having rated bars are different things, and deriving from it meant a
   * friend who had rated nothing was silently never invited. The same list is
   * also EMPTY while `friendRatings` loads, so starting a plan a moment too
   * early invited nobody at all and said nothing about it.
   *
   * Invitations now come from the full followed circle, and EVERY circle member
   * is selectable in the picker below — including friends who have ranked
   * nothing. Operator decision: "you should be able to add a friend that has no
   * bars ranked, someone might not be into that and just use it as a social
   * lens." Being invited out and having rated bars are unrelated.
   *
   * Unrated members cast no votes (they have none), but they DO count toward
   * unanimity — see `participants` below. Their chip is marked so an empty
   * contribution reads as expected rather than broken.
   */
  const inviteeIds: string[] = useMemo(
    () =>
      deriveInviteeIds({
        isServer,
        circleIds: recipientPeople.map((p) => p.id),
        selected: effectiveSelected,
      }),
    [isServer, recipientPeople, effectiveSelected],
  );
  /**
   * V9-04 provenance: an invitee who is NOT a direct pick came in through a
   * group, and the server must re-check that membership (and blocks) per
   * person — `invite_one_to_night_out(p_group)`. A client-cached roster is a
   * suggestion, never an authorization (round-1 panel, Codex).
   */
  const inviteeGroupByUser = useMemo<Record<string, string | null>>(() => {
    const direct = selected ?? defaultSelection;
    const out: Record<string, string | null> = {};
    for (const id of inviteeIds) {
      if (direct.has(id)) {
        out[id] = null;
        continue;
      }
      const viaGroup = Object.entries(groupMembers).find(([, members]) =>
        members.some((m) => m.profileId === id),
      );
      out[id] = viaGroup ? viaGroup[0] : null;
    }
    return out;
  }, [inviteeIds, selected, defaultSelection, groupMembers]);
  // While a create is in flight the recipient set is already snapshotted; the
  // picker freezes so what the owner sees is what was submitted.
  const [creating, setCreating] = useState(false);

  /**
   * V9-05: the organizer's shortlist for the plan's vote — bar ids in pick
   * order, at most SHORTLIST_CAP. Picked from Group Favorites or by name from
   * the catalog, because a real circle's Group Favorites is empty until scores
   * cross the friend boundary and the organizer still needs a way to seed the
   * board. Server mode only: demo curators cannot create plans.
   */
  const [shortlist, setShortlist] = useState<string[]>([]);
  const [barQuery, setBarQuery] = useState('');
  const toggleShortlist = (barId: string) => {
    setShortlist((current) => {
      if (current.includes(barId)) return current.filter((id) => id !== barId);
      if (current.length >= SHORTLIST_CAP) return current;
      return [...current, barId];
    });
  };
  const barTerm = barQuery.trim().toLocaleLowerCase();
  const barMatches = useMemo(
    () => (barTerm === ''
      ? []
      : bars.filter((b) => b.name.toLocaleLowerCase().includes(barTerm)).slice(0, SHORTLIST_MATCHES)),
    [bars, barTerm],
  );
  const shortlistFull = shortlist.length >= SHORTLIST_CAP;

  /**
   * The unanimity DENOMINATOR, so every selected person counts — including
   * circle members who have ranked nothing.
   *
   * Panel finding (Codex, MEDIUM; founder item 6): this used to be built from
   * `followedFriends` alone, the RATING-QUALIFIED subset, so a selected member
   * with zero ranked bars never entered `total`. Under the founder rule a bar
   * is a Group Favorite only when EVERY member scored it >= 8.0, and "9.0 /
   * no score" is explicitly "not YET" — so silently dropping the unscored
   * member let a bar qualify without the score the rule requires of them.
   * They contribute no votes (they have none); they do count.
   */
  const participants: ConsensusParticipant[] = useMemo(
    () =>
      deriveConsensusParticipants({
        selected: effectiveSelected,
        you: youHasRatings ? { id: YOU_ID, label: 'You', ratings } : null,
        ratedPeople: followedFriends,
        unratedPeople: [...unratedCircle, ...groupPeople],
      }),
    [effectiveSelected, followedFriends, unratedCircle, groupPeople, ratings, youHasRatings],
  );

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
  // UX-E: the winning vibe SEEDS the list WITHIN each partition (review
  // HIGH: a vibe-matching near-miss must never outrank a unanimous pick
  // — "unanimous overlap leads" is the standing UX-B invariant, and the
  // top card carries the share moment). Applied before the cap so a
  // vibe-matching near-miss can still enter the tail of the top 5.
  //
  // Panel finding (both lanes, HIGH): the two partitions used to be
  // concatenated and rendered identically, so `alsoConsider` — which is BY
  // DEFINITION the set that is NOT a Group Favorite — was displayed as one,
  // star and share moment included. The founder's own "9.0 / 7.5" and
  // "9.0 / 2.0" rows appeared as Group Favorites. Each entry now carries
  // which partition it came from, and the card marks a near-miss.
  const groupFavorites = useMemo<RankedEntry[]>(() => {
    const tagsOf = (entry: ConsensusEntry): readonly string[] =>
      barById(entry.barId)?.tags ?? [];
    const flag = (
      entries: ConsensusEntry[],
      isGroupFavorite: boolean,
    ): RankedEntry[] => entries.map((e) => ({ ...e, isGroupFavorite }));
    return [
      ...flag(boostByWinningVibe(overlap, vibeVotes.winner, tagsOf), true),
      ...flag(boostByWinningVibe(alsoConsider, vibeVotes.winner, tagsOf), false),
    ].slice(0, 5);
  }, [overlap, alsoConsider, vibeVotes.winner]);

  /** True when nothing is unanimous and the list is near-misses only. */
  const noUnanimousPick = groupFavorites.every((e) => !e.isGroupFavorite);

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
        {/* V9-05 flow order: plan details → who's going → suggested bars →
            the ONE action that creates the plan and sends its invitations, at
            the bottom. StartNightOutButton renders the details rows first and
            the CTA last; everything between is passed as its children, so the
            canonical night_outs entry point (V8-3) still owns the whole
            create → invite → suggest sequence. Signed out it renders only the
            children (creation is an authenticated RPC). */}
        <StartNightOutButton
          inviteeIds={inviteeIds}
          inviteeGroupByUser={inviteeGroupByUser}
          shortlistBarIds={isServer ? shortlist : []}
          labelFor={(id) => recipientPeople.find((p) => p.id === id)?.label ?? barById(id)?.name}
          onBusyChange={setCreating}
          disabled={followsLoading || !circleReady || membersLoading}
        >
        {/* A held button with no explanation is its own defect (round-3 panel,
            Claude): the only primary CTA on the page renders greyed out for the
            whole mount with nothing saying why. Withholding the action is still
            right — an invite list we cannot vouch for is how a plan goes out
            with no guests — but the user is owed the reason and a way forward.
            Keyed to circleFailed, NOT !circleReady: the latter is also false
            while a follow is merely unsettled, where "reload" would be both
            untrue and destructive (round-5 panel, Claude). */}
        {isServer && circleFailed ? (
          <p className="mt-2 text-sm text-red-400">
            Couldn&apos;t load your circle, so we can&apos;t invite anyone yet.
            Check your connection and reload.
          </p>
        ) : null}

        <h2 className="font-label text-xs uppercase tracking-[0.25em] text-muted mt-8 mb-3 text-left">
          Who&apos;s going
        </h2>
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
        </div>

        <RecipientPicker
          people={recipientPeople}
          circleIds={isServer ? circle.map((p) => p.id) : followedFriends.map((p) => p.id)}
          selected={effectiveSelected}
          groupMembers={groupMembers}
          onToggle={toggle}
          onGroupChange={changeGroup}
          onBusy={setMembersLoading}
          userId={auth.status === 'signed-in' ? auth.user.id : null}
          isServer={isServer}
          loading={followsLoading || (!circleReady && !circleFailed)}
          failed={circleFailed}
          disabled={creating}
        />
        {/* The generic /join share is gone from the planner (V9-05: "a generic
            /join share is not a plan invitation"). The plan's own invite link
            lives on the plan page, which the action below opens. */}

        {/* Copy follows the denominator fix above: an unranked member DOES
            now affect the picks — a bar is not a Group Favorite until
            everyone selected has scored it. Saying they "don't sway the
            picks" became untrue the moment they entered `total`. */}
        {isServer && unratedFriendCount > 0 ? (
          <p className="text-muted text-xs text-center mb-8">
            {unratedFriendCount} of your circle{' '}
            {unratedFriendCount === 1 ? "hasn't" : "haven't"} ranked any bars
            yet — bring them along, but nothing is a Group Favorite until
            everyone you pick has scored it.
          </p>
        ) : null}

        <h2 className="font-label text-xs uppercase tracking-[0.25em] text-muted mt-8 mb-3 text-left">
          Suggested bars
        </h2>

        {/* UX-E — TONIGHT'S VIBE poll (0017; renders nothing while the
            migration is unapplied). Sits above Group Favorites because
            the winner seeds them. Real circles only, like People's
            Choice. */}
        {isServer ? <VibeVotePoll {...vibeVotes} /> : null}

        {/* V9-05: the organizer's shortlist for the plan's vote. Picked from
            the Group Favorites cards below or by name here; put on the board
            with `suggest_night_out_bar` the moment the plan exists. */}
        {isServer ? (
          <div className="mb-6 space-y-3 text-left" role="group" aria-label="Shortlist for the vote">
            <div>
              <label htmlFor="shortlist-search" className="block text-sm text-muted mb-1">
                Add a bar to the shortlist
              </label>
              <input
                id="shortlist-search"
                type="search"
                value={barQuery}
                disabled={creating}
                placeholder="Search by name"
                className="w-full rounded-xl border border-border bg-surface px-3 py-2 min-h-[44px] text-text"
                onChange={(event) => setBarQuery(event.target.value)}
              />
              {barTerm !== '' && barMatches.length === 0 ? (
                <p className="mt-1 text-sm text-muted">No matching bars.</p>
              ) : null}
              {barMatches.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  {barMatches.map((bar) => {
                    const on = shortlist.includes(bar.id);
                    return (
                      <button
                        type="button"
                        key={bar.id}
                        aria-pressed={on}
                        disabled={creating || (!on && shortlistFull)}
                        className={[
                          'rounded-full border px-3 py-2 text-sm min-h-[44px] touch-manipulation',
                          on ? 'border-accent bg-accent/10 text-text' : 'border-border bg-surface text-muted',
                        ].join(' ')}
                        onClick={() => toggleShortlist(bar.id)}
                      >
                        {bar.name} <span aria-hidden="true">{on ? '✓' : '+'}</span>
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>
            <p className="font-display text-sm" aria-live="polite">
              Shortlist · {shortlist.length} of {SHORTLIST_CAP} bars
            </p>
            {shortlist.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {shortlist.map((id) => (
                  <button
                    type="button"
                    key={id}
                    aria-label={`Remove ${barById(id)?.name ?? id} from the shortlist`}
                    disabled={creating}
                    className="rounded-full border border-border bg-surface px-3 py-2 text-sm min-h-[44px] touch-manipulation"
                    onClick={() => toggleShortlist(id)}
                  >
                    {barById(id)?.name ?? id} <span aria-hidden="true">×</span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted">
                Nothing yet — the group votes on whatever you and they suggest.
              </p>
            )}
          </div>
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
            <h2 className="font-label text-xs uppercase tracking-[0.25em] text-muted mb-4">
              Group Favorites
              {vibeVotes.winner ? (
                <span
                  data-testid="winning-vibe-chip"
                  className="ml-2 normal-case tracking-normal inline-flex items-center rounded-full border border-accent px-2 py-0.5 text-[11px] text-accent"
                >
                  Tonight: {displayTag(vibeVotes.winner)}
                </span>
              ) : null}
            </h2>
            {groupFavorites.length === 0 ? (
              <p
                className="text-muted text-sm leading-relaxed"
                data-testid="group-favorites-empty"
              >
                {isServer
                  ? // Server mode is EXPECTED to be empty until scores cross
                    // the friend boundary (that migration is its own T0 goal).
                    // The old copy — "rate a few bars and this fills in" —
                    // was advice that could not come true here, so it said the
                    // feature was broken. Say what is actually true instead.
                    "A bar becomes a Group Favorite once everyone here has scored it 8.0 or better. Your circle's scores aren't shared yet, so there's nothing to agree on."
                  : 'No shared history yet — rate a few bars and this fills in.'}
              </p>
            ) : (
              <>
                {noUnanimousPick ? (
                  <p
                    className="text-muted text-sm leading-relaxed mb-3"
                    data-testid="no-unanimous-pick"
                  >
                    Nothing is unanimous yet — these are the closest.
                  </p>
                ) : null}
                <div className="space-y-2">
                  {groupFavorites.map((entry, i) => (
                    <ConsensusCard
                      key={entry.barId}
                      entry={entry}
                      rank={i + 1}
                      index={i}
                      /* Only a genuine Group Favorite gets the star and the
                         share moment. Near-misses sort after the unanimous
                         picks, so this is false for every card whenever
                         `overlap` is empty. */
                      highlight={i === 0 && entry.isGroupFavorite}
                      shortlisted={shortlist.includes(entry.barId)}
                      onShortlist={
                        isServer
                          ? () => toggleShortlist(entry.barId)
                          : undefined
                      }
                      shortlistDisabled={creating || (shortlistFull && !shortlist.includes(entry.barId))}
                    />
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {/* Part 2 — PEOPLE'S CHOICE: the tabular poll (photo + name +
            vote tally; real circles only — demo curators can't suggest). A
            tonight-wide poll, not this plan's vote: it stays visible as a
            source of ideas and is not the shortlist. */}
        {isServer ? <TonightSuggestions /> : null}
        </StartNightOutButton>
      </section>
    </main>
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
  shortlisted = false,
  onShortlist,
  shortlistDisabled = false,
}: {
  entry: RankedEntry;
  rank?: number;
  index?: number;
  highlight?: boolean;
  /** V9-05: on the organizer's shortlist for the plan's vote. */
  shortlisted?: boolean;
  /** V9-05: absent in demo mode, where no plan can be created. */
  onShortlist?: () => void;
  shortlistDisabled?: boolean;
}): JSX.Element {
  const bar = barById(entry.barId);
  if (!bar) return <></>;
  const nearMiss = !entry.isGroupFavorite;
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
      {/* A near-miss shares the one list (UX-B) but must not read as a Group
          Favorite: someone here scored it under 8.0, or has not scored it at
          all. Said in words, not colour alone. */}
      {nearMiss ? (
        <p
          data-testid="near-miss-badge"
          className="mt-1.5 inline-flex items-center rounded-full border border-border px-2 py-0.5 text-[11px] text-muted"
        >
          Not a Group Favorite yet
        </p>
      ) : null}
      {onShortlist ? (
        <button
          type="button"
          aria-pressed={shortlisted}
          aria-label={shortlisted ? `Remove ${bar.name} from the shortlist` : `Add ${bar.name} to the shortlist`}
          disabled={shortlistDisabled}
          onClick={onShortlist}
          className={[
            'mt-2 rounded-full border px-3 py-2 text-sm min-h-[44px] touch-manipulation disabled:opacity-50',
            shortlisted ? 'border-accent bg-accent/10 text-text' : 'border-border bg-surface text-muted',
          ].join(' ')}
        >
          {shortlisted ? 'On the shortlist ✓' : 'Add to shortlist'}
        </button>
      ) : null}
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
