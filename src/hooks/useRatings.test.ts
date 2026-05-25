import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BarRating } from '@/types/ratings';
import { useRatings } from './useRatings';

const KEY = 'next-bar:ratings:v1';
const MERGED_KEY = 'next-bar:ratings:merged-for:v1';

function looksLikeRating(arg: unknown): boolean {
  if (arg === null || typeof arg !== 'object') return false;
  const obj = arg as Record<string, unknown>;
  return (
    typeof obj.barId === 'string' &&
    typeof obj.rating === 'string' &&
    typeof obj.ratedAt === 'string'
  );
}

describe('useRatings', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    window.localStorage.clear();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
    vi.restoreAllMocks();
  });

  function assertNoRatingLogs(): void {
    const allCalls = [
      ...logSpy.mock.calls,
      ...warnSpy.mock.calls,
      ...errorSpy.mock.calls,
    ];
    for (const call of allCalls) {
      for (const arg of call) {
        expect(looksLikeRating(arg)).toBe(false);
      }
    }
  }

  it('hydrates from existing localStorage on mount', () => {
    const seed: BarRating[] = [
      { barId: 'bar-1', rating: 'loved', ratedAt: '2026-05-10T00:00:00.000Z' },
      { barId: 'bar-2', rating: 'liked', ratedAt: '2026-05-09T00:00:00.000Z' },
    ];
    window.localStorage.setItem(KEY, JSON.stringify(seed));

    const { result } = renderHook(() => useRatings());

    // useEffect runs synchronously in renderHook under jsdom.
    expect(result.current.ratings).toHaveLength(2);
    expect(result.current.getRating('bar-1')).toBe('loved');
    expect(result.current.getRating('bar-2')).toBe('liked');
    assertNoRatingLogs();
  });

  it('starts with an empty array when localStorage is empty (no SSR throw)', () => {
    const { result } = renderHook(() => useRatings());
    expect(result.current.ratings).toEqual([]);
    expect(result.current.getRating('bar-1')).toBeNull();
    assertNoRatingLogs();
  });

  it('setRating updates local state synchronously', () => {
    const { result } = renderHook(() => useRatings());

    act(() => {
      result.current.setRating('bar-1', 'loved');
    });

    expect(result.current.ratings).toHaveLength(1);
    expect(result.current.ratings[0].barId).toBe('bar-1');
    expect(result.current.ratings[0].rating).toBe('loved');
    expect(result.current.getRating('bar-1')).toBe('loved');
    assertNoRatingLogs();
  });

  it('setRating twice for the same barId overwrites (length stays 1)', () => {
    const { result } = renderHook(() => useRatings());

    act(() => {
      result.current.setRating('bar-1', 'liked');
    });
    act(() => {
      result.current.setRating('bar-1', 'pass');
    });

    expect(result.current.ratings).toHaveLength(1);
    expect(result.current.getRating('bar-1')).toBe('pass');
  });

  it('clearRating removes the rating from local state', () => {
    const { result } = renderHook(() => useRatings());

    act(() => {
      result.current.setRating('bar-1', 'loved');
      result.current.setRating('bar-2', 'liked');
    });
    expect(result.current.ratings).toHaveLength(2);

    act(() => {
      result.current.clearRating('bar-1');
    });

    expect(result.current.ratings).toHaveLength(1);
    expect(result.current.getRating('bar-1')).toBeNull();
    expect(result.current.getRating('bar-2')).toBe('liked');
    assertNoRatingLogs();
  });

  it('responds to a storage event from another simulated source (re-reads)', () => {
    const { result } = renderHook(() => useRatings());
    expect(result.current.ratings).toEqual([]);

    // Simulate another tab writing to localStorage, then firing a storage event.
    const external: BarRating[] = [
      { barId: 'external-bar', rating: 'loved', ratedAt: '2026-05-10T00:00:00.000Z' },
    ];
    window.localStorage.setItem(KEY, JSON.stringify(external));

    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: KEY }));
    });

    expect(result.current.ratings).toHaveLength(1);
    expect(result.current.getRating('external-bar')).toBe('loved');
    assertNoRatingLogs();
  });

  it('responds to a storage event with key === null (localStorage.clear)', () => {
    const seed: BarRating[] = [
      { barId: 'bar-1', rating: 'loved', ratedAt: '2026-05-10T00:00:00.000Z' },
    ];
    window.localStorage.setItem(KEY, JSON.stringify(seed));

    const { result } = renderHook(() => useRatings());
    expect(result.current.ratings).toHaveLength(1);

    window.localStorage.clear();
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: null }));
    });

    expect(result.current.ratings).toEqual([]);
  });

  it('ignores storage events for other keys', () => {
    const { result } = renderHook(() => useRatings());

    act(() => {
      result.current.setRating('bar-1', 'loved');
    });
    expect(result.current.ratings).toHaveLength(1);

    // An unrelated storage event should NOT trigger a re-read that wipes state.
    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', { key: 'unrelated-key' }),
      );
    });

    expect(result.current.ratings).toHaveLength(1);
    expect(result.current.getRating('bar-1')).toBe('loved');
  });

  it('getRating returns the in-state value', () => {
    const { result } = renderHook(() => useRatings());

    act(() => {
      result.current.setRating('bar-1', 'loved');
      result.current.setRating('bar-2', 'pass');
    });

    expect(result.current.getRating('bar-1')).toBe('loved');
    expect(result.current.getRating('bar-2')).toBe('pass');
    expect(result.current.getRating('unknown')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Server-mode tests (v0.5.0 sign-in branch)
// ---------------------------------------------------------------------------
//
// These exercise the auth.status === 'signed-in' branch of useRatings, where
// the hook delegates to ratings.server.ts instead of localStorage. We mock
// useAuth, the supabase browser client, and the four server-rating IO
// functions so the test runs in jsdom with zero network.

// Mock factories give sane defaults so the local-mode tests above this
// block keep passing without per-test setup. Server-mode tests below
// override these via mockReturnValue / mockResolvedValue.
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

vi.mock('@/lib/ratings.server', () => ({
  fetchServerRatings: vi.fn(() => Promise.resolve([])),
  upsertServerRating: vi.fn(() => Promise.resolve()),
  deleteServerRating: vi.fn(() => Promise.resolve()),
  mergeLocalRatingsToServer: vi.fn(() => Promise.resolve(0)),
}));

// Pull the mocked symbols after vi.mock so they're typed as the mock fns.
import { useAuth } from '@/hooks/useAuth';
import { getBrowserSupabase } from '@/lib/supabase/client';
import {
  deleteServerRating,
  fetchServerRatings,
  mergeLocalRatingsToServer,
  upsertServerRating,
} from '@/lib/ratings.server';

const useAuthMock = vi.mocked(useAuth);
const getBrowserSupabaseMock = vi.mocked(getBrowserSupabase);
const fetchServerRatingsMock = vi.mocked(fetchServerRatings);
const upsertServerRatingMock = vi.mocked(upsertServerRating);
const deleteServerRatingMock = vi.mocked(deleteServerRating);
const mergeLocalRatingsToServerMock = vi.mocked(mergeLocalRatingsToServer);

// Minimal stand-in for SupabaseClient — useRatings only checks for non-null,
// then passes it straight to the (mocked) ratings.server functions.
const fakeSupabase = {} as unknown as ReturnType<typeof getBrowserSupabase>;

function signedInAuthState(userId = 'user-1', email = 'connor@example.com') {
  return {
    status: 'signed-in' as const,
    user: { id: userId, email } as never,
    session: { user: { id: userId, email } } as never,
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

describe('useRatings — server mode', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
    getBrowserSupabaseMock.mockReturnValue(fakeSupabase);
    fetchServerRatingsMock.mockResolvedValue([]);
    mergeLocalRatingsToServerMock.mockResolvedValue(0);
    upsertServerRatingMock.mockResolvedValue(undefined);
    deleteServerRatingMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('on first sign-in with localStorage ratings, calls mergeLocalRatingsToServer exactly once with those ratings', async () => {
    const local: BarRating[] = [
      { barId: 'attaboy', rating: 'loved', ratedAt: '2026-05-10T00:00:00.000Z' },
      { barId: 'death-and-co', rating: 'liked', ratedAt: '2026-05-12T00:00:00.000Z' },
    ];
    window.localStorage.setItem(KEY, JSON.stringify(local));
    useAuthMock.mockReturnValue(signedInAuthState('user-1'));

    renderHook(() => useRatings());

    await waitFor(() => {
      expect(mergeLocalRatingsToServerMock).toHaveBeenCalledTimes(1);
    });
    const [client, userId, passedLocals] = mergeLocalRatingsToServerMock.mock.calls[0];
    expect(client).toBe(fakeSupabase);
    expect(userId).toBe('user-1');
    expect(passedLocals).toEqual(local);
    expect(window.localStorage.getItem(MERGED_KEY)).toBe('user-1');
  });

  it('does NOT re-merge on a second mount for the same user (MERGED_KEY honored)', async () => {
    window.localStorage.setItem(
      KEY,
      JSON.stringify([
        { barId: 'attaboy', rating: 'loved', ratedAt: '2026-05-10T00:00:00.000Z' },
      ]),
    );
    window.localStorage.setItem(MERGED_KEY, 'user-1');
    useAuthMock.mockReturnValue(signedInAuthState('user-1'));

    renderHook(() => useRatings());

    // Server fetch still runs to load the current rating set; merge does not.
    await waitFor(() => {
      expect(fetchServerRatingsMock).toHaveBeenCalled();
    });
    expect(mergeLocalRatingsToServerMock).not.toHaveBeenCalled();
  });

  it('re-merges when a DIFFERENT user signs in on the same browser', async () => {
    window.localStorage.setItem(
      KEY,
      JSON.stringify([
        { barId: 'attaboy', rating: 'loved', ratedAt: '2026-05-10T00:00:00.000Z' },
      ]),
    );
    window.localStorage.setItem(MERGED_KEY, 'previous-user');
    useAuthMock.mockReturnValue(signedInAuthState('user-1'));

    renderHook(() => useRatings());

    await waitFor(() => {
      expect(mergeLocalRatingsToServerMock).toHaveBeenCalledTimes(1);
    });
    expect(window.localStorage.getItem(MERGED_KEY)).toBe('user-1');
  });

  it('skips the merge call entirely when localStorage is empty (nothing to merge)', async () => {
    useAuthMock.mockReturnValue(signedInAuthState('user-1'));

    renderHook(() => useRatings());

    await waitFor(() => {
      expect(fetchServerRatingsMock).toHaveBeenCalled();
    });
    expect(mergeLocalRatingsToServerMock).not.toHaveBeenCalled();
  });

  it('reflects fetchServerRatings result in state once merge resolves', async () => {
    const serverSide: BarRating[] = [
      { barId: 'employees-only', rating: 'loved', ratedAt: '2026-05-01T00:00:00.000Z' },
    ];
    fetchServerRatingsMock.mockResolvedValueOnce(serverSide);
    useAuthMock.mockReturnValue(signedInAuthState('user-1'));

    const { result } = renderHook(() => useRatings());

    await waitFor(() => {
      expect(result.current.ratings).toEqual(serverSide);
    });
  });

  it('setRating in server mode goes through upsertServerRating (not localStorage)', async () => {
    useAuthMock.mockReturnValue(signedInAuthState('user-1'));
    const { result } = renderHook(() => useRatings());
    await waitFor(() => expect(fetchServerRatingsMock).toHaveBeenCalled());

    act(() => {
      result.current.setRating('attaboy', 'loved');
    });

    expect(upsertServerRatingMock).toHaveBeenCalledWith(
      fakeSupabase,
      'user-1',
      'attaboy',
      'loved',
    );
    // The KEY localStorage path was NOT touched on writes in server mode.
    expect(window.localStorage.getItem(KEY)).toBeNull();
    // Optimistic state update happened.
    expect(result.current.getRating('attaboy')).toBe('loved');
  });

  it('clearRating in server mode goes through deleteServerRating (not localStorage)', async () => {
    fetchServerRatingsMock.mockResolvedValueOnce([
      { barId: 'attaboy', rating: 'loved', ratedAt: '2026-05-10T00:00:00.000Z' },
    ]);
    useAuthMock.mockReturnValue(signedInAuthState('user-1'));
    const { result } = renderHook(() => useRatings());
    await waitFor(() => expect(result.current.ratings).toHaveLength(1));

    act(() => {
      result.current.clearRating('attaboy');
    });

    expect(deleteServerRatingMock).toHaveBeenCalledWith(
      fakeSupabase,
      'user-1',
      'attaboy',
    );
    expect(result.current.getRating('attaboy')).toBeNull();
  });

  it('signed-out mode bypasses server and uses localStorage', async () => {
    window.localStorage.setItem(
      KEY,
      JSON.stringify([
        { barId: 'attaboy', rating: 'loved', ratedAt: '2026-05-10T00:00:00.000Z' },
      ]),
    );
    useAuthMock.mockReturnValue(signedOutAuthState());

    const { result } = renderHook(() => useRatings());

    expect(result.current.getRating('attaboy')).toBe('loved');
    // None of the server fns should have been called.
    expect(fetchServerRatingsMock).not.toHaveBeenCalled();
    expect(mergeLocalRatingsToServerMock).not.toHaveBeenCalled();

    act(() => {
      result.current.setRating('death-and-co', 'liked');
    });
    expect(upsertServerRatingMock).not.toHaveBeenCalled();
    expect(result.current.getRating('death-and-co')).toBe('liked');
    // localStorage was the write target.
    const stored = JSON.parse(window.localStorage.getItem(KEY) ?? '[]');
    expect(stored.map((r: BarRating) => r.barId).sort()).toEqual([
      'attaboy',
      'death-and-co',
    ]);
  });

  it('when getBrowserSupabase returns null, server-mode falls back to localStorage', async () => {
    getBrowserSupabaseMock.mockReturnValue(null);
    useAuthMock.mockReturnValue(signedInAuthState('user-1'));

    const { result } = renderHook(() => useRatings());

    // No merge call — supabase was unavailable so we couldn't sync.
    expect(mergeLocalRatingsToServerMock).not.toHaveBeenCalled();
    expect(fetchServerRatingsMock).not.toHaveBeenCalled();

    act(() => {
      result.current.setRating('attaboy', 'loved');
    });
    expect(upsertServerRatingMock).not.toHaveBeenCalled();
    expect(result.current.getRating('attaboy')).toBe('loved');
    const stored = JSON.parse(window.localStorage.getItem(KEY) ?? '[]');
    expect(stored).toHaveLength(1);
  });
});
