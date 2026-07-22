'use client';

import Link from 'next/link';
import Avatar from '@/components/Avatar';
import { useFollows } from '@/hooks/useFollows';
import { findDemoFriend, topRatedBars, lovedCount } from '@/lib/demo';
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

export default function ProfilePage({
  params,
}: {
  params: { handle: string };
}): JSX.Element {
  const friend = findDemoFriend(params.handle);
  const { isFollowing, toggleFollow } = useFollows();

  if (!friend) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center text-center px-6 pb-28">
        <h1 className="font-display text-2xl mb-2">No one here.</h1>
        <p className="text-muted text-sm mb-6 max-w-sm">
          We couldn&apos;t find @{params.handle}. They may not be on Next Bar
          yet.
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
        <Link
          href="/friends"
          className="text-muted text-sm underline-offset-4 hover:underline min-h-[44px] inline-flex items-center touch-manipulation"
        >
          ← Friends
        </Link>
      </header>

      <section className="max-w-md mx-auto px-6">
        <div className="flex flex-col items-center text-center">
          <Avatar initials={friend.initials} seed={friend.handle} size="lg" />
          <h1 className="font-display text-3xl mt-4">{friend.displayName}</h1>
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
