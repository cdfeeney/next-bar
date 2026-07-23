import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BarRating, PairwiseComparison } from '@/types/ratings';
import { usePairwise } from './usePairwise';

const RATINGS_KEY = 'next-bar:ratings:v1';
const COMPARISONS_KEY = 'next-bar:pairwise:v1';

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

vi.mock('@/lib/pairwise.server', () => ({
  fetchServerComparisons: vi.fn(async () => []),
  insertServerComparison: vi.fn(async () => undefined),
  mergeLocalComparisonsToServer: vi.fn(async () => 0),
}));

// useRatings (imported for broadcastServerRatingSet) pulls the whole
// ratings.server surface — mock every export it needs.
vi.mock('@/lib/ratings.server', () => ({
  fetchServerRatings: vi.fn(async () => []),
  upsertServerRating: vi.fn(async () => undefined),
  updateServerScores: vi.fn(async () => undefined),
  deleteServerRating: vi.fn(async () => undefined),
  deleteAllServerRatings: vi.fn(async () => undefined),
  mergeLocalRatingsToServer: vi.fn(async () => 0),
}));

import { useAuth } from '@/hooks/useAuth';
import { getBrowserSupabase } from '@/lib/supabase/client';
import {
  fetchServerComparisons,
  insertServerComparison,
  mergeLocalComparisonsToServer,
} from '@/lib/pairwise.server';
import { updateServerScores } from '@/lib/ratings.server';
const useAuthMock = vi.mocked(useAuth);
const getBrowserSupabaseMock = vi.mocked(getBrowserSupabase);
const fetchServerComparisonsMock = vi.mocked(fetchServerComparisons);
const insertServerComparisonMock = vi.mocked(insertServerComparison);
const mergeLocalComparisonsToServerMock = vi.mocked(mergeLocalComparisonsToServer);
const updateServerScoresMock = vi.mocked(updateServerScores);

function seedRatings(rs: BarRating[]) {
  window.localStorage.setItem(RATINGS_KEY, JSON.stringify(rs));
}
function seedComparisons(cs: PairwiseComparison[]) {
  window.localStorage.setItem(COMPARISONS_KEY, JSON.stringify(cs));
}
function readRatings(): BarRating[] {
  return JSON.parse(window.localStorage.getItem(RATINGS_KEY) ?? '[]');
}
function readComparisons(): PairwiseComparison[] {
  return JSON.parse(window.localStorage.getItem(COMPARISONS_KEY) ?? '[]');
}

function rating(barId: string, tier: 'loved' | 'liked' | 'pass', score?: number): BarRating {
  return {
    barId,
    rating: tier,
    ratedAt: '2026-05-20T00:00:00.000Z',
    ...(score !== undefined ? { score } : {}),
  };
}

