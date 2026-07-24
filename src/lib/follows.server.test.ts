import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  acceptFollowRequest,
  cancelFollowRequest,
  declineFollowRequest,
  deriveMutuals,
  fetchFollowerCount,
  fetchFollowers,
  fetchFollowRequests,
  fetchFollows,
  fetchOutgoingRequests,
  fetchFriendRatings,
  followByHandle,
  getProfileByHandle,
  unfollowByHandle,
} from '@/lib/follows.server';

/**
 * Hand-rolled fake of the supabase-js client (same pattern as
 * ratings.server.test.ts / profile.server.test.ts): every method records the
 * call so tests assert WHAT was sent — especially that invalid handles never
 * reach an RPC and that the friend_ratings select NEVER asks for `score`.
 *
 * `rpcResults` is keyed by function name because followByHandle chains two
 * different RPCs (get_profile_by_handle → follow_user) on one client.
 */
type RpcResult = { data?: unknown; error?: unknown };

function fakeSupabase(opts: {
  rpcResults?: Record<string, RpcResult>;
  selectData?: unknown;
  selectError?: unknown;
}) {
  const calls = {
    rpc: [] as Array<{ fn: string; args: unknown }>,
    from: [] as string[],
    select: [] as string[],
    eq: [] as Array<{ column: string; value: unknown }>,
  };

  const client = {
    rpc(fn: string, args: unknown) {
      calls.rpc.push({ fn, args });
      const result = opts.rpcResults?.[fn] ?? {};
      return Promise.resolve({
        data: result.data ?? null,
        error: result.error ?? null,
      });
    },
    from(table: string) {
      calls.from.push(table);
      return {
        select(columns: string) {
          calls.select.push(columns);
          return {
            eq(column: string, value: unknown) {
              calls.eq.push({ column, value });
              return Promise.resolve({
                data: opts.selectData ?? null,
                error: opts.selectError ?? null,
              });
            },
          };
        },
      };
    },
  } as unknown as SupabaseClient;

  return { client, calls };
}

const MAYA_ROW = { id: 'uuid-claire', handle: 'Claire_R', display_name: 'Claire R.' };

describe('getProfileByHandle', () => {
  it('calls get_profile_by_handle with the trimmed handle (leading @ stripped)', async () => {
    const { client, calls } = fakeSupabase({
      rpcResults: { get_profile_by_handle: { data: [MAYA_ROW] } },
    });

    const profile = await getProfileByHandle(client, ' @Claire_R ');

    expect(profile).toEqual({
      id: 'uuid-claire',
      handle: 'Claire_R',
      displayName: 'Claire R.',
    });
    expect(calls.rpc).toEqual([
      { fn: 'get_profile_by_handle', args: { h: 'Claire_R' } },
    ]);
  });

  it('rejects invalid charset client-side — the RPC is never hit', async () => {
    const { client, calls } = fakeSupabase({});
    expect(await getProfileByHandle(client, 'ab')).toBeNull();
    expect(await getProfileByHandle(client, 'has space')).toBeNull();
    expect(await getProfileByHandle(client, 'dash-name')).toBeNull();
    expect(await getProfileByHandle(client, '')).toBeNull();
    expect(calls.rpc).toHaveLength(0);
  });

  it('returns null when no profile matches (empty result set)', async () => {
    const { client } = fakeSupabase({
      rpcResults: { get_profile_by_handle: { data: [] } },
    });
    expect(await getProfileByHandle(client, 'nobody')).toBeNull();
  });

  it('returns null when the RPC errors', async () => {
    const { client } = fakeSupabase({
      rpcResults: { get_profile_by_handle: { error: { message: 'boom' } } },
    });
    expect(await getProfileByHandle(client, 'claire')).toBeNull();
  });
});

describe('fetchFollows', () => {
  it('maps get_following rows into handle-resolved profiles', async () => {
    const { client, calls } = fakeSupabase({
      rpcResults: {
        get_following: {
          data: [
            MAYA_ROW,
            { id: 'uuid-dev', handle: 'dev', display_name: null },
          ],
        },
      },
    });

    const follows = await fetchFollows(client);

    expect(follows).toEqual([
      { id: 'uuid-claire', handle: 'Claire_R', displayName: 'Claire R.' },
      { id: 'uuid-dev', handle: 'dev', displayName: null },
    ]);
    expect(calls.rpc).toEqual([{ fn: 'get_following', args: undefined }]);
  });

  it('returns [] for an empty circle (distinguishable from failure)', async () => {
    const { client } = fakeSupabase({
      rpcResults: { get_following: { data: [] } },
    });
    expect(await fetchFollows(client)).toEqual([]);
  });

  it('returns null when the RPC errors — callers keep prior state', async () => {
    const { client } = fakeSupabase({
      rpcResults: { get_following: { error: { message: 'RLS denied' } } },
    });
    expect(await fetchFollows(client)).toBeNull();
  });

  it('drops rows with a null handle (unclaimed profiles are unroutable)', async () => {
    const { client } = fakeSupabase({
      rpcResults: {
        get_following: {
          data: [MAYA_ROW, { id: 'uuid-x', handle: null, display_name: 'X' }],
        },
      },
    });
    const follows = await fetchFollows(client);
    expect(follows).toHaveLength(1);
    expect(follows?.[0].handle).toBe('Claire_R');
  });
});

