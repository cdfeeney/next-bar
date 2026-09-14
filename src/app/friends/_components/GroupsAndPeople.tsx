'use client';

/**
 * Social → Groups & People, the body of `/friends/people`.
 *
 * Pushed from the Social header's people icon since the 2026-09-13 redesign
 * (`docs/design-reference/social-redesign-20260913/README.md` §10). Order,
 * top to bottom: the consent inbox when non-empty, the two count tiles, Find
 * friends (moved ABOVE Groups), Groups, Group Favorites. The page owns the
 * title; this section keeps its id and `aria-labelledby` so the existing
 * `#groups-and-people` assertions still find one labelled region.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import FindFriends from '@/components/FindFriends';
import { RequestRow } from '@/components/FollowRows';
import { useAuth } from '@/hooks/useAuth';
import { useFollowRequests } from '@/hooks/useFollowRequests';
import { useFollows } from '@/hooks/useFollows';
import { demoFriends } from '@/lib/demo';
import { getBrowserSupabase } from '@/lib/supabase/client';
import {
  createGroup,
  fetchMyGroups,
  fetchUnreadCounts,
  MAX_GROUP_NAME_LENGTH,
  type Group,
} from '@/lib/groups.server';
import GroupThread, { type AddableFriend } from './GroupThread';

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
      {/* Consent inbox (B3b) — only when non-empty, and never behind a tap. */}
      {isServer && requests.length > 0 ? (
        <div>
          <h3 className="font-label text-xs uppercase tracking-[0.25em] text-muted mb-3">
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
          className="bg-surface border border-border rounded-3xl py-[18px] text-center touch-manipulation hover:border-accent transition-colors"
        >
          <p className="font-display text-[28px] font-bold tabular-nums leading-none">
            {loading ? '–' : followerCount}
          </p>
          <p className="text-[11px] uppercase tracking-widest text-muted mt-1.5">
            Followers
          </p>
        </Link>
        <Link
          href="/friends/following"
          className="bg-surface border border-border rounded-3xl py-[18px] text-center touch-manipulation hover:border-accent transition-colors"
        >
          <p className="font-display text-[28px] font-bold tabular-nums leading-none">
            {loading ? '–' : followingCount}
          </p>
          <p className="text-[11px] uppercase tracking-widest text-muted mt-1.5">
            Following
          </p>
        </Link>
      </div>

      {/* Find friends sits directly under the counts now (README §10). */}
      <div data-testid="find-friends">
        <h3 className="font-label text-xs uppercase tracking-[0.25em] text-muted mb-3">
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

      {/* Groups (V8-R-GRP-001 … 008). Creation and editing live HERE, in
          Social — V8-R-GRP-004's exclusion is that audience pickers elsewhere
          never create or invite to a group. */}
      <GroupsSection isServer={isServer} circle={circle} followers={followers} />

      {/* The group pick — Group Favorites over the circle's own scores. */}
      <Link
        href="/friends/consensus"
        data-testid="group-favorites"
        className="flex items-center justify-between gap-3 bg-surface border border-border rounded-3xl px-4 py-4 min-h-[44px] touch-manipulation hover:border-accent transition-colors"
      >
        <span className="min-w-0">
          <span className="block font-display text-base font-semibold">Group Favorites</span>
          <span className="block text-xs text-muted mt-1">
            Bars your circle all rate highly
          </span>
        </span>
        <span aria-hidden="true" className="text-muted shrink-0">
          ›
        </span>
      </Link>
    </section>
  );
}

/**
 * The Groups block: the caller's groups with in-app unread state, the create
 * control, and the thread when one is open.
 *
 * SIGNED OUT IT SAYS SO. A group is server state with no demo analogue —
 * inventing a seeded group here would be the same defect Social's Feed removed,
 * where a signed-out visitor was shown a demo reel instead of the truth.
 *
 * THE UNREAD COUNT IS READ, NOT PUSHED (V8-R-GRP-008). The whole of this
 * lane's notification mechanism is `group_unread_counts`; nothing in this file,
 * in `groups.server.ts`, or in 0067 sends a push for an ordinary group message.
 */
