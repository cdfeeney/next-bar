'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import FindFriends from '@/components/FindFriends';
import { RequestRow } from '@/components/FollowRows';
import { useAuth } from '@/hooks/useAuth';
import { useFollows } from '@/hooks/useFollows';
import { useFollowRequests } from '@/hooks/useFollowRequests';
import { useIntent, useNightRefresh } from '@/hooks/useIntent';
import { getBrowserSupabase } from '@/lib/supabase/client';
import {
  fetchCircleSuggestions,
  type CircleSuggestion,
} from '@/lib/suggestions.server';
import { nycNightKey } from '@/lib/nightKey';
import { getBarById } from '@/lib/catalog';
import { useBars } from '@/lib/useBars';
import { demoFriends } from '@/lib/demo';

/**
 * /friends — Instagram model (operator 2026-07-26): one action card, one
 * live "tonight" strip, two tappable stats. The stacked
 * Friends/Followers/Following lists moved to their own pages
 * (/friends/followers, /friends/following); requests stay inline because
 * consent must never hide. Copy is minimal by principle — obvious beats
 * explained.
 */
export default function FriendsPage(): JSX.Element {
  // 0019 swap-day rule: this page renders getBarById lookups — subscribe
  // so a live server-catalog swap re-renders them (checklist in catalog.ts).
  useBars();
  const auth = useAuth();
  const {
    circle,
    requested,
    followers,
    mode,
    isFollowing,
    isRequested,
    toggleFollow,
    loading,
  } = useFollows();
  const { requests, accept, decline } = useFollowRequests();
  const isServer = mode === 'server';

  const demoFollowedCount = useMemo(
    () => demoFriends.filter((f) => isFollowing(f.handle)).length,
    [isFollowing],
  );
  // Instagram semantics: pending requests are NOT follows — the count is
  // real edges only. The list page still shows withdrawable Requested rows.
  const followingCount = isServer ? circle.length : demoFollowedCount;
  const followerCount = isServer ? followers.length : 0;

  // TONIGHT — circle SUGGESTIONS (QA3: the poll board is the writer now
  // that I'm-in is gone), the "which bars friends are backing" view.
  // Night-scoped; refreshes on the shared clock signal so the strip
  // empties at rollover.
  const [suggestions, setSuggestions] = useState<CircleSuggestion[] | null>(
    null,
  );
  const [night, setNight] = useState(() => nycNightKey());
  useNightRefresh(() => setNight(nycNightKey()));
  useEffect(() => {
    if (!isServer || auth.status !== 'signed-in') {
      setSuggestions(null);
      return;
    }
    const supabase = getBrowserSupabase();
    if (!supabase) return;
    let cancelled = false;
    void (async () => {
      const rows = await fetchCircleSuggestions(supabase, night);
      if (!cancelled) setSuggestions(rows);
    })();
    return () => {
      cancelled = true;
    };
  }, [isServer, auth.status, night]);

  return (
    <main className="min-h-screen pb-28">
      <header className="px-6 pt-8 pb-4 text-center">
        <h1 className="font-display text-3xl md:text-4xl">Friends</h1>
      </header>

      <section className="max-w-md mx-auto px-6 space-y-8">
        {/* The one primary action (R2). */}
        <Link
          href="/friends/consensus"
          className="block bg-accent text-bg rounded-2xl px-5 py-3 text-center touch-manipulation hover:bg-accentDim transition-colors"
        >
          <p className="font-display text-lg leading-snug">Plan Night Out →</p>
        </Link>

        {/* Tonight — your status (one tap; tap again clears) and which
            bars the circle is backing (poll suggestions). Audience control
            (close friends vs friends) is the next slice. */}
        <div data-testid="friends-tonight">
          <h2 className="font-display text-xs uppercase tracking-[0.25em] text-muted mb-3">
            Tonight
          </h2>
          <IntentPills />
          {isServer && suggestions !== null && suggestions.length > 0 ? (
            <div className="space-y-2 mt-3">
              {suggestions.map((s) => {
                const bar = getBarById(s.barId);
                if (!bar) return null;
                const who = s.displayName ?? (s.handle ? `@${s.handle}` : 'Someone');
                return (
                  <Link
                    key={`${s.userId}-${s.barId}`}
                    href="/friends/consensus"
                    className="flex items-center justify-between gap-3 bg-surface border border-border rounded-2xl px-4 py-3 touch-manipulation hover:border-accent transition-colors"
                  >
                    <span className="font-display text-sm truncate">{who}</span>
                    <span className="text-accent font-display text-sm truncate shrink-0">
                      ▲ {bar.name}
                    </span>
                  </Link>
                );
              })}
            </div>
          ) : null}
        </div>

        {/* Instagram-style stats — each opens its list. */}
        <div className="grid grid-cols-2 gap-3" data-testid="follow-stats">
          <Link
            href="/friends/followers"
            className="bg-surface border border-border rounded-3xl py-5 text-center touch-manipulation hover:border-accent transition-colors"
          >
            <p className="font-display text-3xl tabular-nums leading-none">
              {loading ? '–' : followerCount}
            </p>
            <p className="text-[11px] uppercase tracking-widest text-muted mt-2">
              Followers
            </p>
          </Link>
          <Link
            href="/friends/following"
            className="bg-surface border border-border rounded-3xl py-5 text-center touch-manipulation hover:border-accent transition-colors"
          >
            <p className="font-display text-3xl tabular-nums leading-none">
              {loading ? '–' : followingCount}
            </p>
            <p className="text-[11px] uppercase tracking-widest text-muted mt-2">
              Following
            </p>
          </Link>
        </div>

        {/* Follow requests — consent inbox (B3b). Only when non-empty. */}
        {isServer && requests.length > 0 ? (
          <div>
            <h2 className="font-display text-xs uppercase tracking-[0.25em] text-muted mb-3">
              Requests · {requests.length}
            </h2>
            <div className="space-y-3">
              {requests.map((r) => (
                <RequestRow
                  key={r.id}
                  request={r}
                  onAccept={accept}
                  onDecline={decline}
                />
              ))}
            </div>
          </div>
        ) : null}

        {/* Find friends. */}
        <div>
          <h2 className="font-display text-xs uppercase tracking-[0.25em] text-muted mb-3">
            Find friends
          </h2>
          {isServer ? (
            <FindFriends
              isFollowing={isFollowing}
              isRequested={isRequested}
              toggleFollow={toggleFollow}
            />
          ) : (
            <DemoFind isFollowing={isFollowing} toggleFollow={toggleFollow} />
          )}
        </div>
      </section>
    </main>
  );
}

