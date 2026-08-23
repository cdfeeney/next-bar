'use client';

/**
 * Social → Groups & People.
 *
 * `next-bar-social-v2-core.png` puts a single `GROUPS & PEOPLE` control in the
 * Social header and describes Social as "everything involving other people".
 * This is what that control leads to: the consent inbox, the friend graph, the
 * people search, and the group pick.
 *
 * It is a SECTION rather than a route on purpose. The canvas's three sub-tabs
 * (Tonight / Plans / Feed) are the story-and-feed lane's build (`g-f1e128da`,
 * which inherits `src/app/friends/**` after this goal); until that chrome
 * exists there is no tab bar for a people surface to sit beside, and giving it
 * its own route now would mean moving it again in the very next lane.
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import FindFriends from '@/components/FindFriends';
import { RequestRow } from '@/components/FollowRows';
import { useFollowRequests } from '@/hooks/useFollowRequests';
import { useFollows } from '@/hooks/useFollows';
import { demoFriends } from '@/lib/demo';

export const GROUPS_AND_PEOPLE_ID = 'groups-and-people';

export default function GroupsAndPeople(): JSX.Element {
  const {
    circle,
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

  return (
    <section
      id={GROUPS_AND_PEOPLE_ID}
      aria-labelledby="groups-and-people-heading"
      className="space-y-6 scroll-mt-6"
    >
      <h2
        id="groups-and-people-heading"
        className="font-display text-xs uppercase tracking-[0.25em] text-muted"
      >
        Groups &amp; people
      </h2>

      {/* Consent inbox (B3b) — only when non-empty, and never behind a tap. */}
      {isServer && requests.length > 0 ? (
        <div>
          <h3 className="font-display text-xs uppercase tracking-[0.25em] text-muted mb-3">
            Requests · {requests.length}
          </h3>
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

      {/* The group pick — Group Favorites over the circle's own scores. */}
      <Link
        href="/friends/consensus"
        className="flex items-center justify-between gap-3 bg-surface border border-border rounded-3xl px-4 py-4 min-h-[44px] touch-manipulation hover:border-accent transition-colors"
      >
        <span className="min-w-0">
          <span className="block font-display text-base">Group Favorites</span>
          <span className="block text-xs text-muted mt-1">
            Bars your circle all rate highly
          </span>
        </span>
        <span aria-hidden="true" className="text-muted shrink-0">
          ›
        </span>
      </Link>

      <div>
        <h3 className="font-display text-xs uppercase tracking-[0.25em] text-muted mb-3">
          Find friends
        </h3>
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
              {/* Criterion 9: this row IS a tap target — it navigates to the
                  profile — so it owes the same 44px minimum the follow button
                  beside it already carries. It was 36px (two stacked lines with
                  no floor), which the Home-only target audit never saw. */}
              <Link
                href={`/u/${f.handle}`}
                className="min-w-0 flex-1 min-h-[44px] flex flex-col justify-center touch-manipulation"
              >
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
