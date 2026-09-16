'use client';

import Link from 'next/link';
import { FollowerRow } from '@/components/FollowRows';
import { useFollows } from '@/hooks/useFollows';

/**
 * /friends/followers — the Instagram-style followers list (UX-A). One
 * list, one row shape: people you follow back read "Following"; the rest
 * get the accent "Follow back" (B3b request semantics apply).
 *
 * S-09: a FAILED read says so with a retry and is visibly distinct from an
 * empty list (the G-01 defect, not repeated here); the empty state names the
 * consequence, not the absence; and a refused follow-back is surfaced, never
 * silently rolled back.
 */
export default function FollowersPage(): JSX.Element {
  const {
    followers,
    mode,
    isFollowing,
    isRequested,
    toggleFollow,
    loading,
    circleFailed,
    followNotice,
    dismissFollowNotice,
    retry,
  } = useFollows();

  return (
    <main className="min-h-screen pb-28">
      <header className="px-6 pt-8 pb-4">
        <Link
          href="/friends"
          className="text-muted text-sm underline-offset-4 hover:underline min-h-[44px] inline-flex items-center touch-manipulation"
        >
          ← Friends
        </Link>
        <h1 className="font-display text-3xl mt-2">Followers</h1>
      </header>

      <section className="max-w-md mx-auto px-6">
        {followNotice !== null ? (
          <div
            role="status"
            data-testid="follow-notice"
            className="mb-4 flex items-center justify-between gap-3 rounded-2xl border border-border bg-surface px-4 py-3 text-sm text-text"
          >
            <span>{followNotice}</span>
            <button
              type="button"
              onClick={dismissFollowNotice}
              aria-label="Dismiss"
              className="shrink-0 min-h-[44px] px-2 text-muted hover:text-text touch-manipulation"
            >
              ✕
            </button>
          </div>
        ) : null}

        {mode !== 'server' ? (
          <p className="text-muted text-sm">Sign in to see your followers.</p>
        ) : loading ? (
          <p className="text-muted text-sm" role="status">
            Loading…
          </p>
        ) : circleFailed ? (
          <div data-testid="followers-error" role="status">
            <p className="text-muted text-sm">Couldn&apos;t load your followers.</p>
            <button
              type="button"
              onClick={retry}
              className="mt-3 inline-flex items-center min-h-[44px] px-5 rounded-full border border-accent text-accent font-display text-sm touch-manipulation hover:bg-accent hover:text-bg transition-colors"
            >
              Try again
            </button>
          </div>
        ) : followers.length === 0 ? (
          <div data-testid="followers-empty">
            <p className="text-muted text-sm">
              Nobody follows you yet. People who follow you can see your pins and
              stories, and show up in your Tonight.
            </p>
            <Link
              href="/friends/people"
              className="mt-3 inline-flex items-center min-h-[44px] text-accent underline-offset-4 hover:underline touch-manipulation"
            >
              Find friends →
            </Link>
          </div>
        ) : (
          <div className="space-y-3" data-testid="followers-list">
            {followers.map((p) => (
              <FollowerRow
                key={p.handle}
                profile={p}
                following={isFollowing(p.handle)}
                requested={isRequested(p.handle)}
                onToggle={toggleFollow}
              />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
