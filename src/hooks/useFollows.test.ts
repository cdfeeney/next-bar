import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useFollows } from './useFollows';
import { DEFAULT_FOLLOWS } from '@/lib/demo/friends';

const KEY = 'next-bar:follows:v1';

// ---------------------------------------------------------------------------
// Mocks — same shape as useRatings.test.ts: useAuth, the supabase browser
// client, and the follows.server IO functions, so the dual-mode branches run
// in jsdom with zero network. Defaults keep local-mode tests working.
// ---------------------------------------------------------------------------

vi.mock('@/hooks/useAuth', () => ({
  useAuth: vi.fn(() => ({
    status: 'signed-out',
    user: null,
    session: null,
    signOut: vi.fn(),
  })),
}));

vi.mock('@/lib/supabase/client', () => ({
  getBrowserSupabase: vi.fn(() => null),
}));

vi.mock('@/lib/follows.server', async (importOriginal) => ({
  // deriveMutuals is a pure function — keep the REAL one so mutuals
  // behavior is tested, not mocked.
  deriveMutuals: (await importOriginal<typeof import('@/lib/follows.server')>()).deriveMutuals,
  fetchFollows: vi.fn(() => Promise.resolve([])),
  fetchFollowers: vi.fn(() => Promise.resolve([])),
  fetchOutgoingRequests: vi.fn(() => Promise.resolve([])),
  followByHandle: vi.fn(() => Promise.resolve(null)),
  unfollowByHandle: vi.fn(() => Promise.resolve(false)),
  unfollowById: vi.fn(() => Promise.resolve(false)),
  cancelFollowRequest: vi.fn(() => Promise.resolve(false)),
}));

import { useAuth } from '@/hooks/useAuth';
import { getBrowserSupabase } from '@/lib/supabase/client';
import {
  cancelFollowRequest,
  fetchFollowers,
  fetchFollows,
  fetchOutgoingRequests,
  followByHandle,
  unfollowByHandle,
  unfollowById,
} from '@/lib/follows.server';

const useAuthMock = vi.mocked(useAuth);
const getBrowserSupabaseMock = vi.mocked(getBrowserSupabase);
const fetchFollowsMock = vi.mocked(fetchFollows);
const fetchFollowersMock = vi.mocked(fetchFollowers);
const fetchOutgoingRequestsMock = vi.mocked(fetchOutgoingRequests);
const followByHandleMock = vi.mocked(followByHandle);
const unfollowByHandleMock = vi.mocked(unfollowByHandle);
const unfollowByIdMock = vi.mocked(unfollowById);
const cancelFollowRequestMock = vi.mocked(cancelFollowRequest);

const fakeSupabase = {} as unknown as ReturnType<typeof getBrowserSupabase>;

function signedInAuthState(userId = 'user-1') {
  return {
    status: 'signed-in' as const,
    user: { id: userId } as never,
    session: { user: { id: userId } } as never,
    signOut: vi.fn(),
  };
}

function signedOutAuthState() {
  return {
    status: 'signed-out' as const,
    user: null,
    session: null,
    signOut: vi.fn(),
  };
}

const MAYA = { id: 'uuid-claire', handle: 'Claire_R', displayName: 'Claire R.' };
const DEV = { id: 'uuid-dev', handle: 'dev_p', displayName: null };

describe('useFollows — local (signed-out) mode', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
    useAuthMock.mockReturnValue(signedOutAuthState());
    getBrowserSupabaseMock.mockReturnValue(null);
  });

  afterEach(() => vi.clearAllMocks());

  it('seeds the demo circle on a fresh device', async () => {
    const { result } = renderHook(() => useFollows());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.follows).toEqual([...DEFAULT_FOLLOWS]);
    expect(result.current.mode).toBe('local');
  });

  it('toggleFollow persists to localStorage and never calls the server', async () => {
    const { result } = renderHook(() => useFollows());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.toggleFollow('sasha'));

    expect(result.current.isFollowing('sasha')).toBe(true);
    expect(JSON.parse(window.localStorage.getItem(KEY) ?? '[]')).toContain(
      'sasha',
    );
    expect(followByHandleMock).not.toHaveBeenCalled();
    expect(unfollowByHandleMock).not.toHaveBeenCalled();
  });

  it('recovers the seeded default circle from corrupt storage', async () => {
    window.localStorage.setItem(KEY, '{"not":"an array"}');
    const { result } = renderHook(() => useFollows());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.follows).toEqual([...DEFAULT_FOLLOWS]);
  });
});

