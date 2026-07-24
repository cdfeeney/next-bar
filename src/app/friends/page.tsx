'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import FindFriends from '@/components/FindFriends';
import FriendCard from '@/components/FriendCard';
import TonightSection from '@/components/TonightSection';
import { useFollows } from '@/hooks/useFollows';
import { useFollowRequests } from '@/hooks/useFollowRequests';
import { demoFriends } from '@/lib/demo';
import type { FollowRequest, PublicProfile } from '@/lib/follows.server';

/**
 * /friends — dual-mode (B3):
 *   signed-out → the seeded demo circle (curator profiles, "demo" chips).
 *   signed-in  → the REAL graph: circle from server follows, find-friends
 *                search over the search_handles RPC. Consensus + Tonight
 *                keep demo data behind their explicit demo labels until
 *                intents/votes tables land (out of beta-critical scope).
 */
export default function FriendsPage(): JSX.Element {
  const {
    circle,
    requested,
    followers,
    mutuals,
    mode,
    isFollowing,
    isRequested,
    toggleFollow,
    loading,
  } = useFollows();
  const { requests, accept, decline } = useFollowRequests();
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

  const isServer = mode === 'server';

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
        {/* Where should we go? — the marquee consensus moment (demo circle). */}
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

        {/* Tonight — live intent signals (demo circle; B3 keeps this demo). */}
        <TonightSection friends={followed} />

        {/* Follow requests — consent inbox for private accounts (B3b).
            Rendered only when non-empty: public users and empty inboxes see
            nothing. */}
        {isServer && requests.length > 0 ? (
          <div>
            <h2 className="font-display text-xs uppercase tracking-[0.25em] text-muted mb-4">
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

        {/* B3c: Friends (mutuals) + Followers, above the Following list. */}
        {isServer && !loading ? (
          <>
            {/* Friends explainer only once there's a graph to explain — a
                zero-everything account keeps ONE empty state (the Following
                section's), not a stack (Opus review). */}
            {mutuals.length > 0 || followers.length > 0 || circle.length > 0 ? (
            <div>
              <h2 className="font-display text-xs uppercase tracking-[0.25em] text-muted mb-4">
                Friends{mutuals.length > 0 ? ` · ${mutuals.length}` : ''}
              </h2>
              {mutuals.length === 0 ? (
                <div className="bg-surface border border-border rounded-3xl p-6 text-center">
                  <p className="text-sm text-muted leading-relaxed">
                    Friends are people you both follow. Follow back a
                    follower — or get followed back — and they&apos;ll show
                    up here.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {mutuals.map((p) => (
                    <CircleRow
                      key={p.handle}
                      profile={p}
                      onUnfollow={toggleFollow}
                    />
                  ))}
                </div>
              )}
            </div>
            ) : null}

            {followers.length > 0 ? (
              <div>
                <h2 className="font-display text-xs uppercase tracking-[0.25em] text-muted mb-4">
                  Followers · {followers.length}
                </h2>
                <div className="space-y-3">
                  {followers.map((p) =>
                    isFollowing(p.handle) ? null : (
                      <FollowerRow
                        key={p.handle}
                        profile={p}
                        requested={isRequested(p.handle)}
                        onFollowBack={toggleFollow}
                      />
                    ),
                  )}
                  {followers.every((p) => isFollowing(p.handle)) ? (
                    <p className="text-muted text-xs px-1">
                      You follow back everyone who follows you.
                    </p>
                  ) : null}
                </div>
              </div>
            ) : null}
          </>
        ) : null}

        {/* Following (was "Your circle") */}
        <div>
          <h2 className="font-display text-xs uppercase tracking-[0.25em] text-muted mb-4">
            {isServer ? 'Following' : 'Your circle'}
            {isServer
              ? circle.length > 0
                ? ` · ${circle.length}`
                : ''
              : followed.length > 0
                ? ` · ${followed.length}`
                : ''}
          </h2>
          {loading ? (
            <p className="text-muted text-sm">Loading…</p>
          ) : isServer ? (
            circle.length === 0 && requested.length === 0 ? (
              <EmptyCircle />
            ) : (
              <div className="space-y-3">
                {circle.map((p) => (
                  <CircleRow
                    key={p.handle}
                    profile={p}
                    onUnfollow={toggleFollow}
                  />
                ))}
                {/* Outgoing requests awaiting consent — tap withdraws (B3b). */}
                {requested.map((p) => (
                  <CircleRow
                    key={`req-${p.handle}`}
                    profile={p}
                    pending
                    onUnfollow={toggleFollow}
                  />
                ))}
              </div>
            )
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
          {isServer ? (
            <FindFriends
              isFollowing={isFollowing}
              isRequested={isRequested}
              toggleFollow={toggleFollow}
            />
          ) : (
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
                      <Link href={`/u/${f.handle}`} className="min-w-0 flex-1">
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
            </>
          )}
        </div>

        <p className="text-muted text-xs text-center leading-relaxed pt-2">
          Private by default — only people you follow back see your full list.
          Phone-contact sync arrives with the native app.
        </p>
      </section>
    </main>
  );
}

/**
 * Empty-state = acceptance criteria (B3): user #1 with zero friends gets an
 * inviting find-friends prompt, never a broken page.
 */
function EmptyCircle(): JSX.Element {
  return (
    <div className="bg-surface border border-border rounded-3xl p-6 text-center">
      <p className="font-display text-base mb-1">No one in your circle yet.</p>
      <p className="text-sm text-muted leading-relaxed">
        Search a friend&apos;s @username below to start building your circle —
        that&apos;s where the good bar lists live.
      </p>
    </div>
  );
}

function CircleRow({
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
        className="shrink-0 min-h-[36px] touch-manipulation px-4 rounded-full text-sm font-display border bg-transparent border-border text-muted hover:text-text transition-colors"
      >
        {pending ? 'Requested' : 'Following'}
      </button>
    </div>
  );
}

/**
 * A follower you don't follow back (B3c): the follow-back button reuses
 * toggleFollow, which honors B3b request semantics for private accounts
 * ("Requested" state via the `requested` prop).
 */
function FollowerRow({
  profile,
  requested,
  onFollowBack,
}: {
  profile: PublicProfile;
  requested: boolean;
  onFollowBack: (handle: string) => void;
}): JSX.Element {
  return (
    <div className="flex items-center justify-between gap-3 bg-surface border border-border rounded-2xl p-3">
      <Link href={`/u/${profile.handle}`} className="min-w-0 flex-1">
        <p className="font-display text-sm truncate">
          {profile.displayName ?? `@${profile.handle}`}
        </p>
        <p className="text-muted text-xs truncate">
          @{profile.handle} · follows you
        </p>
      </Link>
      <button
        type="button"
        aria-pressed={requested}
        onClick={() => onFollowBack(profile.handle)}
        className={[
          'shrink-0 min-h-[36px] touch-manipulation px-4 rounded-full text-sm font-display border transition-colors',
          requested
            ? 'bg-transparent border-border text-muted hover:text-text'
            : 'bg-accent border-accent text-bg',
        ].join(' ')}
      >
        {requested ? 'Requested' : 'Follow back'}
      </button>
    </div>
  );
}

/**
 * One incoming follow request (B3b consent inbox): accept creates the edge
 * on the requester's side, decline discards. Both are optimistic in the
 * hook — a server refusal puts the row back.
 */
function RequestRow({
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
          className="min-h-[36px] touch-manipulation px-4 rounded-full text-sm font-display bg-accent text-bg"
        >
          Accept
        </button>
        <button
          type="button"
          onClick={() => onDecline(request.id)}
          aria-label={`Decline follow request from @${request.handle}`}
          className="min-h-[36px] touch-manipulation px-3 rounded-full text-sm font-display border border-border text-muted hover:text-text transition-colors"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
