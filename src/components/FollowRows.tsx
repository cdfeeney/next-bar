'use client';

import Link from 'next/link';
import type { FollowRequest, PublicProfile } from '@/lib/follows.server';

/**
 * Shared follow-graph rows (UX-A): the same three row shapes render on
 * /friends (requests), /friends/followers, and /friends/following —
 * extracted so the Instagram-model split can't drift the row behavior.
 */

export function CircleRow({
  profile,
  pending = false,
  onUnfollow,
}: {
  profile: PublicProfile;
  /** True for an outgoing request awaiting consent — tap withdraws (B3b). */
  pending?: boolean;
  onUnfollow: (handle: string) => void;
}): JSX.Element {
  return (
    <div className="flex items-center justify-between gap-3 bg-surface border border-border rounded-2xl p-3">
      <Link href={`/u/${profile.handle}`} className="min-w-0 flex-1">
        <p className="font-display text-sm truncate">
          {profile.displayName ?? `@${profile.handle}`}
        </p>
        <p className="text-muted text-xs truncate">@{profile.handle}</p>
      </Link>
      <button
        type="button"
        aria-pressed
        onClick={() => onUnfollow(profile.handle)}
        className="shrink-0 min-h-[44px] touch-manipulation px-4 rounded-full text-sm font-display border bg-transparent border-border text-muted hover:text-text transition-colors"
      >
        {pending ? 'Requested' : 'Following'}
      </button>
    </div>
  );
}

/**
 * A follower row. Follow-back reuses toggleFollow, which honors B3b
 * request semantics for private accounts ("Requested" via `requested`).
 * Followers you already follow back show the quiet "Following" state.
 */
export function FollowerRow({
  profile,
  following,
  requested,
  onToggle,
}: {
  profile: PublicProfile;
  following: boolean;
  requested: boolean;
  onToggle: (handle: string) => void;
}): JSX.Element {
  return (
    <div className="flex items-center justify-between gap-3 bg-surface border border-border rounded-2xl p-3">
      <Link href={`/u/${profile.handle}`} className="min-w-0 flex-1">
        <p className="font-display text-sm truncate">
          {profile.displayName ?? `@${profile.handle}`}
        </p>
        <p className="text-muted text-xs truncate">@{profile.handle}</p>
      </Link>
      <button
        type="button"
        aria-pressed={following || requested}
        onClick={() => onToggle(profile.handle)}
        className={[
          'shrink-0 min-h-[44px] touch-manipulation px-4 rounded-full text-sm font-display border transition-colors',
          following || requested
            ? 'bg-transparent border-border text-muted hover:text-text'
            : 'bg-accent border-accent text-bg',
        ].join(' ')}
      >
        {following ? 'Following' : requested ? 'Requested' : 'Follow back'}
      </button>
    </div>
  );
}

/**
 * One incoming follow request (B3b consent inbox): accept creates the
 * edge on the requester's side, decline discards. Both are optimistic in
 * the hook — a server refusal puts the row back.
 */
export function RequestRow({
  request,
  onAccept,
  onDecline,
}: {
  request: FollowRequest;
  onAccept: (requesterId: string) => void;
  onDecline: (requesterId: string) => void;
}): JSX.Element {
  return (
    <div className="flex items-center justify-between gap-3 bg-surface border border-border rounded-2xl p-3">
      <Link href={`/u/${request.handle}`} className="min-w-0 flex-1">
        <p className="font-display text-sm truncate">
          {request.displayName ?? `@${request.handle}`}
        </p>
        <p className="text-muted text-xs truncate">
          @{request.handle} · wants to follow you
        </p>
      </Link>
      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={() => onAccept(request.id)}
          className="min-h-[44px] touch-manipulation px-4 rounded-full text-sm font-display bg-accent text-bg"
        >
          Accept
        </button>
        <button
          type="button"
          onClick={() => onDecline(request.id)}
          aria-label={`Decline follow request from @${request.handle}`}
          className="min-h-[44px] touch-manipulation px-3 rounded-full text-sm font-display border border-border text-muted hover:text-text transition-colors"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