describe('useFollows — server (signed-in) mode', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
    useAuthMock.mockReturnValue(signedInAuthState('user-1'));
    getBrowserSupabaseMock.mockReturnValue(fakeSupabase);
    fetchFollowsMock.mockResolvedValue([]);
    fetchOutgoingRequestsMock.mockResolvedValue([]);
    followByHandleMock.mockResolvedValue(null);
    unfollowByHandleMock.mockResolvedValue(false);
  });

  afterEach(() => vi.clearAllMocks());

  it('hydrates the circle from the server and IGNORES the demo seed entirely', async () => {
    // Demo follows in localStorage must NOT merge — demo handles aren't
    // real accounts. Server truth is the whole circle.
    window.localStorage.setItem(KEY, JSON.stringify(['claire', 'john']));
    fetchFollowsMock.mockResolvedValue([MAYA]);

    const { result } = renderHook(() => useFollows());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.mode).toBe('server');
    expect(result.current.follows).toEqual(['Claire_R']);
    expect(result.current.circle).toEqual([MAYA]);
    // The demo entries never travel to the server.
    expect(followByHandleMock).not.toHaveBeenCalled();
    // …and the local demo cache is left as-is (sign-out fallback), unmerged.
    expect(window.localStorage.getItem(KEY)).toBe(
      JSON.stringify(['claire', 'john']),
    );
  });

  it('a failed fetch (null) leaves an empty circle — no demo fallback bleed', async () => {
    window.localStorage.setItem(KEY, JSON.stringify(['claire']));
    fetchFollowsMock.mockResolvedValue(null);

    const { result } = renderHook(() => useFollows());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.follows).toEqual([]);
    expect(result.current.circle).toEqual([]);
  });

  it('toggleFollow on a new handle calls followByHandle and lands the resolved profile', async () => {
    // Deferred, because the optimistic phase asserted below only exists while
    // the RPC is genuinely in flight. With an already-resolved mock the settle
    // (and the re-consult it triggers) lands inside the same act() flush.
    let settle: (value: Awaited<ReturnType<typeof followByHandle>>) => void =
      () => {};
    followByHandleMock.mockImplementation(
      () =>
        new Promise<Awaited<ReturnType<typeof followByHandle>>>((resolve) => {
          settle = resolve;
        }),
    );
    const { result } = renderHook(() => useFollows());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.toggleFollow('claire_r'));

    // Optimistic: following reads true immediately (case-insensitive).
    expect(result.current.isFollowing('Claire_R')).toBe(true);

    // A settled write re-consults the server — that is how another mount or
    // tab learns about it — so the mock answers as the server now would.
    fetchFollowsMock.mockResolvedValue([MAYA]);
    await act(async () => {
      settle({ profile: MAYA, status: 'followed' });
    });

    await waitFor(() =>
      expect(result.current.circle).toContainEqual(MAYA),
    );
    expect(followByHandleMock).toHaveBeenCalledWith(fakeSupabase, 'claire_r');
    // Server mode never writes the local follows key.
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it('rolls the optimistic entry back when followByHandle fails', async () => {
    followByHandleMock.mockResolvedValue(null);
    const { result } = renderHook(() => useFollows());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.toggleFollow('nobody'));
    expect(result.current.isFollowing('nobody')).toBe(true);

    await waitFor(() =>
      expect(result.current.isFollowing('nobody')).toBe(false),
    );
  });

  it('toggleFollow on a followed handle unfollows optimistically via unfollowById (no search-cap spend)', async () => {
    fetchFollowsMock.mockResolvedValue([MAYA, DEV]);
    unfollowByIdMock.mockResolvedValue(true);
    const { result } = renderHook(() => useFollows());
    await waitFor(() => expect(result.current.circle).toHaveLength(2));

    // The settled unfollow re-consults the server, which no longer lists MAYA.
    fetchFollowsMock.mockResolvedValue([DEV]);
    act(() => result.current.toggleFollow('claire_r'));

    expect(result.current.isFollowing('Claire_R')).toBe(false);
    await waitFor(() =>
      expect(unfollowByIdMock).toHaveBeenCalledWith(fakeSupabase, 'uuid-claire'),
    );
    expect(unfollowByHandleMock).not.toHaveBeenCalled();
    await waitFor(() => expect(result.current.circle).toEqual([DEV]));
  });

  it('restores the entry when the unfollow reports failure', async () => {
    fetchFollowsMock.mockResolvedValue([MAYA]);
    unfollowByIdMock.mockResolvedValue(false);
    const { result } = renderHook(() => useFollows());
    await waitFor(() => expect(result.current.circle).toHaveLength(1));

    act(() => result.current.toggleFollow('Claire_R'));
    expect(result.current.isFollowing('Claire_R')).toBe(false);

    await waitFor(() => expect(result.current.isFollowing('Claire_R')).toBe(true));
  });
});

