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
  fetchNightOutInvitationNotifications,
  fetchUnreadCounts,
  markInvitationNotificationRead,
  MAX_GROUP_NAME_LENGTH,
  type Group,
  type NightOutInvitationNotification,
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

      {/* Groups (V8-R-GRP-001 … 008). Creation and editing live HERE, in
          Social — V8-R-GRP-004's exclusion is that audience pickers elsewhere
          never create or invite to a group. */}
      <GroupsSection isServer={isServer} circle={circle} followers={followers} />

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
  const [invites, setInvites] = useState<NightOutInvitationNotification[]>([]);
  const [invitesFailed, setInvitesFailed] = useState(false);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'failed'>('idle');
  const [notice, setNotice] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

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

    const [mine, counts, notifications] = await Promise.all([
      fetchMyGroups(client),
      fetchUnreadCounts(client),
      fetchNightOutInvitationNotifications(client),
    ]);

    // V8-R-GRP-008's inclusion half. A FAILED read is its own state here too: an empty list would
    // say "nobody invited you" to someone whose invitations could not be loaded.
    setInvites(notifications.ok ? notifications.value : []);
    setInvitesFailed(!notifications.ok);

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

  /**
   * V8-R-GRP-008. Seeing the invitation IS the in-app notification, so dismissing it is what
   * writes `read_at`. The row is removed from this list optimistically only after the server
   * confirms — a notification that vanishes on a failed write is a notification never delivered.
   */
  const onDismissInvite = async (id: number): Promise<void> => {
    const result = await markInvitationNotificationRead(client, id);
    if (!result.ok) {
      setNotice(result.message);
      return;
    }
    setInvites((current) => current.filter((invite) => invite.id !== id));
  };

  const open = groups.find((group) => group.id === openId) ?? null;

  if (!isServer) {
    return (
      <section aria-labelledby="groups-heading" className="space-y-3">
        <h3
          id="groups-heading"
          className="font-display text-xs uppercase tracking-[0.25em] text-muted"
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
        className="font-display text-xs uppercase tracking-[0.25em] text-muted"
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

      {/*
        V8-R-GRP-008, THE INCLUSION HALF: "V8 PROVIDES IN-APP UNREAD STATE **and NIGHT OUT
        INVITATION NOTIFICATIONS**". 0067 wrote the recipient-addressed row and the read RPC, and
        until round 9 nothing in the product displayed either, so an invitee became a plan member
        and was never told (round-8 review, Codex, high). Push delivery is a different lane's file
        and stays absent; `delivered_at` is the seam that sender writes. This is the in-app half.
      */}
      {invitesFailed ? (
        <p data-testid="group-invites-failed" role="status" className="text-sm text-muted">
          Your night out invitations could not be loaded.
        </p>
      ) : null}

      {invites.length > 0 ? (
        <ul data-testid="group-invite-notifications" className="space-y-2">
          {invites.map((invite) => (
            <li
              key={invite.id}
              data-testid="group-invite-notification"
              className="flex items-center justify-between gap-3 rounded-2xl border border-accent bg-surface px-4 py-3"
            >
              <span className="min-w-0 text-sm">
                You are invited to {invite.title ?? 'a night out'} on {invite.night}
                {invite.groupName !== null ? ` via ${invite.groupName}` : ''}.
              </span>
              <button
                type="button"
                onClick={() => void onDismissInvite(invite.id)}
                data-testid="group-invite-seen"
                className="shrink-0 min-h-[44px] px-3 rounded-full border border-border text-sm font-display touch-manipulation"
              >
                Got it
              </button>
            </li>
          ))}
        </ul>
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
        <p data-testid="groups-empty" className="text-sm text-muted">
          No groups yet. Name one below.
        </p>
      ) : null}

      <ul data-testid="group-list" className="space-y-3">
        {groups.map((group) => {
          const count = unread.get(group.id) ?? 0;
          return (
            <li key={group.id}>
              <button
                type="button"
                onClick={() => setOpenId(group.id)}
                data-testid="group-row"
                className="w-full flex items-center justify-between gap-3 bg-surface border border-border rounded-3xl px-4 py-4 min-h-[44px] touch-manipulation hover:border-accent transition-colors text-left"
              >
                <span className="min-w-0 font-display text-base truncate">
                  {group.name}
                </span>
                {count > 0 ? (
                  <span
                    data-testid="group-unread"
                    className="shrink-0 rounded-full bg-accent text-bg px-2 py-0.5 text-[11px] tabular-nums"
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
          className="w-full bg-surface border border-border rounded-2xl px-4 py-3 text-base text-text placeholder:text-muted focus:outline-none focus:border-accent min-h-[44px]"
        />
        <button
          type="button"
          onClick={() => void onCreate()}
          disabled={busy || name.trim().length === 0}
          data-testid="group-create"
          className="min-h-[44px] px-4 rounded-full bg-accent text-bg text-sm font-display touch-manipulation disabled:opacity-50"
        >
          {busy ? 'Creating…' : 'Create group'}
        </button>
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
