'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import Avatar from '@/components/Avatar';
import ShareButton from '@/components/ShareButton';
import { buildProfilePath, shareProfileText } from '@/lib/share';
import { useAuth } from '@/hooks/useAuth';
import { useFollows } from '@/hooks/useFollows';
import { findDemoFriend, topRatedBars, lovedCount } from '@/lib/demo';
import { getBarById } from '@/lib/catalog';
import { getBrowserSupabase } from '@/lib/supabase/client';
import {
  fetchFollowerCount,
  fetchFriendRatings,
  getProfileByHandle,
  type FriendRating,
  type PublicProfile,
} from '@/lib/follows.server';
import type { Rating } from '@/types/ratings';

const RATING_LABEL: Record<Rating, string> = {
  loved: 'Loved',
  liked: 'Liked',
  pass: 'Pass',
};

const RATING_BADGE: Record<Rating, string> = {
  loved: 'bg-accent text-bg',
  liked: 'bg-surface border border-accent text-accent',
  pass: 'bg-surface border border-border text-muted',
};

/** loved > liked > pass; within a tier, most recently rated first. */
const TIER_ORDER: Record<Rating, number> = { loved: 0, liked: 1, pass: 2 };

function tierRank(ratings: FriendRating[]): FriendRating[] {
  return ratings
    .slice()
    .sort(
      (a, b) =>
        TIER_ORDER[a.rating] - TIER_ORDER[b.rating] ||
        Date.parse(b.ratedAt) - Date.parse(a.ratedAt),
    );
}

function initialsFor(profile: PublicProfile): string {
  const source = profile.displayName ?? profile.handle;
  const words = source.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return source.slice(0, 2).toUpperCase();
}

type ProfileState =
  | { kind: 'loading' }
  | { kind: 'not-found' }
  | { kind: 'ready'; profile: PublicProfile };

/**
 * /u/[handle] — dual-mode (B3):
 *   signed-out → seeded demo curator profiles (unchanged v0.4 behavior).
 *   signed-in  → REAL lookup via get_profile_by_handle; notFound() on
 *                unknown; a friend's tier-ranked list through the
 *                friend_ratings view (tier only — scores are owner-only and
 *                never leave the server for friends).
 */