describe('useFollows — follow requests (B3b)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
    useAuthMock.mockReturnValue(signedInAuthState('user-1'));
    getBrowserSupabaseMock.mockReturnValue(fakeSupabase);
    fetchFollowsMock.mockResolvedValue([]);
    fetchOutgoingRequestsMock.mockResolvedValue([]);
    followByHandleMock.mockResolvedValue(null);
    unfollowByHandleMock.mockResolvedValue(false);
  });

  afterEach(() => vi.clearAllMocks());

  it('hydrates outgoing requests so "Requested" survives a reload', async () => {
    fetchOutgoingRequestsMock.mockResolvedValue([MAYA]);

    const { result } = renderHook(() => useFollows());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.requested).toEqual([MAYA]);
    expect(result.current.isRequested('claire_r')).toBe(true);
    expect(result.current.isFollowing('claire_r')).toBe(false);
  });

  it("a 'requested' outcome moves the optimistic entry to requested, not the circle", async () => {
    let settle: (value: Awaited<ReturnType<typeof followByHandle>>) => void =
      () => {};
    followByHandleMock.mockImplementation(
      () =>
        new Promise<Awaited<ReturnType<typeof followByHandle>>>((resolve) => {
          settle = resolve;
        }),
    );
    const { result } = renderHook(() => useFollows());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.toggleFollow('claire_r'));
    // Optimistic phase: appears as following until the server answers.
    expect(result.current.isFollowing('Claire_R')).toBe(true);

    // Post-write server state: the request exists, the circle does not have her.
    fetchOutgoingRequestsMock.mockResolvedValue([MAYA]);
    await act(async () => {
      settle({ profile: MAYA, status: 'requested' });
    });

    await waitFor(() => expect(result.current.isRequested('Claire_R')).toBe(true));
    expect(result.current.isFollowing('Claire_R')).toBe(false);
    expect(result.current.circle).toEqual([]);
    expect(result.current.requested).toEqual([MAYA]);
  });

  it('toggling a requested handle withdraws the request via cancelFollowRequest', async () => {
    fetchOutgoingRequestsMock.mockResolvedValue([MAYA]);
    cancelFollowRequestMock.mockResolvedValue(true);
    const { result } = renderHook(() => useFollows());
    await waitFor(() => expect(result.current.requested).toHaveLength(1));

    act(() => result.current.toggleFollow('Claire_R'));

    expect(result.current.isRequested('Claire_R')).toBe(false);
    await waitFor(() =>
      expect(cancelFollowRequestMock).toHaveBeenCalledWith(
        fakeSupabase,
        'uuid-claire',
      ),
    );
    // A withdraw must not fire a follow or unfollow.
    expect(followByHandleMock).not.toHaveBeenCalled();
    expect(unfollowByIdMock).not.toHaveBeenCalled();
  });

  it('restores the requested entry when the cancel reports failure', async () => {
    fetchOutgoingRequestsMock.mockResolvedValue([MAYA]);
    cancelFollowRequestMock.mockResolvedValue(false);
    const { result } = renderHook(() => useFollows());
    await waitFor(() => expect(result.current.requested).toHaveLength(1));

    act(() => result.current.toggleFollow('Claire_R'));
    expect(result.current.isRequested('Claire_R')).toBe(false);

    await waitFor(() =>
      expect(result.current.isRequested('Claire_R')).toBe(true),
    );
  });

  it('requested is [] and isRequested false in local mode', async () => {
    useAuthMock.mockReturnValue(signedOutAuthState());
    getBrowserSupabaseMock.mockReturnValue(null);
    const { result } = renderHook(() => useFollows());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.mode).toBe('local');
    expect(result.current.requested).toEqual([]);
    expect(result.current.isRequested(DEFAULT_FOLLOWS[0] ?? 'claire')).toBe(false);
  });
});

