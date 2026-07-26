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
 */
export default function FollowingPage(): JSX.Element {
  const { circle, requested, mode, isFollowing, toggleFollow, loading } =
    useFollows();

  const demoFollowed = useMemo(
    () => demoFriends.filter((f) => isFollowing(f.handle)),
    [isFollowing],
  );

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
        {mode !== 'server' ? (
          demoFollowed.length === 0 ? (
            <p className="text-muted text-sm">
              Not following anyone yet.{' '}
              <Link
                href="/friends"
                className="text-accent underline-offset-4 hover:underline"
              >
                Find friends →
              </Link>
            </p>
          ) : (
            <div className="space-y-3">
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
        ) : circle.length === 0 && requested.length === 0 ? (
          <p className="text-muted text-sm">
            Not following anyone yet.{' '}
            <Link
              href="/friends"
              className="text-accent underline-offset-4 hover:underline"
            >
              Find friends →
            </Link>
          </p>
        ) : (
          <div className="space-y-3">
            {circle.map((p) => (
              <CircleRow key={p.handle} profile={p} onUnfollow={toggleFollow} />
            ))}
            {requested.map((p) => (
              <CircleRow
                key={`req-${p.handle}`}
                profile={p}
                pending
                onUnfollow={toggleFollow}
              />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
