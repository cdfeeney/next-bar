'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { CircleRow } from '@/components/FollowRows';
import { useFollows } from '@/hooks/useFollows';
import { demoFriends } from '@/lib/demo';

/**
 * /friends/following — the Instagram-style following list (UX-A).
 * Outgoing requests to private accounts show "Requested" (tap
 * withdraws). Signed-out shows the followed demo curators.
 *
 * S-09: a FAILED read says so with a retry, distinct from the empty state
 * (the G-01 defect); the empty state names the consequence; and a refused
 * unfollow is surfaced rather than silently reverted.
 */
export default function FollowingPage(): JSX.Element {
  const {
    circle,
    requested,
    mode,
    isFollowing,
    toggleFollow,
    loading,
    circleFailed,
    followNotice,
    dismissFollowNotice,
    retry,
  } = useFollows();

  const demoFollowed = useMemo(
    () => demoFriends.filter((f) => isFollowing(f.handle)),
    [isFollowing],
  );

  const emptyState = (
    <div data-testid="following-empty">
      <p className="text-muted text-sm">
        You&apos;re not following anyone yet. Your Tonight stays empty until you
        follow a few people — that&apos;s who it&apos;s built from.
      </p>
      <Link
        href="/friends/people"
        className="mt-3 inline-flex items-center min-h-[44px] text-accent underline-offset-4 hover:underline touch-manipulation"
      >
        Find friends →
      </Link>
    </div>
  );

  const notice =
    followNotice !== null ? (
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
    ) : null;

  return (
    <main className="min-h-screen pb-28">
      <header className="px-6 pt-8 pb-4">
        <Link
          href="/friends"
          className="text-muted text-sm underline-offset-4 hover:underline min-h-[44px] inline-flex items-center touch-manipulation"
        >
          ← Friends
        </Link>
        <h1 className="font-display text-3xl mt-2">Following</h1>
      </header>

      <section className="max-w-md mx-auto px-6">
        {notice}
        {mode !== 'server' ? (
          demoFollowed.length === 0 ? (
            emptyState
          ) : (
            <div className="space-y-3" data-testid="following-list">
              {demoFollowed.map((f) => (
                <CircleRow
                  key={f.handle}
                  profile={{
                    id: f.handle,
                    handle: f.handle,
                    displayName: f.displayName,
                  }}
                  onUnfollow={toggleFollow}
                />
              ))}
            </div>
          )
        ) : loading ? (
          <p className="text-muted text-sm" role="status">
            Loading…
          </p>
        ) : circleFailed ? (
          <div data-testid="following-error" role="status">
            <p className="text-muted text-sm">Couldn&apos;t load who you follow.</p>
            <button
              type="button"
              onClick={retry}
              className="mt-3 inline-flex items-center min-h-[44px] px-5 rounded-full border border-accent text-accent font-display text-sm touch-manipulation hover:bg-accent hover:text-bg transition-colors"
            >
              Try again
            </button>
          </div>
        ) : circle.length === 0 && requested.length === 0 ? (
          emptyState
        ) : (
          <div className="space-y-6">
            {/* The Following ROWS are the follows — the same set the People
                tile counts (requests are not follows, Instagram semantics). An
                outgoing request is a separate, withdrawable state, so it sits
                under its own heading rather than inflating the Following list
                past its count (S-09 round-1: tile-vs-rows must agree). */}
            {circle.length > 0 ? (
              <div className="space-y-3" data-testid="following-list">
                {circle.map((p) => (
                  <CircleRow key={p.handle} profile={p} onUnfollow={toggleFollow} />
                ))}
              </div>
            ) : null}
            {requested.length > 0 ? (
              <div>
                <h2 className="font-label text-xs uppercase tracking-[0.25em] text-muted mb-3">
                  Requested · {requested.length}
                </h2>
                <div className="space-y-3" data-testid="following-requested">
                  {requested.map((p) => (
                    <CircleRow
                      key={`req-${p.handle}`}
                      profile={p}
                      pending
                      onUnfollow={toggleFollow}
                    />
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        )}
      </section>
    </main>
  );
}