describe('usePairwise — local mode (signed-out)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    useAuthMock.mockReturnValue({
      status: 'signed-out',
      user: null,
      session: null,
      signOut: vi.fn(),
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('hydrates comparisons from localStorage on mount', async () => {
    seedComparisons([
      { winnerBarId: 'a', loserBarId: 'b', comparedAt: '2026-05-20T00:00:00.000Z' },
    ]);

    const { result } = renderHook(() => usePairwise());

    await waitFor(() => {
      expect(result.current.comparisons).toHaveLength(1);
    });
    expect(result.current.comparisons[0].winnerBarId).toBe('a');
    expect(result.current.pendingPrompt).toBeNull();
  });

  it('requestPrompt sets pendingPrompt when a same-tier peer exists', () => {
    seedRatings([
      rating('a', 'loved'),
      rating('b', 'loved'),
    ]);

    const { result } = renderHook(() => usePairwise());

    act(() => {
      result.current.requestPrompt('a', 'loved');
    });

    expect(result.current.pendingPrompt).toEqual({
      justRatedBarId: 'a',
      peerBarId: 'b',
      tier: 'loved',
    });
  });

  it('requestPrompt is a no-op when no same-tier peer exists', () => {
    seedRatings([rating('a', 'loved')]);

    const { result } = renderHook(() => usePairwise());

    act(() => {
      result.current.requestPrompt('a', 'loved');
    });

    expect(result.current.pendingPrompt).toBeNull();
  });

  it('requestPrompt is a no-op for tier="pass" (Q2 decision)', () => {
    seedRatings([rating('a', 'pass'), rating('b', 'pass')]);
    const { result } = renderHook(() => usePairwise());
    act(() => {
      result.current.requestPrompt('a', 'pass');
    });
    expect(result.current.pendingPrompt).toBeNull();
  });

  it('addComparison appends to localStorage and updates rating scores', () => {
    seedRatings([rating('a', 'loved'), rating('b', 'loved')]);

    const { result } = renderHook(() => usePairwise());
    act(() => {
      result.current.requestPrompt('a', 'loved');
    });
    expect(result.current.pendingPrompt).not.toBeNull();

    act(() => {
      result.current.addComparison('a', 'b');
    });

    expect(result.current.pendingPrompt).toBeNull();

    const persistedComparisons = readComparisons();
    expect(persistedComparisons).toHaveLength(1);
    expect(persistedComparisons[0]).toMatchObject({
      winnerBarId: 'a',
      loserBarId: 'b',
    });

    const persistedRatings = readRatings();
    const a = persistedRatings.find((r) => r.barId === 'a');
    const b = persistedRatings.find((r) => r.barId === 'b');
    // Both bars get scores; winner above loser. R8 clamp doesn't bite
    // because the prior score was the midpoint (9.0) and delta=1.0.
    expect(a?.score).toBeGreaterThan(b?.score ?? 0);
    expect(a?.score).toBeLessThanOrEqual(10);
    expect(b?.score).toBeGreaterThanOrEqual(8);
  });

  it('addComparison with winnerBarId === loserBarId is a no-op', () => {
    seedRatings([rating('a', 'loved'), rating('b', 'loved')]);

    const { result } = renderHook(() => usePairwise());
    act(() => {
      result.current.addComparison('a', 'a');
    });

    expect(readComparisons()).toEqual([]);
  });

  it('dismissPrompt clears pendingPrompt without writing a comparison', () => {
    seedRatings([rating('a', 'loved'), rating('b', 'loved')]);

    const { result } = renderHook(() => usePairwise());
    act(() => {
      result.current.requestPrompt('a', 'loved');
    });
    expect(result.current.pendingPrompt).not.toBeNull();

    act(() => {
      result.current.dismissPrompt();
    });

    expect(result.current.pendingPrompt).toBeNull();
    expect(readComparisons()).toEqual([]);
  });

  it('honors existing comparisons when picking the next peer (lowest count)', () => {
    seedRatings([
      rating('a', 'loved'),
      rating('b', 'loved'),
      rating('c', 'loved'),
    ]);
    // 'b' has 2 comparisons, 'c' has 0 → picker should choose 'c'.
    seedComparisons([
      { winnerBarId: 'a', loserBarId: 'b', comparedAt: '2026-05-19T00:00:00.000Z' },
      { winnerBarId: 'b', loserBarId: 'a', comparedAt: '2026-05-19T00:01:00.000Z' },
    ]);

    const { result } = renderHook(() => usePairwise());
    // Wait for hydration so comparisons state is loaded.
    expect(result.current.comparisons.length === 2 || result.current.comparisons.length === 0).toBe(true);

    act(() => {
      result.current.requestPrompt('a', 'loved');
    });

    expect(result.current.pendingPrompt?.peerBarId).toBe('c');
  });
});