describe('followByHandle', () => {
  it('resolves the handle then calls follow_user with the profile id', async () => {
    const { client, calls } = fakeSupabase({
      rpcResults: {
        get_profile_by_handle: { data: [MAYA_ROW] },
        follow_user: { data: true },
      },
    });

    const followed = await followByHandle(client, 'claire_r');

    // Pre-0008 boolean `true` maps to status 'followed' (the client must be
    // deployable either side of the migration apply).
    expect(followed).toEqual({
      profile: {
        id: 'uuid-claire',
        handle: 'Claire_R',
        displayName: 'Claire R.',
      },
      status: 'followed',
    });
    expect(calls.rpc).toEqual([
      { fn: 'get_profile_by_handle', args: { h: 'claire_r' } },
      { fn: 'follow_user', args: { target: 'uuid-claire' } },
    ]);
  });

  it("maps the post-0008 text returns: 'followed' and 'requested' (B3b)", async () => {
    const followedCase = fakeSupabase({
      rpcResults: {
        get_profile_by_handle: { data: [MAYA_ROW] },
        follow_user: { data: 'followed' },
      },
    });
    expect(await followByHandle(followedCase.client, 'claire_r')).toMatchObject({
      status: 'followed',
    });

    const requestedCase = fakeSupabase({
      rpcResults: {
        get_profile_by_handle: { data: [MAYA_ROW] },
        follow_user: { data: 'requested' },
      },
    });
    expect(await followByHandle(requestedCase.client, 'claire_r')).toEqual({
      profile: {
        id: 'uuid-claire',
        handle: 'Claire_R',
        displayName: 'Claire R.',
      },
      status: 'requested',
    });
  });

  it("returns null on the post-0008 'rejected' return", async () => {
    const { client } = fakeSupabase({
      rpcResults: {
        get_profile_by_handle: { data: [MAYA_ROW] },
        follow_user: { data: 'rejected' },
      },
    });
    expect(await followByHandle(client, 'claire_r')).toBeNull();
  });

  it('returns null when the handle does not resolve — follow_user never fires', async () => {
    const { client, calls } = fakeSupabase({
      rpcResults: {
        get_profile_by_handle: { data: [] },
        follow_user: { data: true },
      },
    });

    expect(await followByHandle(client, 'nobody')).toBeNull();
    expect(calls.rpc.map((c) => c.fn)).toEqual(['get_profile_by_handle']);
  });

  it('returns null when follow_user reports failure (rate-capped / self / missing)', async () => {
    const { client } = fakeSupabase({
      rpcResults: {
        get_profile_by_handle: { data: [MAYA_ROW] },
        follow_user: { data: false },
      },
    });
    expect(await followByHandle(client, 'claire_r')).toBeNull();
  });

  it('returns null when the follow_user RPC errors', async () => {
    const { client } = fakeSupabase({
      rpcResults: {
        get_profile_by_handle: { data: [MAYA_ROW] },
        follow_user: { error: { message: 'boom' } },
      },
    });
    expect(await followByHandle(client, 'claire_r')).toBeNull();
  });
});

describe('unfollowByHandle', () => {
  it('resolves the handle then calls unfollow_user with the profile id', async () => {
    const { client, calls } = fakeSupabase({
      rpcResults: {
        get_profile_by_handle: { data: [MAYA_ROW] },
        unfollow_user: { data: true },
      },
    });

    expect(await unfollowByHandle(client, 'Claire_R')).toBe(true);
    expect(calls.rpc).toEqual([
      { fn: 'get_profile_by_handle', args: { h: 'Claire_R' } },
      { fn: 'unfollow_user', args: { target: 'uuid-claire' } },
    ]);
  });

  it('returns false when the handle does not resolve — unfollow_user never fires', async () => {
    const { client, calls } = fakeSupabase({
      rpcResults: { get_profile_by_handle: { data: [] } },
    });
    expect(await unfollowByHandle(client, 'nobody')).toBe(false);
    expect(calls.rpc.map((c) => c.fn)).toEqual(['get_profile_by_handle']);
  });

  it('returns false when unfollow_user reports no row removed or errors', async () => {
    const notFollowing = fakeSupabase({
      rpcResults: {
        get_profile_by_handle: { data: [MAYA_ROW] },
        unfollow_user: { data: false },
      },
    });
    expect(await unfollowByHandle(notFollowing.client, 'claire_r')).toBe(false);

    const errored = fakeSupabase({
      rpcResults: {
        get_profile_by_handle: { data: [MAYA_ROW] },
        unfollow_user: { error: { message: 'boom' } },
      },
    });
    expect(await unfollowByHandle(errored.client, 'claire_r')).toBe(false);
  });
});

