import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  fetchFollows,
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

const MAYA_ROW = { id: 'uuid-maya', handle: 'Maya_R', display_name: 'Maya R.' };

describe('getProfileByHandle', () => {
  it('calls get_profile_by_handle with the trimmed handle (leading @ stripped)', async () => {
    const { client, calls } = fakeSupabase({
      rpcResults: { get_profile_by_handle: { data: [MAYA_ROW] } },
    });

    const profile = await getProfileByHandle(client, ' @Maya_R ');

    expect(profile).toEqual({
      id: 'uuid-maya',
      handle: 'Maya_R',
      displayName: 'Maya R.',
    });
    expect(calls.rpc).toEqual([
      { fn: 'get_profile_by_handle', args: { h: 'Maya_R' } },
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
    expect(await getProfileByHandle(client, 'maya')).toBeNull();
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
      { id: 'uuid-maya', handle: 'Maya_R', displayName: 'Maya R.' },
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
    expect(follows?.[0].handle).toBe('Maya_R');
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

    const followed = await followByHandle(client, 'maya_r');

    expect(followed).toEqual({
      id: 'uuid-maya',
      handle: 'Maya_R',
      displayName: 'Maya R.',
    });
    expect(calls.rpc).toEqual([
      { fn: 'get_profile_by_handle', args: { h: 'maya_r' } },
      { fn: 'follow_user', args: { target: 'uuid-maya' } },
    ]);
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
    expect(await followByHandle(client, 'maya_r')).toBeNull();
  });

  it('returns null when the follow_user RPC errors', async () => {
    const { client } = fakeSupabase({
      rpcResults: {
        get_profile_by_handle: { data: [MAYA_ROW] },
        follow_user: { error: { message: 'boom' } },
      },
    });
    expect(await followByHandle(client, 'maya_r')).toBeNull();
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

    expect(await unfollowByHandle(client, 'Maya_R')).toBe(true);
    expect(calls.rpc).toEqual([
      { fn: 'get_profile_by_handle', args: { h: 'Maya_R' } },
      { fn: 'unfollow_user', args: { target: 'uuid-maya' } },
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
    expect(await unfollowByHandle(notFollowing.client, 'maya_r')).toBe(false);

    const errored = fakeSupabase({
      rpcResults: {
        get_profile_by_handle: { data: [MAYA_ROW] },
        unfollow_user: { error: { message: 'boom' } },
      },
    });
    expect(await unfollowByHandle(errored.client, 'maya_r')).toBe(false);
  });
});

describe('fetchFriendRatings', () => {
  it('reads through the get_friend_ratings RPC (materialized fence — DeepSeek review), not a view', async () => {
    const { client, calls } = fakeSupabase({
      rpcResults: { get_friend_ratings: { data: [] } },
    });

    await fetchFriendRatings(client, 'uuid-maya');

    expect(calls.rpc).toEqual([{ fn: 'get_friend_ratings', args: undefined }]);
    expect(calls.from).toEqual([]); // no table/view read — RPC only
  });

  it('filters to the requested friend client-side and maps rows (never a score field)', async () => {
    const { client } = fakeSupabase({
      rpcResults: {
        get_friend_ratings: {
          data: [
            {
              user_id: 'uuid-maya',
              bar_id: 'attaboy',
              tier: 'loved',
              rated_at: '2026-05-10T00:00:00.000Z',
            },
            {
              user_id: 'uuid-maya',
              bar_id: 'buvette',
              tier: 'liked',
              rated_at: '2026-05-11T00:00:00.000Z',
            },
            {
              user_id: 'uuid-jordan',
              bar_id: 'attaboy',
              tier: 'liked',
              rated_at: '2026-05-12T00:00:00.000Z',
            },
          ],
        },
      },
    });

    const ratings = await fetchFriendRatings(client, 'uuid-maya');
    expect(ratings?.every((r) => !('score' in r))).toBe(true);

    expect(ratings).toEqual([
      {
        userId: 'uuid-maya',
        barId: 'attaboy',
        rating: 'loved',
        ratedAt: '2026-05-10T00:00:00.000Z',
      },
      {
        userId: 'uuid-maya',
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
    expect(await fetchFriendRatings(client, 'uuid-maya')).toBeNull();
  });

  it('returns [] when the RPC yields nothing (not following / friend unrated)', async () => {
    const { client } = fakeSupabase({
      rpcResults: { get_friend_ratings: { data: [] } },
    });
    expect(await fetchFriendRatings(client, 'uuid-maya')).toEqual([]);
  });
});
