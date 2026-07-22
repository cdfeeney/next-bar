'use client';

import Link from 'next/link';
import Avatar from '@/components/Avatar';
import { topRatedBars, lovedCount, type DemoFriend } from '@/lib/demo';

/**
 * A friend in the Friends feed: identity + their top picks, with a
 * follow/unfollow control. The whole card links to the full profile; the
 * follow button stops propagation so tapping it doesn't navigate.
 */
export default function FriendCard({
  friend,
  following,
  onToggleFollow,
}: {
  friend: DemoFriend;
  following: boolean;
  onToggleFollow: (handle: string) => void;
}): JSX.Element {
  const top = topRatedBars(friend, 3);
  const loved = lovedCount(friend);

  return (
    <article className="rise bg-surface border border-border rounded-3xl p-5">
      <div className="flex items-start gap-4">
        <Link href={`/u/${friend.handle}`} aria-label={`View ${friend.displayName}`}>
          <Avatar initials={friend.initials} seed={friend.handle} size="md" />
        </Link>
        <div className="min-w-0 flex-1">
          <Link href={`/u/${friend.handle}`} className="block">
            <h3 className="font-display text-lg leading-tight truncate">
              {friend.displayName}
            </h3>
            <p className="text-muted text-xs truncate">
              @{friend.handle} · {friend.archetype}
            </p>
          </Link>
        </div>
        <button
          type="button"
          aria-pressed={following}
          onClick={() => onToggleFollow(friend.handle)}
          className={[
            'shrink-0 min-h-[36px] touch-manipulation px-4 rounded-full text-sm font-display border transition-colors',
            following
              ? 'bg-transparent border-border text-muted hover:text-text'
              : 'bg-accent border-accent text-bg',
          ].join(' ')}
        >
          {following ? 'Following' : 'Follow'}
        </button>
      </div>

      <p className="text-muted text-[11px] uppercase tracking-widest mt-4 mb-2">
        {loved} loved · top picks
      </p>
      <ul className="space-y-1.5">
        {top.map(({ rating, bar }) => (
          <li key={bar.id} className="flex items-baseline justify-between gap-3">
            <span className="text-sm truncate">{bar.name}</span>
            <span className="font-display text-accent tabular-nums text-sm shrink-0">
              {(rating.score ?? 0).toFixed(1)}
            </span>
          </li>
        ))}
      </ul>

      <Link
        href={`/u/${friend.handle}`}
        className="inline-flex items-center text-accent text-sm mt-4 underline-offset-4 hover:underline min-h-[44px] touch-manipulation"
      >
        See full list →
      </Link>
    </article>
  );
}