describe('fetchFriendRatings', () => {
  it('reads through the get_friend_ratings RPC (materialized fence — DeepSeek review), not a view', async () => {
    const { client, calls } = fakeSupabase({
      rpcResults: { get_friend_ratings: { data: [] } },
    });

    await fetchFriendRatings(client, 'uuid-claire');

    expect(calls.rpc).toEqual([{ fn: 'get_friend_ratings', args: undefined }]);
    expect(calls.from).toEqual([]); // no table/view read — RPC only
  });

  it('filters to the requested friend client-side and maps rows (never a score field)', async () => {
    const { client } = fakeSupabase({
      rpcResults: {
        get_friend_ratings: {
          data: [
            {
              user_id: 'uuid-claire',
              bar_id: 'attaboy',
              tier: 'loved',
              rated_at: '2026-05-10T00:00:00.000Z',
            },
            {
              user_id: 'uuid-claire',
              bar_id: 'buvette',
              tier: 'liked',
              rated_at: '2026-05-11T00:00:00.000Z',
            },
            {
              user_id: 'uuid-john',
              bar_id: 'attaboy',
              tier: 'liked',
              rated_at: '2026-05-12T00:00:00.000Z',
            },
          ],
        },
      },
    });

    const ratings = await fetchFriendRatings(client, 'uuid-claire');
    expect(ratings?.every((r) => !('score' in r))).toBe(true);

    expect(ratings).toEqual([
      {
        userId: 'uuid-claire',
        barId: 'attaboy',
        rating: 'loved',
        ratedAt: '2026-05-10T00:00:00.000Z',
      },
      {
        userId: 'uuid-claire',
        barId: 'buvette',
        rating: 'liked',
        ratedAt: '2026-05-11T00:00:00.000Z',
      },
    ]);
  });

  it('returns null on RPC error (distinguishable from "no ratings visible")', async () => {
    const { client } = fakeSupabase({
      rpcResults: { get_friend_ratings: { error: { message: 'RLS denied' } } },
    });
    expect(await fetchFriendRatings(client, 'uuid-claire')).toBeNull();
  });

  it('returns [] when the RPC yields nothing (not following / friend unrated)', async () => {
    const { client } = fakeSupabase({
      rpcResults: { get_friend_ratings: { data: [] } },
    });
    expect(await fetchFriendRatings(client, 'uuid-claire')).toEqual([]);
  });
});

