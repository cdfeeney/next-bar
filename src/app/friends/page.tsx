'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import FriendCard from '@/components/FriendCard';
import TonightSection from '@/components/TonightSection';
import { useFollows } from '@/hooks/useFollows';
import { demoFriends } from '@/lib/demo';

export default function FriendsPage(): JSX.Element {
  const { isFollowing, toggleFollow, loading } = useFollows();
  const [query, setQuery] = useState('');

  const followed = useMemo(
    () => demoFriends.filter((f) => isFollowing(f.handle)),
    [isFollowing],
  );
  const suggested = useMemo(
    () => demoFriends.filter((f) => !isFollowing(f.handle)),
    [isFollowing],
  );

  const q = query.trim().toLowerCase().replace(/^@/, '');
  const searchMatches = useMemo(() => {
    if (q.length === 0) return suggested;
    return suggested.filter(
      (f) =>
        f.handle.includes(q) ||
        f.displayName.toLowerCase().includes(q) ||
        f.archetype.toLowerCase().includes(q),
    );
  }, [q, suggested]);

  return (
    <main className="min-h-screen pb-28">
      <header className="px-6 pt-8 pb-4 text-center">
        <p className="text-accent uppercase tracking-[0.25em] text-xs mb-3">
          Your people, ranked
        </p>
        <h1 className="font-display text-3xl md:text-4xl mb-2">Friends</h1>
        <p className="text-muted text-sm max-w-md mx-auto">
          See what people you actually trust rated highly — no influencers, no
          noise. Then find the bar your whole group agrees on.
        </p>
      </header>

      <section className="max-w-md mx-auto px-6 space-y-10">
        {/* Where should we go? — the marquee consensus moment. */}
        <Link
          href="/friends/consensus"
          className="block bg-accent text-bg rounded-3xl p-6 touch-manipulation hover:bg-accentDim transition-colors"
        >
          <p className="font-display text-2xl leading-snug mb-1">
            Where should we go? →
          </p>
          <p className="text-bg/80 text-sm leading-relaxed">
            Pick a few friends and Next Bar finds the spots everyone&apos;s
            rated highly. No more group-chat paralysis.
          </p>
        </Link>

        {/* Tonight — live intent (B2): your toggle + the circle's signals. */}
        <TonightSection friends={followed} />

        {/* Your circle */}
        <div>
          <h2 className="font-display text-xs uppercase tracking-[0.25em] text-muted mb-4">
            Your circle{followed.length > 0 ? ` · ${followed.length}` : ''}
          </h2>
          {loading ? (
            <p className="text-muted text-sm">Loading…</p>
          ) : followed.length === 0 ? (
            <div className="bg-surface border border-border rounded-3xl p-6 text-center">
              <p className="text-sm text-muted leading-relaxed">
                You&apos;re not following anyone yet. Add a few of the
                tastemakers below to fill your feed.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {followed.map((f) => (
                <FriendCard
                  key={f.handle}
                  friend={f}
                  following
                  onToggleFollow={toggleFollow}
                />
              ))}
            </div>
          )}
        </div>

        {/* Discover / add by handle */}
        <div>
          <h2 className="font-display text-xs uppercase tracking-[0.25em] text-muted mb-4">
            Find friends
          </h2>
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
            {searchMatches.length === 0 ? (
              <p className="text-muted text-sm px-1">
                {q.length > 0
                  ? `No one matching "${query}" to add.`
                  : 'You already follow everyone we’ve curated. More tastemakers coming soon.'}
              </p>
            ) : (
              searchMatches.map((f) => (
                <div
                  key={f.handle}
                  className="flex items-center justify-between gap-3 bg-surface border border-border rounded-2xl p-3"
                >
                  <Link
                    href={`/u/${f.handle}`}
                    className="min-w-0 flex-1"
                  >
                    <p className="font-display text-sm truncate">
                      {f.displayName}
                    </p>
                    <p className="text-muted text-xs truncate">
                      @{f.handle} · {f.archetype}
                    </p>
                  </Link>
                  <button
                    type="button"
                    onClick={() => toggleFollow(f.handle)}
                    className="shrink-0 min-h-[36px] touch-manipulation px-4 rounded-full text-sm font-display bg-accent text-bg"
                  >
                    Follow
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        <p className="text-muted text-xs text-center leading-relaxed pt-2">
          Private by default — only people you follow back see your full list.
          Phone-contact sync arrives with the native app.
        </p>
      </section>
    </main>
  );
}