describe('useFollows — double-tap race on an in-flight follow (Opus B3b review)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
    useAuthMock.mockReturnValue(signedInAuthState('user-1'));
    getBrowserSupabaseMock.mockReturnValue(fakeSupabase);
    fetchFollowsMock.mockResolvedValue([]);
    fetchOutgoingRequestsMock.mockResolvedValue([]);
    unfollowByHandleMock.mockResolvedValue(false);
  });

  afterEach(() => vi.clearAllMocks());

  it('a second tap while the placeholder resolves is ignored — no phantom Following beside Requested', async () => {
    let resolveFollow: (v: unknown) => void = () => {};
    followByHandleMock.mockReturnValue(
      new Promise((res) => {
        resolveFollow = res as (v: unknown) => void;
      }) as never,
    );
    const { result } = renderHook(() => useFollows());
    await waitFor(() => expect(result.current.loading).toBe(false));

    // First tap: optimistic placeholder appears in the circle.
    act(() => result.current.toggleFollow('ava_p'));
    expect(result.current.isFollowing('ava_p')).toBe(true);

    // Second tap lands while the follow is still in flight — must be a
    // no-op (no unfollow fires, placeholder untouched).
    act(() => result.current.toggleFollow('ava_p'));
    expect(unfollowByIdMock).not.toHaveBeenCalled();
    expect(unfollowByHandleMock).not.toHaveBeenCalled();
    expect(result.current.isFollowing('ava_p')).toBe(true);

    // The server settles: private target → 'requested'. The entry must end
    // in requested ONLY — no phantom left in the circle.
    const AVA = { id: 'uuid-ava', handle: 'ava_p', displayName: 'Ava P.' };
    fetchOutgoingRequestsMock.mockResolvedValue([AVA]);
    await act(async () => {
      resolveFollow({ profile: AVA, status: 'requested' });
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.isRequested('ava_p')).toBe(true));
    expect(result.current.isFollowing('ava_p')).toBe(false);
    expect(result.current.circle).toEqual([]);
    expect(result.current.requested).toEqual([AVA]);
  });
});