describe('follow requests (B3b, migration 0008)', () => {
  const REQUEST_ROW = {
    id: 'uuid-john',
    handle: 'John_D',
    display_name: 'John D.',
    requested_at: '2026-07-25T01:00:00.000Z',
  };

  it('fetchFollowRequests maps the inbox and drops handle-less rows', async () => {
    const { client, calls } = fakeSupabase({
      rpcResults: {
        get_follow_requests: {
          data: [REQUEST_ROW, { ...REQUEST_ROW, id: 'uuid-x', handle: null }],
        },
      },
    });

    expect(await fetchFollowRequests(client)).toEqual([
      {
        id: 'uuid-john',
        handle: 'John_D',
        displayName: 'John D.',
        requestedAt: '2026-07-25T01:00:00.000Z',
      },
    ]);
    expect(calls.rpc).toEqual([{ fn: 'get_follow_requests', args: undefined }]);
  });

  it('fetchFollowRequests returns null on RPC error (pre-0008 missing RPC included)', async () => {
    const { client } = fakeSupabase({
      rpcResults: {
        get_follow_requests: { error: { message: 'function does not exist' } },
      },
    });
    expect(await fetchFollowRequests(client)).toBeNull();
  });

  it('fetchOutgoingRequests maps pending targets as profiles', async () => {
    const { client, calls } = fakeSupabase({
      rpcResults: { get_outgoing_requests: { data: [REQUEST_ROW] } },
    });

    expect(await fetchOutgoingRequests(client)).toEqual([
      { id: 'uuid-john', handle: 'John_D', displayName: 'John D.' },
    ]);
    expect(calls.rpc).toEqual([{ fn: 'get_outgoing_requests', args: undefined }]);
  });

  it('fetchOutgoingRequests returns null on RPC error', async () => {
    const { client } = fakeSupabase({
      rpcResults: { get_outgoing_requests: { error: { message: 'boom' } } },
    });
    expect(await fetchOutgoingRequests(client)).toBeNull();
  });

  it('acceptFollowRequest calls the RPC with the requester id and maps true', async () => {
    const { client, calls } = fakeSupabase({
      rpcResults: { accept_follow_request: { data: true } },
    });
    expect(await acceptFollowRequest(client, 'uuid-john')).toBe(true);
    expect(calls.rpc).toEqual([
      { fn: 'accept_follow_request', args: { requester: 'uuid-john' } },
    ]);
  });

  it('accept/decline/cancel return false on server refusal or RPC error', async () => {
    const refused = fakeSupabase({
      rpcResults: {
        accept_follow_request: { data: false },
        decline_follow_request: { data: false },
        cancel_follow_request: { data: false },
      },
    });
    expect(await acceptFollowRequest(refused.client, 'uuid-john')).toBe(false);
    expect(await declineFollowRequest(refused.client, 'uuid-john')).toBe(false);
    expect(await cancelFollowRequest(refused.client, 'uuid-john')).toBe(false);

    const errored = fakeSupabase({
      rpcResults: {
        decline_follow_request: { error: { message: 'boom' } },
        cancel_follow_request: { error: { message: 'boom' } },
      },
    });
    expect(await declineFollowRequest(errored.client, 'uuid-john')).toBe(false);
    expect(await cancelFollowRequest(errored.client, 'uuid-john')).toBe(false);
  });

  it('declineFollowRequest and cancelFollowRequest send the right RPC args', async () => {
    const { client, calls } = fakeSupabase({
      rpcResults: {
        decline_follow_request: { data: true },
        cancel_follow_request: { data: true },
      },
    });
    expect(await declineFollowRequest(client, 'uuid-john')).toBe(true);
    expect(await cancelFollowRequest(client, 'uuid-target')).toBe(true);
    expect(calls.rpc).toEqual([
      { fn: 'decline_follow_request', args: { requester: 'uuid-john' } },
      { fn: 'cancel_follow_request', args: { target: 'uuid-target' } },
    ]);
  });
});

describe('B3c followers + count + mutuals', () => {
  const ROW_A = { id: 'uuid-a', handle: 'ana', display_name: 'Ana' };
  const ROW_B = { id: 'uuid-b', handle: 'ben', display_name: null };

  it('fetchFollowers maps rows and drops handle-less profiles', async () => {
    const { client, calls } = fakeSupabase({
      rpcResults: {
        get_followers: {
          data: [ROW_A, { id: 'uuid-x', handle: null, display_name: 'X' }],
        },
      },
    });
    expect(await fetchFollowers(client)).toEqual([
      { id: 'uuid-a', handle: 'ana', displayName: 'Ana' },
    ]);
    expect(calls.rpc).toEqual([{ fn: 'get_followers', args: undefined }]);
  });

  it('fetchFollowers returns null on RPC error (pre-0010 missing fn included)', async () => {
    const { client } = fakeSupabase({
      rpcResults: { get_followers: { error: { message: 'nope' } } },
    });
    expect(await fetchFollowers(client)).toBeNull();
  });

  it('fetchFollowerCount returns the integer and passes the profile id', async () => {
    const { client, calls } = fakeSupabase({
      rpcResults: { get_follower_count: { data: 7 } },
    });
    expect(await fetchFollowerCount(client, 'uuid-a')).toBe(7);
    expect(calls.rpc).toEqual([
      { fn: 'get_follower_count', args: { profile_id: 'uuid-a' } },
    ]);
  });

  it('fetchFollowerCount is null for hidden profiles, errors, and non-numbers', async () => {
    const hidden = fakeSupabase({
      rpcResults: { get_follower_count: { data: null } },
    });
    expect(await fetchFollowerCount(hidden.client, 'uuid-p')).toBeNull();
    const errored = fakeSupabase({
      rpcResults: { get_follower_count: { error: { message: 'boom' } } },
    });
    expect(await fetchFollowerCount(errored.client, 'uuid-p')).toBeNull();
  });

  it('deriveMutuals intersects by id and never counts optimistic placeholders', () => {
    const me = { id: 'uuid-a', handle: 'ana', displayName: 'Ana' };
    const ben = { id: 'uuid-b', handle: 'ben', displayName: null };
    const placeholder = { id: '', handle: 'ghost', displayName: null };
    const following = [me, ben, placeholder];
    const followers = [
      { id: 'uuid-a', handle: 'ana', displayName: 'Ana' },
      { id: '', handle: 'other-ghost', displayName: null },
    ];
    expect(deriveMutuals(following, followers)).toEqual([me]);
    expect(deriveMutuals([], followers)).toEqual([]);
    expect(deriveMutuals(following, [])).toEqual([]);
  });
});
