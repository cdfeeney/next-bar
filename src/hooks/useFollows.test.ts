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

vi.mock('@/lib/follows.server', () => ({
  fetchFollows: vi.fn(() => Promise.resolve([])),
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
  fetchFollows,
  fetchOutgoingRequests,
  followByHandle,
  unfollowByHandle,
  unfollowById,
} from '@/lib/follows.server';

const useAuthMock = vi.mocked(useAuth);
const getBrowserSupabaseMock = vi.mocked(getBrowserSupabase);
const fetchFollowsMock = vi.mocked(fetchFollows);
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
    followByHandleMock.mockResolvedValue({ profile: MAYA, status: 'followed' });
    const { result } = renderHook(() => useFollows());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.toggleFollow('claire_r'));

    // Optimistic: following reads true immediately (case-insensitive).
    expect(result.current.isFollowing('Claire_R')).toBe(true);

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

    act(() => result.current.toggleFollow('claire_r'));

    expect(result.current.isFollowing('Claire_R')).toBe(false);
    await waitFor(() =>
      expect(unfollowByIdMock).toHaveBeenCalledWith(fakeSupabase, 'uuid-claire'),
    );
    expect(unfollowByHandleMock).not.toHaveBeenCalled();
    expect(result.current.circle).toEqual([DEV]);
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
    followByHandleMock.mockResolvedValue({ profile: MAYA, status: 'requested' });
    const { result } = renderHook(() => useFollows());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.toggleFollow('claire_r'));
    // Optimistic phase: appears as following until the server answers.
    expect(result.current.isFollowing('Claire_R')).toBe(true);

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
