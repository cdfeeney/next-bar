import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BarRating } from '@/types/ratings';
import { useRatings } from './useRatings';

const KEY = 'next-bar:ratings:v1';
const MERGED_KEY = 'next-bar:ratings:merged-for:v1';
const OWNER_KEY = 'next-bar:account:owner:v1';

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
import { seedSampleNight } from '@/lib/demo/seed';
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

  it('DOES re-merge on a later mount even with the latch already set', async () => {
    // Was "does NOT re-merge … (MERGED_KEY honored)". That short-circuit lost
    // data (V8-2 round-2): anything written after the latch — rows rated while
    // signed out, or a row whose fire-and-forget upsert failed — was never
    // uploaded, and the residue wipe then deleted it because the latch said
    // the import was done. The merge is insert-only, so re-running is safe.
    window.localStorage.setItem(
      KEY,
      JSON.stringify([
        { barId: 'attaboy', rating: 'loved', ratedAt: '2026-05-10T00:00:00.000Z' },
      ]),
    );
    window.localStorage.setItem(MERGED_KEY, 'user-1');
    useAuthMock.mockReturnValue(signedInAuthState('user-1'));

    renderHook(() => useRatings());

    await waitFor(() => {
      expect(fetchServerRatingsMock).toHaveBeenCalled();
    });
    expect(mergeLocalRatingsToServerMock).toHaveBeenCalled();
  });

  it('a genuinely anonymous cache (no merged-for flag) DOES merge on first sign-in', async () => {
    // This was previously "re-merges when a DIFFERENT user signs in" — that
    // asserted the cross-account contamination bug as intended behavior.
    // The foreign-cache case is covered by the guard test below; the case
    // that still merges is an anonymous cache with NO owner flag.
    window.localStorage.setItem(
      KEY,
      JSON.stringify([
        { barId: 'attaboy', rating: 'loved', ratedAt: '2026-05-10T00:00:00.000Z' },
      ]),
    );
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

  it('setRating in server mode upserts AND write-through caches to localStorage (B0.3)', async () => {
    useAuthMock.mockReturnValue(signedInAuthState('user-1'));
    const { result } = renderHook(() => useRatings());
    await waitFor(() => expect(fetchServerRatingsMock).toHaveBeenCalled());

    act(() => {
      result.current.setRating('attaboy', 'loved');
    });

    // New rating: score arg is undefined (nothing to preserve or reset).
    expect(upsertServerRatingMock).toHaveBeenCalledWith(
      fakeSupabase,
      'user-1',
      'attaboy',
      'loved',
      undefined,
    );
    // Write-through cache: localStorage mirrors the server-mode write so
    // usePairwise and the sign-out fallback read current data.
    const cached = JSON.parse(window.localStorage.getItem(KEY) ?? '[]');
    expect(cached.some((r: { barId: string }) => r.barId === 'attaboy')).toBe(true);
    // Optimistic state update happened.
    expect(result.current.getRating('attaboy')).toBe('loved');
  });

  it('marks cache ownership on hydrate even when NO merge ran (santa round-3)', async () => {
    // Sign-in on a device with no local data: the fetch populates the
    // write-through cache — ownership must be marked anyway, or the cache
    // reads as anonymous and a later account would merge it.
    //
    // Ownership moved to its own key in the V8-2 review. It used to be the
    // merged-for latch, which ALSO meant "import finished" — so latching it
    // here silently marked a failed import done and killed its retry. The
    // guarantee this test protects is unchanged; only its carrier moved.
    fetchServerRatingsMock.mockResolvedValueOnce([
      { barId: 'attaboy', rating: 'loved', ratedAt: '2026-05-10T00:00:00.000Z' },
    ]);
    useAuthMock.mockReturnValue(signedInAuthState('user-1'));

    const { result } = renderHook(() => useRatings());
    await waitFor(() => expect(result.current.ratings).toHaveLength(1));

    expect(mergeLocalRatingsToServerMock).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(window.localStorage.getItem(OWNER_KEY)).toBe('user-1'),
    );
    // The import is latched as vacuously complete — there was nothing to
    // import. Leaving it null made hasPendingImport() report a pending import
    // forever for every account that first signed in on an empty device, so
    // the residual wipe never fired for them again (V8-2 round-2).
    await waitFor(() =>
      expect(window.localStorage.getItem(MERGED_KEY)).toBe('user-1'),
    );
  });

  it('retries the import on the next sign-in after a failed merge', async () => {
    // The defect the ownership split fixes: a failed import followed by a
    // successful fetch used to latch merged-for anyway, so the retry never
    // came — and the later residue wipe deleted the un-uploaded rows.
    window.localStorage.setItem(
      KEY,
      JSON.stringify([
        { barId: 'attaboy', rating: 'loved', ratedAt: '2026-05-10T00:00:00.000Z' },
      ]),
    );
    mergeLocalRatingsToServerMock.mockResolvedValueOnce(null); // import failed
    fetchServerRatingsMock.mockResolvedValueOnce([]);
    useAuthMock.mockReturnValue(signedInAuthState('user-1'));

    renderHook(() => useRatings());

    await waitFor(() =>
      expect(window.localStorage.getItem(OWNER_KEY)).toBe('user-1'),
    );
    // Owned (so the guards fire) but NOT marked imported (so it retries).
    expect(window.localStorage.getItem(MERGED_KEY)).toBeNull();
  });

  it("never merges another account's cached ratings into this one (cross-account guard)", async () => {
    // User A's write-through cache survived (e.g. session expired without
    // our sign-out button). User B signs in on the same browser.
    window.localStorage.setItem(
      KEY,
      JSON.stringify([
        { barId: 'attaboy', rating: 'loved', ratedAt: '2026-05-10T00:00:00.000Z' },
      ]),
    );
    window.localStorage.setItem('next-bar:ratings:merged-for:v1', 'user-A');
    useAuthMock.mockReturnValue(signedInAuthState('user-B'));

    renderHook(() => useRatings());
    await waitFor(() => expect(fetchServerRatingsMock).toHaveBeenCalled());

    // The foreign cache must be wiped, NEVER uploaded to user B.
    expect(mergeLocalRatingsToServerMock).not.toHaveBeenCalled();
    const cached = JSON.parse(window.localStorage.getItem(KEY) ?? '[]');
    expect(
      cached.some((r: { barId: string }) => r.barId === 'attaboy'),
    ).toBe(false);
  });

  it('setRating passes score:null on a tier CHANGE (stale band score must clear)', async () => {
    // The existing scored rating arrives from the server fetch; hydrate
    // writes it into the localStorage cache the tier-change check reads.
    fetchServerRatingsMock.mockResolvedValueOnce([
      { barId: 'attaboy', rating: 'loved', ratedAt: '2026-05-10T00:00:00.000Z', score: 9.1 },
    ]);
    useAuthMock.mockReturnValue(signedInAuthState('user-1'));
    const { result } = renderHook(() => useRatings());
    await waitFor(() => expect(result.current.ratings).toHaveLength(1));

    act(() => {
      result.current.setRating('attaboy', 'liked');
    });

    expect(upsertServerRatingMock).toHaveBeenCalledWith(
      fakeSupabase,
      'user-1',
      'attaboy',
      'liked',
      null,
    );
  });

  it('setRating syncs a direct numeric score through the existing rating row', async () => {
    fetchServerRatingsMock.mockResolvedValueOnce([]);
    useAuthMock.mockReturnValue(signedInAuthState('user-1'));
    const { result } = renderHook(() => useRatings());
    await waitFor(() => expect(fetchServerRatingsMock).toHaveBeenCalled());

    act(() => {
      result.current.setRating('attaboy', 'loved', 9.3);
    });

    expect(upsertServerRatingMock).toHaveBeenCalledWith(
      fakeSupabase,
      'user-1',
      'attaboy',
      'loved',
      9.3,
    );
    expect(result.current.ratings).toEqual([
      expect.objectContaining({ barId: 'attaboy', rating: 'loved', score: 9.3 }),
    ]);
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

  it('setRating in one server-mode instance propagates to a second instance without reload', async () => {
    useAuthMock.mockReturnValue(signedInAuthState('user-1'));
    const first = renderHook(() => useRatings());
    const second = renderHook(() => useRatings());
    await waitFor(() => expect(fetchServerRatingsMock).toHaveBeenCalled());

    act(() => {
      first.result.current.setRating('attaboy', 'loved');
    });

    // The tapping instance updates optimistically; the OTHER instance must
    // hear a broadcast — server mode never touches localStorage on writes,
    // so without it ResultsView/map/badges consumers stay stale until reload.
    expect(first.result.current.getRating('attaboy')).toBe('loved');
    expect(second.result.current.getRating('attaboy')).toBe('loved');
  });

  it('clearRating in one server-mode instance propagates to a second instance without reload', async () => {
    fetchServerRatingsMock.mockResolvedValue([
      { barId: 'attaboy', rating: 'loved', ratedAt: '2026-05-10T00:00:00.000Z' },
    ]);
    useAuthMock.mockReturnValue(signedInAuthState('user-1'));
    const first = renderHook(() => useRatings());
    const second = renderHook(() => useRatings());
    await waitFor(() => {
      expect(first.result.current.ratings).toHaveLength(1);
      expect(second.result.current.ratings).toHaveLength(1);
    });

    act(() => {
      first.result.current.clearRating('attaboy');
    });

    expect(first.result.current.getRating('attaboy')).toBeNull();
    expect(second.result.current.getRating('attaboy')).toBeNull();
  });

  it('excludes seeded sample-night demo ratings from the first sign-in merge', async () => {
    // One genuine rating, then the demo seeder layers the sample night on top.
    window.localStorage.setItem(
      KEY,
      JSON.stringify([
        { barId: 'pier-a', rating: 'liked', ratedAt: '2026-05-01T00:00:00.000Z' },
      ]),
    );
    seedSampleNight();
    useAuthMock.mockReturnValue(signedInAuthState('user-1'));

    renderHook(() => useRatings());

    await waitFor(() => {
      expect(mergeLocalRatingsToServerMock).toHaveBeenCalledTimes(1);
    });
    const [, , passedLocals] = mergeLocalRatingsToServerMock.mock.calls[0];
    expect(passedLocals.map((r) => r.barId)).toEqual(['pier-a']);
  });

  it('skips the merge call entirely when every local rating is seeded demo data', async () => {
    seedSampleNight();
    useAuthMock.mockReturnValue(signedInAuthState('user-1'));

    renderHook(() => useRatings());

    await waitFor(() => {
      expect(fetchServerRatingsMock).toHaveBeenCalled();
    });
    expect(mergeLocalRatingsToServerMock).not.toHaveBeenCalled();
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

  // V8-2 round-3 review (medium): ownership was latched only after a
  // SUCCESSFUL hydrate. A signed-in session whose every fetch fails still
  // write-throughs account rows to KEY; with no owner key that data reads as
  // anonymous, so clearResidualAccountCache never fires on expiry and the
  // next account merges the first one's ratings into its own.
  it('setRating marks cache ownership even when the hydrate fetch failed', async () => {
    fetchServerRatingsMock.mockResolvedValue(null); // hydrate failed
    useAuthMock.mockReturnValue(signedInAuthState('user-1'));

    const { result } = renderHook(() => useRatings());
    await waitFor(() => expect(fetchServerRatingsMock).toHaveBeenCalled());
    expect(window.localStorage.getItem(OWNER_KEY)).toBeNull();

    act(() => {
      result.current.setRating('attaboy', 'loved');
    });

    expect(window.localStorage.getItem(OWNER_KEY)).toBe('user-1');
  });

  it('clearRating marks cache ownership even when the hydrate fetch failed', async () => {
    window.localStorage.setItem(
      KEY,
      JSON.stringify([
        { barId: 'attaboy', rating: 'loved', ratedAt: '2026-05-10T00:00:00.000Z' },
      ]),
    );
    window.localStorage.setItem(MERGED_KEY, 'user-1'); // no first-sign-in merge
    fetchServerRatingsMock.mockResolvedValue(null); // hydrate failed
    useAuthMock.mockReturnValue(signedInAuthState('user-1'));

    const { result } = renderHook(() => useRatings());
    await waitFor(() => expect(fetchServerRatingsMock).toHaveBeenCalled());
    expect(window.localStorage.getItem(OWNER_KEY)).toBeNull();

    act(() => {
      result.current.clearRating('attaboy');
    });

    expect(window.localStorage.getItem(OWNER_KEY)).toBe('user-1');
  });
});
