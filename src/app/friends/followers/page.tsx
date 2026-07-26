'use client';

import Link from 'next/link';
import { FollowerRow } from '@/components/FollowRows';
import { useFollows } from '@/hooks/useFollows';

/**
 * /friends/followers — the Instagram-style followers list (UX-A). One
 * list, one row shape: people you follow back read "Following"; the rest
 * get the accent "Follow back" (B3b request semantics apply).
 */
export default function FollowersPage(): JSX.Element {
  const { followers, mode, isFollowing, isRequested, toggleFollow, loading } =
    useFollows();

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
        {mode !== 'server' ? (
          <p className="text-muted text-sm">Sign in to see your followers.</p>
        ) : loading ? (
          <p className="text-muted text-sm" role="status">
            Loading…
          </p>
        ) : followers.length === 0 ? (
          <p className="text-muted text-sm">
            No followers yet.{' '}
            <Link
              href="/friends"
              className="text-accent underline-offset-4 hover:underline"
            >
              Find friends →
            </Link>
          </p>
        ) : (
          <div className="space-y-3">
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
