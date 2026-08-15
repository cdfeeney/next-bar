import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BarRating } from '@/types/ratings';
import { getDirtyRatingIds, markRatingDirty } from '@/lib/accountCache';
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
  upsertServerRating: vi.fn(() => Promise.resolve(true)),
  deleteServerRating: vi.fn(() => Promise.resolve(true)),
  mergeLocalRatingsToServer: vi.fn(() => Promise.resolve([] as string[])),
}));

// The V7 pairwise transcript import moved onto this sign-in path (the
// pairwise UI is unwired) — mock its IO so these tests stay network-free.
vi.mock('@/lib/pairwise.server', () => ({
  mergeLocalComparisonsToServer: vi.fn(() => Promise.resolve(0)),
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
    mergeLocalRatingsToServerMock.mockResolvedValue([]);
    upsertServerRatingMock.mockResolvedValue(true);
    deleteServerRatingMock.mockResolvedValue(true);
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

  it('a pre-journal latch triggers ONE era reconcile — old-build stranded rows re-upload (final panel, Codex)', async () => {
    // v0.5 latched on hydrate, not upload completion: an upgrading device
    // can hold latch==user beside rows the old build never uploaded and the
    // journal never knew. Until the era marker names the user, the import
    // path runs once more (insert-only, server-wins, idempotent).
    window.localStorage.setItem(
      KEY,
      JSON.stringify([
        { barId: 'attaboy', rating: 'loved', ratedAt: '2026-05-10T00:00:00.000Z' },
      ]),
    );
    // Stale v0.5 latch, deliberately NO journal-era marker.
    window.localStorage.setItem(MERGED_KEY, 'user-1'); // upgrade moment
    useAuthMock.mockReturnValue(signedInAuthState('user-1'));

    renderHook(() => useRatings());

    await waitFor(() => {
      expect(mergeLocalRatingsToServerMock).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(window.localStorage.getItem('next-bar:journal-era:v1')).toBe('user-1');
    });
  });

  it('does NOT re-merge when the latch is set and the journal is clean (V8-2 round-3)', async () => {
    // Round-2 re-merged everything on every sign-in to fix stranded rows;
    // round-3 correctly flagged that as resurrection — a row deleted on
    // another device is absent from the server, so a blind insert-only
    // re-merge re-uploads it forever. Post-latch, only JOURNALED rows retry
    // (next test); an untouched cache re-uploads nothing.
    window.localStorage.setItem(
      KEY,
      JSON.stringify([
        { barId: 'attaboy', rating: 'loved', ratedAt: '2026-05-10T00:00:00.000Z' },
      ]),
    );
    window.localStorage.setItem(MERGED_KEY, 'user-1');
    window.localStorage.setItem('next-bar:journal-era:v1', 'user-1');
    useAuthMock.mockReturnValue(signedInAuthState('user-1'));

    renderHook(() => useRatings());

    await waitFor(() => {
      expect(fetchServerRatingsMock).toHaveBeenCalled();
    });
    expect(mergeLocalRatingsToServerMock).not.toHaveBeenCalled();
    expect(upsertServerRatingMock).not.toHaveBeenCalled();
  });

  it('retries ONLY journaled rows once the latch is set — upsert with the row’s own ratedAt', async () => {
    // The dirty journal is how a failed fire-and-forget write survives: the
    // sign-in retry re-upserts exactly those rows, carrying the original
    // ratedAt so a genuinely newer write from another device wins LWW.
    window.localStorage.setItem(
      KEY,
      JSON.stringify([
        { barId: 'attaboy', rating: 'loved', ratedAt: '2026-05-10T00:00:00.000Z' },
        { barId: 'dante', rating: 'liked', ratedAt: '2026-05-11T00:00:00.000Z' },
      ]),
    );
    window.localStorage.setItem(MERGED_KEY, 'user-1');
    window.localStorage.setItem('next-bar:journal-era:v1', 'user-1');
    // dante is clean — it must NOT re-upload
    markRatingDirty('attaboy', '2026-05-10T00:00:00.000Z');
    useAuthMock.mockReturnValue(signedInAuthState('user-1'));

    renderHook(() => useRatings());

    await waitFor(() => {
      expect(upsertServerRatingMock).toHaveBeenCalledTimes(1);
    });
    expect(upsertServerRatingMock).toHaveBeenCalledWith(
      fakeSupabase,
      'user-1',
      'attaboy',
      'loved',
      undefined,
      '2026-05-10T00:00:00.000Z',
    );
    expect(mergeLocalRatingsToServerMock).not.toHaveBeenCalled();
    // Acked by the retry → journal entry cleared.
    await waitFor(() => {
      expect(getDirtyRatingIds()).toEqual([]);
    });
  });

  it('a journaled signed-in DELETE retries as a stamped server delete', async () => {
    // The unacked-delete case: clearRating journaled the delete intent,
    // removed the local row, and the fire-and-forget delete never acked.
    // The retry carries the delete's own stamp so the server-side LWW guard
    // spares a rating re-created later on another device (round-4, Codex).
    window.localStorage.setItem(KEY, JSON.stringify([]));
    window.localStorage.setItem(MERGED_KEY, 'user-1');
    window.localStorage.setItem('next-bar:journal-era:v1', 'user-1');
    markRatingDirty('attaboy', '2026-05-10T00:00:00.000Z', 'd');
    useAuthMock.mockReturnValue(signedInAuthState('user-1'));

    renderHook(() => useRatings());

    await waitFor(() => {
      expect(deleteServerRatingMock).toHaveBeenCalledWith(
        fakeSupabase,
        'user-1',
        'attaboy',
        '2026-05-10T00:00:00.000Z',
      );
    });
    expect(upsertServerRatingMock).not.toHaveBeenCalled();
  });

  it('an upsert-intent entry with no local row is dropped, never replayed as a delete (round-4, Claude)', async () => {
    // The anonymous-device case: rate X then clear X while signed out. The
    // clear withdraws the intent, but even a stale surviving 'u' entry must
    // NOT become a server delete — that erased the account's real rating
    // made on another device.
    window.localStorage.setItem(KEY, JSON.stringify([]));
    window.localStorage.setItem(MERGED_KEY, 'user-1');
    window.localStorage.setItem('next-bar:journal-era:v1', 'user-1');
    markRatingDirty('attaboy', '2026-05-10T00:00:00.000Z', 'u');
    useAuthMock.mockReturnValue(signedInAuthState('user-1'));

    renderHook(() => useRatings());

    await waitFor(() => {
      expect(getDirtyRatingIds()).toEqual([]);
    });
    expect(deleteServerRatingMock).not.toHaveBeenCalled();
    expect(upsertServerRatingMock).not.toHaveBeenCalled();
  });

  it('the first import clears journal protection ONLY for inserted rows — a server-skipped newer row retries under LWW (round-4, Claude+Codex corroborated)', async () => {
    // Seal wiped the latch; the user re-rated bar X while signed out (newer
    // than the server copy); on sign-back-in the insert-only merge SKIPS X.
    // The old bulk clear erased X's journal entry anyway and the hydrate
    // reverted the newer rating everywhere. Now: X's entry survives the
    // import, the retry upserts it with its own ratedAt, and when the
    // retry cannot ack, the hydrate still keeps the newer local row.
    const newerX = {
      barId: 'attaboy',
      rating: 'liked' as const,
      ratedAt: '2026-06-01T00:00:00.000Z',
    };
    window.localStorage.setItem(KEY, JSON.stringify([newerX]));
    markRatingDirty('attaboy', newerX.ratedAt); // journaled signed-out write
    mergeLocalRatingsToServerMock.mockResolvedValue([]); // server-wins: X skipped
    upsertServerRatingMock.mockResolvedValue(false); // retry cannot ack
    fetchServerRatingsMock.mockResolvedValue([
      { barId: 'attaboy', rating: 'loved', ratedAt: '2026-05-10T00:00:00.000Z' },
    ]);
    useAuthMock.mockReturnValue(signedInAuthState('user-1'));

    const { result } = renderHook(() => useRatings());

    // The retry ran with the row's own ratedAt (not a fresh stamp).
    await waitFor(() => {
      expect(upsertServerRatingMock).toHaveBeenCalledWith(
        fakeSupabase,
        'user-1',
        'attaboy',
        'liked',
        undefined,
        '2026-06-01T00:00:00.000Z',
      );
    });
    // Journal protection survived the import (no bulk clear)...
    expect(getDirtyRatingIds()).toEqual(['attaboy']);
    // ...so the hydrate keeps the NEWER local rating over the old server row.
    await waitFor(() => {
      expect(result.current.getRating('attaboy')).toBe('liked');
    });
  });

  it('the import ack is stamp-exact — a tap landing mid-merge keeps its newer protection (round-5, Claude)', async () => {
    // The T1 row is uploaded by the import; while the merge is in flight the
    // user taps the same bar again (T2 entry replaces T1's). The import's
    // ack carries T1's stamp, so it must NOT clear the T2 entry.
    const t1 = '2026-06-01T00:00:00.000Z';
    const t2 = '2026-06-01T00:00:05.000Z';
    window.localStorage.setItem(
      KEY,
      JSON.stringify([{ barId: 'attaboy', rating: 'loved', ratedAt: t1 }]),
    );
    markRatingDirty('attaboy', t1);
    let resolveMerge!: (v: string[]) => void;
    mergeLocalRatingsToServerMock.mockReturnValue(
      new Promise((res) => {
        resolveMerge = res;
      }),
    );
    upsertServerRatingMock.mockResolvedValue(false); // T2 write never acks
    useAuthMock.mockReturnValue(signedInAuthState('user-1'));

    renderHook(() => useRatings());
    await waitFor(() => expect(mergeLocalRatingsToServerMock).toHaveBeenCalled());

    // Mid-merge tap: newer entry replaces the journal slot.
    markRatingDirty('attaboy', t2);
    act(() => resolveMerge(['attaboy'])); // import inserted the T1 snapshot

    await waitFor(() =>
      expect(window.localStorage.getItem(MERGED_KEY)).toBe('user-1'),
    );
    // The T2 entry survived the import's T1-stamped ack.
    expect(getDirtyRatingIds()).toEqual(['attaboy']);
  });

  it('a future-stamped cached row from a skewed device does not suppress its own deletion (cycle-2 closing, Claude)', async () => {
    // Device B (clock +30m) rated bar X; this device cached it with the
    // future stamp; B then deleted X server-side. The unbounded freshness
    // clause kept resurrecting X here until the local clock caught up — the
    // upper bound drops it: not journaled, not within this flight's window.
    const future = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    window.localStorage.setItem(
      KEY,
      JSON.stringify([{ barId: 'attaboy', rating: 'loved', ratedAt: future }]),
    );
    window.localStorage.setItem(MERGED_KEY, 'user-1');
    window.localStorage.setItem('next-bar:journal-era:v1', 'user-1');
    fetchServerRatingsMock.mockResolvedValue([]); // X deleted server-side
    useAuthMock.mockReturnValue(signedInAuthState('user-1'));

    const { result } = renderHook(() => useRatings());

    await waitFor(() => {
      expect(result.current.getRating('attaboy')).toBeNull();
    });
    // And the write-through cache no longer holds the ghost either.
    const cached = JSON.parse(window.localStorage.getItem(KEY) ?? '[]');
    expect(
      cached.some((r: { barId: string }) => r.barId === 'attaboy'),
    ).toBe(false);
  });

  it('a failed retry keeps the row journaled for the next sign-in', async () => {
    window.localStorage.setItem(
      KEY,
      JSON.stringify([
        { barId: 'attaboy', rating: 'loved', ratedAt: '2026-05-10T00:00:00.000Z' },
      ]),
    );
    window.localStorage.setItem(MERGED_KEY, 'user-1');
    window.localStorage.setItem('next-bar:journal-era:v1', 'user-1');
    markRatingDirty('attaboy', '2026-05-10T00:00:00.000Z');
    upsertServerRatingMock.mockResolvedValue(false); // server never acks
    useAuthMock.mockReturnValue(signedInAuthState('user-1'));

    renderHook(() => useRatings());

    await waitFor(() => {
      expect(upsertServerRatingMock).toHaveBeenCalled();
    });
    expect(getDirtyRatingIds()).toEqual(['attaboy']);
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
    // 6th arg (round-4): the write's own stamp travels with the upsert so
    // the journal ack matches the exact write it acknowledges.
    await waitFor(() =>
      expect(upsertServerRatingMock).toHaveBeenCalledWith(
        fakeSupabase,
        'user-1',
        'attaboy',
        'loved',
        undefined,
        expect.any(String),
      ),
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

    await waitFor(() =>
      expect(upsertServerRatingMock).toHaveBeenCalledWith(
        fakeSupabase,
        'user-1',
        'attaboy',
        'liked',
        null,
        expect.any(String),
      ),
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

    await waitFor(() =>
      expect(upsertServerRatingMock).toHaveBeenCalledWith(
        fakeSupabase,
        'user-1',
        'attaboy',
        'loved',
        9.3,
        expect.any(String),
      ),
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

    // 4th arg (round-4): the delete carries its own stamp so the retry path
    // is LWW-guarded server-side.
    await waitFor(() =>
      expect(deleteServerRatingMock).toHaveBeenCalledWith(
        fakeSupabase,
        'user-1',
        'attaboy',
        expect.any(String),
      ),
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
    window.localStorage.setItem(MERGED_KEY, 'user-1');
    window.localStorage.setItem('next-bar:journal-era:v1', 'user-1'); // no first-sign-in merge
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