export default function ProfilePage({
  params,
}: {
  params: { handle: string };
}): JSX.Element {
  const auth = useAuth();
  const { isFollowing, toggleFollow } = useFollows();
  const [state, setState] = useState<ProfileState>({ kind: 'loading' });
  const [followerCount, setFollowerCount] = useState<number | null>(null);
  const [friendRatings, setFriendRatings] = useState<FriendRating[] | null>(
    null,
  );

  const isServer = auth.status === 'signed-in' && getBrowserSupabase() !== null;

  // Real profile lookup (signed-in only).
  useEffect(() => {
    if (auth.status === 'loading' || !isServer) return;
    const supabase = getBrowserSupabase();
    if (!supabase) return;

    let cancelled = false;
    setState({ kind: 'loading' });
    // Reset with the profile — profile B must never wear profile A's
    // count for a roundtrip (Opus B3c review).
    setFollowerCount(null);
    void (async () => {
      const profile = await getProfileByHandle(supabase, params.handle);
      if (cancelled) return;
      setState(profile ? { kind: 'ready', profile } : { kind: 'not-found' });
      // B3c: follower COUNT (public profiles + private ones you follow;
      // hidden profiles return null and we show nothing).
      if (profile) {
        const count = await fetchFollowerCount(supabase, profile.id);
        if (!cancelled) setFollowerCount(count);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [auth.status, isServer, params.handle]);

  // Friend list — only meaningful once following (the view returns [] for
  // non-followees anyway; the gate just avoids a pointless roundtrip).
  const profile = state.kind === 'ready' ? state.profile : null;
  const following = profile !== null && isFollowing(profile.handle);
  useEffect(() => {
    if (!profile || !following) {
      setFriendRatings(null);
      return;
    }
    const supabase = getBrowserSupabase();
    if (!supabase) return;

    let cancelled = false;
    void (async () => {
      const ratings = await fetchFriendRatings(supabase, profile.id);
      if (cancelled) return;
      setFriendRatings(ratings);
    })();
    return () => {
      cancelled = true;
    };
  }, [profile?.id, following]);

  // Demo fallback ONLY when signed out / Supabase unavailable.
  if (!isServer && auth.status !== 'loading') {
    return <DemoProfile handle={params.handle} />;
  }

  if (auth.status === 'loading' || state.kind === 'loading') {
    return (
      <main className="min-h-screen pb-28">
        <header className="px-6 pt-8 pb-4">
          <BackLink />
        </header>
        <section className="max-w-md mx-auto px-6 text-center">
          <p className="text-muted text-sm" role="status">
            Loading profile…
          </p>
        </section>
      </main>
    );
  }

  if (state.kind === 'not-found') {
    notFound();
  }

  const ready = state as Extract<ProfileState, { kind: 'ready' }>;
  const p = ready.profile;
  const ranked = tierRank(friendRatings ?? []);

  return (
    <main className="min-h-screen pb-28">
      <header className="px-6 pt-8 pb-4">
        <BackLink />
      </header>

      <section className="max-w-md mx-auto px-6">
        <div className="flex flex-col items-center text-center">
          <Avatar initials={initialsFor(p)} seed={p.handle} size="lg" />
          <h1 className="font-display text-3xl mt-4">
            {p.displayName ?? `@${p.handle}`}
          </h1>
          <p className="text-muted text-sm mt-1">@{p.handle}</p>
          {followerCount !== null ? (
            <p className="text-muted text-xs mt-1">
              {followerCount} follower{followerCount === 1 ? '' : 's'}
            </p>
          ) : null}

          <div className="flex items-center gap-3 mt-6">
            <button
              type="button"
              aria-pressed={following}
              onClick={() => toggleFollow(p.handle)}
              className={[
                'min-h-[44px] touch-manipulation px-6 rounded-full font-display text-sm border transition-colors',
                following
                  ? 'bg-transparent border-border text-muted hover:text-text'
                  : 'bg-accent border-accent text-bg',
              ].join(' ')}
            >
              {following ? 'Following' : 'Follow'}
            </button>
            {/* The ranked list is the loop-starting artifact (goal E-week1):
                a profile travels to people who aren't in the app yet, which
                a pick card cannot do. */}
            <ShareButton
              path={buildProfilePath(p.handle)}
              text={shareProfileText(p.handle, p.displayName)}
              label="Share"
              ariaLabel={`Share @${p.handle}'s list`}
            />
          </div>
        </div>

        <h2 className="font-display text-xs uppercase tracking-[0.25em] text-muted mt-12 mb-4">
          {(p.displayName ?? p.handle).split(' ')[0]}&apos;s list
        </h2>

        {!following ? (
          <div className="bg-surface border border-border rounded-3xl p-6 text-center">
            <p className="text-sm text-muted leading-relaxed">
              Follow @{p.handle} to see their ranked list.
            </p>
          </div>
        ) : friendRatings === null ? (
          <p className="text-muted text-sm" role="status">
            Loading list…
          </p>
        ) : ranked.length === 0 ? (
          <div className="bg-surface border border-border rounded-3xl p-6 text-center">
            <p className="text-sm text-muted leading-relaxed">
              @{p.handle} hasn&apos;t rated any bars yet. Their list shows up
              here the moment they do.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {ranked.map((entry, idx) => {
              const bar = getBarById(entry.barId);
              if (!bar) return null;
              return (
                <article
                  key={entry.barId}
                  className="bg-surface border border-border rounded-3xl p-5 flex flex-col gap-2"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <h3 className="font-display text-lg leading-tight">
                      <span className="text-accent mr-2 tabular-nums">
                        {idx + 1}.
                      </span>
                      {bar.name}
                    </h3>
                    <span
                      className={[
                        'text-xs font-display px-2 py-0.5 rounded-full shrink-0',
                        RATING_BADGE[entry.rating],
                      ].join(' ')}
                    >
                      {RATING_LABEL[entry.rating]}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-muted text-xs uppercase tracking-wider">
                      {bar.neighborhood}
                    </span>
                  </div>
                  <p className="text-sm italic">{bar.blurb}</p>
                </article>
              );
            })}
          </div>
        )}

        <p className="text-muted text-xs text-center mt-8 leading-relaxed">
          Friends see tiers, never exact scores — those stay yours. Quiet by
          default: no feeds, no likes.
        </p>
      </section>
    </main>
  );
}

function BackLink(): JSX.Element {
  return (
    <Link
      href="/friends"
      className="text-muted text-sm underline-offset-4 hover:underline min-h-[44px] inline-flex items-center touch-manipulation"
    >
      ← Friends
    </Link>
  );
}

/** The v0.4 demo profile — reached only when signed out. */
function DemoProfile({ handle }: { handle: string }): JSX.Element {
  const friend = findDemoFriend(handle);
  const { isFollowing, toggleFollow } = useFollows();

  if (!friend) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center text-center px-6 pb-28">
        <h1 className="font-display text-2xl mb-2">No one here.</h1>
        <p className="text-muted text-sm mb-6 max-w-sm">
          We couldn&apos;t find @{handle}. They may not be on Next Bar yet.
        </p>
        <Link
          href="/friends"
          className="bg-accent text-bg rounded-full px-6 py-3 min-h-[44px] touch-manipulation font-display inline-flex items-center justify-center"
        >
          ← Back to Friends
        </Link>
      </main>
    );
  }

  const following = isFollowing(friend.handle);
  const entries = topRatedBars(friend);
  const loved = lovedCount(friend);

  return (
    <main className="min-h-screen pb-28">
      <header className="px-6 pt-8 pb-4">
        <BackLink />
      </header>

      <section className="max-w-md mx-auto px-6">
        <div className="flex flex-col items-center text-center">
          <Avatar initials={friend.initials} seed={friend.handle} size="lg" />
          <div className="flex items-center gap-2 mt-4">
            <h1 className="font-display text-3xl">{friend.displayName}</h1>
            {/* Seeded curator profile, not a real person — label it. */}
            <span className="shrink-0 rounded-full border border-border px-1.5 py-0.5 text-[9px] uppercase tracking-widest text-muted">
              demo
            </span>
          </div>
          <p className="text-muted text-sm mt-1">
            @{friend.handle} · {friend.archetype}
          </p>
          <p className="text-sm max-w-xs mt-3 leading-relaxed">{friend.blurb}</p>

          <div className="flex items-center gap-6 mt-5 text-center">
            <Stat value={friend.ratings.length} label="Rated" />
            <Stat value={loved} label="Loved" accent />
            <Stat value={friend.followers} label="Followers" />
          </div>

          <div className="flex items-center gap-3 mt-6">
            <button
              type="button"
              aria-pressed={following}
              onClick={() => toggleFollow(friend.handle)}
              className={[
                'min-h-[44px] touch-manipulation px-6 rounded-full font-display text-sm border transition-colors',
                following
                  ? 'bg-transparent border-border text-muted hover:text-text'
                  : 'bg-accent border-accent text-bg',
              ].join(' ')}
            >
              {following ? 'Following' : 'Follow'}
            </button>
            <Link
              href="/friends/consensus"
              className="min-h-[44px] touch-manipulation px-6 rounded-full font-display text-sm border border-accent text-accent inline-flex items-center"
            >
              Where to? →
            </Link>
            {/* Signed-out surface — this is the one a share recipient
                actually lands on, so it must be shareable onward too. */}
            <ShareButton
              path={buildProfilePath(friend.handle)}
              text={shareProfileText(friend.handle, friend.displayName)}
              label="Share"
              ariaLabel={`Share @${friend.handle}'s list`}
            />
          </div>
        </div>

        <h2 className="font-display text-xs uppercase tracking-[0.25em] text-muted mt-12 mb-4">
          {friend.displayName.split(' ')[0]}&apos;s list
        </h2>
        <div className="space-y-3">
          {entries.map(({ rating, bar }, idx) => (
            <article
              key={bar.id}
              className="bg-surface border border-border rounded-3xl p-5 flex flex-col gap-2"
            >
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="font-display text-lg leading-tight">
                  <span className="text-accent mr-2 tabular-nums">
                    {idx + 1}.
                  </span>
                  {bar.name}
                </h3>
                <span className="font-display text-2xl tabular-nums text-accent shrink-0">
                  {(rating.score ?? 0).toFixed(1)}
                </span>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-muted text-xs uppercase tracking-wider">
                  {bar.neighborhood}
                </span>
                <span
                  className={[
                    'text-xs font-display px-2 py-0.5 rounded-full',
                    RATING_BADGE[rating.rating],
                  ].join(' ')}
                >
                  {RATING_LABEL[rating.rating]}
                </span>
              </div>
              <p className="text-sm italic">{bar.blurb}</p>
            </article>
          ))}
        </div>

        <p className="text-muted text-xs text-center mt-8 leading-relaxed">
          Following each other unlocks full lists and group picks. Quiet by
          default — no feeds, no likes.
        </p>
      </section>
    </main>
  );
}

function Stat({
  value,
  label,
  accent = false,
}: {
  value: number;
  label: string;
  accent?: boolean;
}): JSX.Element {
  return (
    <div>
      <p
        className={[
          'font-display text-2xl tabular-nums leading-none',
          accent ? 'text-accent' : 'text-text',
        ].join(' ')}
      >
        {value}
      </p>
      <p className="text-[10px] uppercase tracking-widest text-muted mt-1">
        {label}
      </p>
    </div>
  );
}