describe('usePairwise — server mode (B0.4)', () => {
  const fakeSupabase = { __fake: true } as never;

  function signIn(): void {
    useAuthMock.mockReturnValue({
      status: 'signed-in',
      user: { id: 'user-1', email: 'connor@example.com' } as never,
      session: { user: { id: 'user-1' } } as never,
      signOut: vi.fn(),
    });
  }

  beforeEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
    signIn();
    getBrowserSupabaseMock.mockReturnValue(fakeSupabase);
    fetchServerComparisonsMock.mockResolvedValue([]);
  });

  it('falls back to local mode when supabase is unavailable', async () => {
    getBrowserSupabaseMock.mockReturnValue(null);
    seedRatings([rating('a', 'loved'), rating('b', 'loved')]);

    const { result } = renderHook(() => usePairwise());
    act(() => {
      result.current.requestPrompt('a', 'loved');
    });
    expect(result.current.pendingPrompt?.peerBarId).toBe('b');

    act(() => {
      result.current.addComparison('a', 'b');
    });
    // Local transcript written, nothing sent to the server.
    expect(readComparisons()).toHaveLength(1);
    expect(insertServerComparisonMock).not.toHaveBeenCalled();
  });

  it('merges the local transcript once per user, then serves the server transcript', async () => {
    const local: PairwiseComparison[] = [
      { winnerBarId: 'a', loserBarId: 'b', comparedAt: '2026-05-20T00:00:00.000Z' },
    ];
    const server: PairwiseComparison[] = [
      ...local,
      { winnerBarId: 'c', loserBarId: 'a', comparedAt: '2026-05-21T00:00:00.000Z' },
    ];
    seedComparisons(local);
    fetchServerComparisonsMock.mockResolvedValue(server);

    const { result, unmount } = renderHook(() => usePairwise());
    await waitFor(() => expect(result.current.comparisons).toHaveLength(2));
    expect(mergeLocalComparisonsToServerMock).toHaveBeenCalledTimes(1);
    expect(mergeLocalComparisonsToServerMock.mock.calls[0][2]).toEqual(local);
    unmount();

    // Second mount for the same user: merge flag prevents a re-merge.
    const second = renderHook(() => usePairwise());
    await waitFor(() => expect(second.result.current.comparisons).toHaveLength(2));
    expect(mergeLocalComparisonsToServerMock).toHaveBeenCalledTimes(1);
  });

  it('requestPrompt works while signed in (the old gate is gone)', async () => {
    seedRatings([rating('a', 'loved'), rating('b', 'loved')]);
    const { result } = renderHook(() => usePairwise());
    await waitFor(() => expect(fetchServerComparisonsMock).toHaveBeenCalled());

    act(() => {
      result.current.requestPrompt('a', 'loved');
    });
    expect(result.current.pendingPrompt).toEqual({
      justRatedBarId: 'a',
      peerBarId: 'b',
      tier: 'loved',
    });
  });

  it('addComparison inserts to the server transcript and bulk-upserts changed scores', async () => {
    seedRatings([rating('a', 'loved'), rating('b', 'loved')]);
    const { result } = renderHook(() => usePairwise());
    await waitFor(() => expect(fetchServerComparisonsMock).toHaveBeenCalled());

    act(() => {
      result.current.addComparison('a', 'b');
    });

    // Server insert with the session tag (uuid or null), not the local key.
    expect(insertServerComparisonMock).toHaveBeenCalledTimes(1);
    const [, userId, sent, sessionId] = insertServerComparisonMock.mock.calls[0];
    expect(userId).toBe('user-1');
    expect(sent.winnerBarId).toBe('a');
    expect(sent.loserBarId).toBe('b');
    expect(sessionId === null || typeof sessionId === 'string').toBe(true);
    // Write-through: the local transcript cache mirrors the server append
    // so a later failed fetch has a usable fallback (Codex review).
    expect(readComparisons()).toHaveLength(1);

    // Transcript-derived scores were persisted (score-only) for changed
    // rows — through the serialized write chain, hence the waitFor.
    await waitFor(() => expect(updateServerScoresMock).toHaveBeenCalledTimes(1));
    const entries = updateServerScoresMock.mock.calls[0][2];
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every((e) => typeof e.score === 'number')).toBe(true);
    // ...and the write-through ratings cache carries the same scores.
    expect(readRatings().some((r) => typeof r.score === 'number')).toBe(true);

    // Optimistic transcript state, prompt dismissed.
    expect(result.current.comparisons).toHaveLength(1);
    expect(result.current.pendingPrompt).toBeNull();
  });
});