describe('useFollows — followers + mutuals (B3c)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
    useAuthMock.mockReturnValue(signedInAuthState('user-1'));
    getBrowserSupabaseMock.mockReturnValue(fakeSupabase);
    fetchFollowsMock.mockResolvedValue([]);
    fetchOutgoingRequestsMock.mockResolvedValue([]);
    fetchFollowersMock.mockResolvedValue([]);
    followByHandleMock.mockResolvedValue(null);
  });

  afterEach(() => vi.clearAllMocks());

  it('hydrates followers and derives mutuals as the intersection', async () => {
    fetchFollowsMock.mockResolvedValue([MAYA, DEV]);
    fetchFollowersMock.mockResolvedValue([MAYA]);

    const { result } = renderHook(() => useFollows());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.followers).toEqual([MAYA]);
    expect(result.current.mutuals).toEqual([MAYA]); // follows both ways
    expect(result.current.circle).toEqual([MAYA, DEV]);
  });

  it('pre-0010 (followers RPC missing → null) keeps followers empty, mutuals empty', async () => {
    fetchFollowsMock.mockResolvedValue([MAYA]);
    fetchFollowersMock.mockResolvedValue(null);

    const { result } = renderHook(() => useFollows());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.followers).toEqual([]);
    expect(result.current.mutuals).toEqual([]);
  });

  it('followers and mutuals are [] in local mode', async () => {
    useAuthMock.mockReturnValue(signedOutAuthState());
    getBrowserSupabaseMock.mockReturnValue(null);
    const { result } = renderHook(() => useFollows());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.followers).toEqual([]);
    expect(result.current.mutuals).toEqual([]);
  });

  it('circleReady is false while the hydrate is in flight and after it FAILS', async () => {
    // null = the fetch failed. `loading` resolves either way, so an empty
    // circle after a failure is indistinguishable from "no friends" — which is
    // exactly the state that let a night out go out with nobody invited.
    fetchFollowsMock.mockResolvedValue(null);

    const { result } = renderHook(() => useFollows());
    expect(result.current.circleReady).toBe(false);

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.circle).toEqual([]);
    expect(result.current.circleReady).toBe(false);
  });

  it('a settled follow re-hydrates instead of just releasing the flag', async () => {
    // The hole round 4 left: clearing "in flight" is not the same as "the
    // snapshot is current". The new mount's fetch is answered BEFORE the write
    // commits, so releasing readiness when the write settles hands the caller a
    // circle that predates it. Readiness must wait for a fetch taken AFTER.
    let settleFollow: (value: Awaited<ReturnType<typeof followByHandle>>) => void =
      () => {};
    followByHandleMock.mockImplementation(
      () =>
        new Promise<Awaited<ReturnType<typeof followByHandle>>>((resolve) => {
          settleFollow = resolve;
        }),
    );

    const first = renderHook(() => useFollows());
    await waitFor(() => expect(first.result.current.loading).toBe(false));
    act(() => first.result.current.toggleFollow('maya'));
    first.unmount();

    // The pre-follow snapshot arrives at the new mount.
    const second = renderHook(() => useFollows());
    await waitFor(() => expect(second.result.current.loading).toBe(false));
    expect(second.result.current.circleReady).toBe(false);

    // Hold the re-hydrate open so the window between "write settled" and
    // "fresh snapshot in hand" is observable. That window is the whole point:
    // with readiness released by an empty pending set alone, this is where a
    // night out goes out over the stale circle.
    let settleRefetch: (value: typeof MAYA[]) => void = () => {};
    fetchFollowsMock.mockImplementation(
      () => new Promise<typeof MAYA[]>((resolve) => { settleRefetch = resolve; }),
    );

    await act(async () => {
      settleFollow({ profile: MAYA, status: 'followed' });
    });

    // Nothing is in flight any more, and the circle is STILL the stale one.
    expect(second.result.current.circle).toEqual([]);
    expect(second.result.current.circleReady).toBe(false);

    // Only the fresh snapshot restores readiness.
    await act(async () => {
      settleRefetch([MAYA]);
    });
    await waitFor(() => expect(second.result.current.circleReady).toBe(true));
    expect(second.result.current.circle).toEqual([MAYA]);
    second.unmount();
  });

  it('never reports ready over a stale circle, not even for a single render', async () => {
    // The narrow version of the same rule. Releasing the pending flag and
    // re-hydrating happen in that order, so for one render the old snapshot is
    // present with nothing in flight. Pinning readiness to the generation its
    // fetch answered for closes that render; the refetch alone does not.
    let settleFollow: (value: Awaited<ReturnType<typeof followByHandle>>) => void =
      () => {};
    followByHandleMock.mockImplementation(
      () =>
        new Promise<Awaited<ReturnType<typeof followByHandle>>>((resolve) => {
          settleFollow = resolve;
        }),
    );

    const seen: Array<{ ready: boolean; size: number }> = [];
    const { result, unmount } = renderHook(() => {
      const value = useFollows();
      seen.push({ ready: value.circleReady, size: value.circle.length });
      return value;
    });
    await waitFor(() => expect(result.current.circleReady).toBe(true));

    act(() => result.current.toggleFollow('Claire_R'));
    seen.length = 0; // only the settle onwards is under test

    fetchFollowsMock.mockResolvedValue([MAYA]);
    await act(async () => {
      settleFollow({ profile: MAYA, status: 'followed' });
    });
    await waitFor(() => expect(result.current.circleReady).toBe(true));

    // No render may have claimed readiness while the circle was still empty.
    expect(seen.filter((r) => r.ready && r.size === 0)).toEqual([]);
    unmount();
  });

  it('a revalidation never flips `loading` back on — lists must not blank', async () => {
    // /friends/following and /friends/followers replace their whole list with a
    // "Loading…" placeholder whenever `loading` is true. Re-running the hydrate
    // on every settled write used to do exactly that for a full three-RPC round
    // trip after each unfollow (round-5 panel, Claude, HIGH).
    fetchFollowsMock.mockResolvedValue([MAYA]);
    unfollowByIdMock.mockResolvedValue(true);

    const loadingSeen: boolean[] = [];
    const { result, unmount } = renderHook(() => {
      const value = useFollows();
      loadingSeen.push(value.loading);
      return value;
    });
    await waitFor(() => expect(result.current.circleReady).toBe(true));
    loadingSeen.length = 0;

    fetchFollowsMock.mockResolvedValue([]);
    await act(async () => {
      result.current.toggleFollow('Claire_R');
    });
    await waitFor(() => expect(result.current.circleReady).toBe(true));

    expect(loadingSeen).not.toContain(true);
    unmount();
  });

  it('a superseded hydrate does not overwrite a newer optimistic write', async () => {
    // The re-hydrate a settled write triggers is in the air while the user taps
    // again. Applying that older snapshot wipes the placeholder the double-tap
    // guard depends on, so the button flips back to Follow (round-5 panel,
    // both lanes).
    fetchFollowsMock.mockResolvedValue([]);
    const { result, unmount } = renderHook(() => useFollows());
    await waitFor(() => expect(result.current.circleReady).toBe(true));

    // Hold the next hydrate open, then start a write while it is in flight.
    let settleHydrate: (value: typeof MAYA[]) => void = () => {};
    fetchFollowsMock.mockImplementation(
      () => new Promise<typeof MAYA[]>((resolve) => { settleHydrate = resolve; }),
    );
    let settleWrite: (value: Awaited<ReturnType<typeof followByHandle>>) => void =
      () => {};
    followByHandleMock.mockImplementation(
      () =>
        new Promise<Awaited<ReturnType<typeof followByHandle>>>((resolve) => {
          settleWrite = resolve;
        }),
    );

    // Trigger the re-hydrate the way the app does — another tab's ping.
    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', { key: 'next-bar:follows:dirty' }),
      );
    });
    act(() => result.current.toggleFollow('ava_p'));
    expect(result.current.isFollowing('ava_p')).toBe(true);

    // The older snapshot lands. It must be dropped, not applied.
    await act(async () => {
      settleHydrate([]);
    });
    expect(result.current.isFollowing('ava_p')).toBe(true);

    // Leave nothing in flight: the pending set is module state, so an unsettled
    // write would pin circleReady false for every later test in this file.
    fetchFollowsMock.mockResolvedValue([]);
    await act(async () => {
      settleWrite(null);
    });
    await waitFor(() => expect(result.current.circleReady).toBe(true));
    unmount();
  });

  it('another tab settling a write makes this tab re-hydrate before reporting ready', async () => {
    fetchFollowsMock.mockResolvedValue([]);
    const { result, unmount } = renderHook(() => useFollows());
    await waitFor(() => expect(result.current.circleReady).toBe(true));

    // The other tab followed someone; all we see is its storage ping. Hold the
    // re-hydrate open: nothing is pending in THIS tab, so the only thing that
    // can withhold readiness here is the snapshot's generation being older than
    // the current one. That window is a full round trip wide in production.
    let settleRefetch: (value: typeof MAYA[]) => void = () => {};
    fetchFollowsMock.mockImplementation(
      () => new Promise<typeof MAYA[]>((resolve) => { settleRefetch = resolve; }),
    );
    await act(async () => {
      window.dispatchEvent(
        new StorageEvent('storage', { key: 'next-bar:follows:dirty' }),
      );
    });

    expect(result.current.circle).toEqual([]);
    expect(result.current.circleReady).toBe(false);

    await act(async () => {
      settleRefetch([MAYA]);
    });
    await waitFor(() => expect(result.current.circle).toEqual([MAYA]));
    expect(result.current.circleReady).toBe(true);
    unmount();
  });

  it('coming back to the tab re-checks the circle', async () => {
    // The cross-tab ping is a best-effort localStorage write — quota or private
    // mode swallows it. Returning to the tab must re-check regardless, without
    // depending on the other tab having succeeded (round-5 panel, Codex).
    fetchFollowsMock.mockResolvedValue([]);
    const { result, unmount } = renderHook(() => useFollows());
    await waitFor(() => expect(result.current.circleReady).toBe(true));

    fetchFollowsMock.mockResolvedValue([MAYA]);
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    await waitFor(() => expect(result.current.circle).toEqual([MAYA]));
    unmount();
  });

  it('a REJECTED follow rolls back and never strands readiness', async () => {
    followByHandleMock.mockRejectedValue(new Error('network down'));

    const { result, unmount } = renderHook(() => useFollows());
    await waitFor(() => expect(result.current.circleReady).toBe(true));

    await act(async () => {
      result.current.toggleFollow('maya');
    });

    // The optimistic placeholder is gone, and readiness returns rather than
    // being pinned false for the rest of the session by a stranded marker.
    await waitFor(() => expect(result.current.circleReady).toBe(true));
    expect(result.current.isFollowing('maya')).toBe(false);
    unmount();
  });

  it('two overlapping writes for the SAME handle do not release each other', async () => {
    // Keyed by handle, the unfollow settling would have cleared the flag the
    // still-outstanding follow depended on (round-4 panel, Claude).
    fetchFollowsMock.mockResolvedValue([MAYA]);
    let settleUnfollow: (value: boolean) => void = () => {};
    let settleFollow: (value: Awaited<ReturnType<typeof followByHandle>>) => void =
      () => {};
    unfollowByIdMock.mockImplementation(
      () => new Promise<boolean>((resolve) => { settleUnfollow = resolve; }),
    );
    followByHandleMock.mockImplementation(
      () =>
        new Promise<Awaited<ReturnType<typeof followByHandle>>>((resolve) => {
          settleFollow = resolve;
        }),
    );

    const { result, unmount } = renderHook(() => useFollows());
    await waitFor(() => expect(result.current.circleReady).toBe(true));

    act(() => result.current.toggleFollow('Claire_R')); // unfollow, in flight
    act(() => result.current.toggleFollow('Claire_R')); // re-follow, also in flight
    expect(result.current.circleReady).toBe(false);

    await act(async () => {
      settleUnfollow(true);
    });

    // The follow is still outstanding, so the circle is still unsettled.
    expect(result.current.circleReady).toBe(false);

    // Settle it before leaving: the pending set is MODULE state, so a write
    // left in flight would pin circleReady false for every later test in this
    // file — the same way it would for the rest of a user's session.
    await act(async () => {
      settleFollow({ profile: MAYA, status: 'followed' });
    });
    await waitFor(() => expect(result.current.circleReady).toBe(true));
    unmount();
  });

  it('a follow still in flight keeps the NEXT mount from claiming readiness', async () => {
    // The navigation case: the user follows someone and moves to another page
    // before the RPC lands. The new mount fetches a snapshot that predates the
    // follow — genuine, and already out of date. Reporting it ready is how the
    // invite list silently loses that person.
    let settleFollow: (value: Awaited<ReturnType<typeof followByHandle>>) => void =
      () => {};
    followByHandleMock.mockImplementation(
      () =>
        new Promise<Awaited<ReturnType<typeof followByHandle>>>((resolve) => {
          settleFollow = resolve;
        }),
    );

    const first = renderHook(() => useFollows());
    await waitFor(() => expect(first.result.current.loading).toBe(false));
    expect(first.result.current.circleReady).toBe(true);

    act(() => first.result.current.toggleFollow('maya'));
    first.unmount();

    const second = renderHook(() => useFollows());
    await waitFor(() => expect(second.result.current.loading).toBe(false));
    expect(second.result.current.circleReady).toBe(false);

    // Once the server answers, the pending write clears and readiness returns.
    await act(async () => {
      settleFollow({ profile: MAYA, status: 'followed' });
    });
    await waitFor(() => expect(second.result.current.circleReady).toBe(true));
    second.unmount();
  });
});