function GroupsSection({
  isServer,
  circle,
  followers,
}: {
  isServer: boolean;
  circle: readonly { id: string; handle: string; displayName: string | null }[];
  followers: readonly { id: string; handle: string; displayName: string | null }[];
}): JSX.Element {
  const auth = useAuth();
  const client = useMemo(() => getBrowserSupabase(), []);
  const [groups, setGroups] = useState<Group[]>([]);
  const [unread, setUnread] = useState<Map<string, number>>(new Map());
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'failed'>('idle');
  const [notice, setNotice] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  // README §10: the create control is a 44px outlined "New group" pill that
  // reveals the name field, so an empty Groups block is one sentence, not a form.
  const [creating, setCreating] = useState(false);

  const viewerId = auth.status === 'signed-in' ? auth.user.id : null;
  const accessToken = auth.status === 'signed-in' ? auth.session.access_token : null;

  /**
   * Mutual friends, for the administrator's add control (V8-R-GRP-005).
   *
   * A mutual friend is a follow edge in BOTH directions, so this is the
   * intersection of the circle and the followers — which is the same rule
   * `is_mutual_friend` applies server-side, minus the block, which only the
   * server can see. Offering someone the server then refuses is a stated
   * failure, not a wrong grant.
   */
  const addable = useMemo<AddableFriend[]>(() => {
    const followerIds = new Set(followers.map((f) => f.id));
    return circle
      .filter((f) => followerIds.has(f.id))
      .map((f) => ({ id: f.id, handle: f.handle, displayName: f.displayName }));
  }, [circle, followers]);

  const load = useCallback(async (): Promise<void> => {
    if (!isServer) return;
    setStatus((current) => (current === 'ready' ? current : 'loading'));

    const [mine, counts] = await Promise.all([      fetchMyGroups(client),      fetchUnreadCounts(client),    ]);

    if (!mine.ok) {
      // FAILED IS ITS OWN STATE. An empty list would say "you have no groups"
      // to someone whose groups could not be loaded.
      setStatus('failed');
      setNotice(mine.message);
      return;
    }

    setGroups(mine.value);
    // Unread is decoration on top of a list that already loaded; if only the
    // counts failed, the groups are still worth showing without badges.
    setUnread(counts.ok ? counts.value : new Map());
    setStatus('ready');
  }, [client, isServer]);

  useEffect(() => {
    void load();
  }, [load]);

  const onCreate = async (): Promise<void> => {
    const trimmed = name.trim();
    if (trimmed.length === 0) return;
    setBusy(true);
    setNotice(null);
    try {
      const result = await createGroup(client, trimmed);
      if (!result.ok) {
        // "a failed creation keeps the typed name" — so `name` is NOT cleared.
        setNotice(result.message);
        return;
      }
      setName('');
      await load();
      setOpenId(result.value);
    } finally {
      setBusy(false);
    }
  };

  const open = groups.find((group) => group.id === openId) ?? null;

  if (!isServer) {
    return (
      <section aria-labelledby="groups-heading" className="space-y-3">
        <h3
          id="groups-heading"
          className="font-label text-xs uppercase tracking-[0.25em] text-muted"
        >
          Groups
        </h3>
        <div
          data-testid="groups-signed-out"
          className="rounded-2xl border border-border bg-surface p-5"
        >
          <p className="text-sm leading-relaxed">
            Groups are persistent chats with the friends who follow you back.
            Sign in to create one.
          </p>
          <Link
            href="/auth"
            data-testid="groups-sign-in"
            className="mt-3 inline-flex items-center min-h-[44px] px-4 rounded-full bg-accent text-bg text-sm font-display touch-manipulation"
          >
            Sign in
          </Link>
        </div>
      </section>
    );
  }

  if (open !== null && viewerId !== null) {
    return (
      <GroupThread
        client={client}
        accessToken={accessToken}
        groupId={open.id}
        groupName={open.name}
        viewerId={viewerId}
        addable={addable}
        onClose={() => setOpenId(null)}
        onChanged={() => void load()}
      />
    );
  }

  return (
    <section aria-labelledby="groups-heading" className="space-y-3">
      <h3
        id="groups-heading"
        className="font-label text-xs uppercase tracking-[0.25em] text-muted"
      >
        Groups
      </h3>

      {notice !== null ? (
        <p
          data-testid="groups-notice"
          role="status"
          className="text-sm rounded-2xl border border-border bg-surface px-4 py-3"
        >
          {notice}
        </p>
      ) : null}

      {status === 'failed' ? (
        <button
          type="button"
          onClick={() => void load()}
          data-testid="groups-retry"
          className="min-h-[44px] px-4 rounded-full bg-accent text-bg text-sm font-display touch-manipulation"
        >
          Try again
        </button>
      ) : null}

      {status === 'ready' && groups.length === 0 ? (
        <p
          data-testid="groups-empty"
          className="rounded-[20px] border border-dashed border-border p-4 text-[13px] leading-relaxed text-muted"
        >
          No groups yet. A group is a standing chat with the friends who follow you back.
        </p>
      ) : null}

      <ul data-testid="group-list" className="space-y-2">
        {groups.map((group) => {
          const count = unread.get(group.id) ?? 0;
          return (
            <li key={group.id}>
              <button
                type="button"
                onClick={() => setOpenId(group.id)}
                data-testid="group-row"
                className="w-full flex items-center justify-between gap-3 bg-surface border border-border rounded-[20px] px-4 py-3.5 min-h-[44px] touch-manipulation hover:border-accent transition-colors text-left"
              >
                <span className="min-w-0 font-display text-base font-semibold truncate">
                  {group.name}
                </span>
                {count > 0 ? (
                  <span
                    data-testid="group-unread"
                    className="shrink-0 min-w-[22px] h-[22px] px-[7px] rounded-full bg-accent text-bg text-[11px] font-bold tabular-nums flex items-center justify-center"
                  >
                    {count}
                    <span className="sr-only"> unread messages</span>
                  </span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>

      {creating ? (
        <div className="space-y-2">
          <label htmlFor="group-name" className="sr-only">
            New group name
          </label>
          <input
            id="group-name"
            data-testid="group-name"
            value={name}
            maxLength={MAX_GROUP_NAME_LENGTH}
            onChange={(event) => setName(event.target.value)}
            placeholder="New group name…"
            autoFocus
            className="w-full bg-surface border border-border rounded-2xl px-4 py-3 text-base text-text placeholder:text-muted focus:outline-none focus:border-accent min-h-[44px]"
          />
          <button
            type="button"
            onClick={() => void onCreate()}
            disabled={busy || name.trim().length === 0}
            data-testid="group-create"
            className={[
              'min-h-[44px] px-4 rounded-full text-sm font-display touch-manipulation',
              // Held, not faded: the design's disabled treatment is #1c1c1c on
              // muted text, never opacity alone.
              busy || name.trim().length === 0
                ? 'bg-held text-muted'
                : 'bg-accent text-bg',
            ].join(' ')}
          >
            {busy ? 'Creating…' : 'Create group'}
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setCreating(true)}
          data-testid="group-new"
          className="inline-flex items-center min-h-[44px] px-[18px] rounded-full border border-border text-text text-sm font-display font-bold touch-manipulation hover:border-accent transition-colors"
        >
          New group
        </button>
      )}
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