/** Your going-out status: one tap sets, tapping the lit pill clears. */
function IntentPills(): JSX.Element {
  const { intent, toggleIntent } = useIntent();
  const pill = (
    status: 'going' | 'maybe' | 'not-going',
    label: string,
  ): JSX.Element => {
    const active = intent?.status === status;
    return (
      <button
        type="button"
        aria-pressed={active}
        onClick={() => toggleIntent(status)}
        className={[
          'min-h-[44px] touch-manipulation px-5 rounded-full font-display text-sm border transition-colors',
          // Active = OUTLINED accent, never filled — the Plan Night Out
          // card owns the screen's one accent fill (R2, review HIGH).
          active
            ? 'bg-transparent border-accent text-accent'
            : 'bg-transparent border-border text-muted hover:text-text',
        ].join(' ')}
      >
        {label}
      </button>
    );
  };
  return (
    <div className="flex items-center gap-2" role="group" aria-label="Your status tonight">
      {pill('going', 'Going out')}
      {pill('maybe', 'Maybe')}
      {pill('not-going', 'Not tonight')}
    </div>
  );
}

/** Signed-out search over the seeded curators (unchanged demo behavior). */
function DemoFind({
  isFollowing,
  toggleFollow,
}: {
  isFollowing: (handle: string) => boolean;
  toggleFollow: (handle: string) => void;
}): JSX.Element {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase().replace(/^@/, '');
  const suggested = useMemo(
    () => demoFriends.filter((f) => !isFollowing(f.handle)),
    [isFollowing],
  );
  const matches = useMemo(() => {
    if (q.length === 0) return suggested;
    return suggested.filter(
      (f) =>
        f.handle.includes(q) ||
        f.displayName.toLowerCase().includes(q) ||
        f.archetype.toLowerCase().includes(q),
    );
  }, [q, suggested]);

  return (
    <>
      <label htmlFor="friend-search" className="sr-only">
        Search by name or handle
      </label>
      <input
        id="friend-search"
        type="search"
        inputMode="text"
        autoComplete="off"
        placeholder="Search @handle or name…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="w-full bg-surface border border-border rounded-2xl px-4 py-3 text-base text-text placeholder:text-muted focus:outline-none focus:border-accent min-h-[44px]"
      />
      <div className="mt-4 space-y-3">
        {matches.length === 0 ? (
          <p className="text-muted text-sm px-1">
            {q.length > 0 ? `No one matching "${query}".` : 'You follow everyone here.'}
          </p>
        ) : (
          matches.map((f) => (
            <div
              key={f.handle}
              className="flex items-center justify-between gap-3 bg-surface border border-border rounded-2xl p-3"
            >
              <Link href={`/u/${f.handle}`} className="min-w-0 flex-1">
                <p className="font-display text-sm truncate">{f.displayName}</p>
                <p className="text-muted text-xs truncate">
                  @{f.handle} · {f.archetype}
                </p>
              </Link>
              <button
                type="button"
                onClick={() => toggleFollow(f.handle)}
                className="shrink-0 min-h-[44px] touch-manipulation px-4 rounded-full text-sm font-display bg-accent text-bg"
              >
                Follow
              </button>
            </div>
          ))
        )}
      </div>
    </>
  );
}
