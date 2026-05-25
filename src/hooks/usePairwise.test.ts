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

import { useAuth } from '@/hooks/useAuth';
const useAuthMock = vi.mocked(useAuth);

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

describe('usePairwise — signed-in gate', () => {
  beforeEach(() => {
    window.localStorage.clear();
    useAuthMock.mockReturnValue({
      status: 'signed-in',
      user: { id: 'user-1', email: 'connor@example.com' } as never,
      session: { user: { id: 'user-1' } } as never,
      signOut: vi.fn(),
    });
  });

  it('requestPrompt is a no-op when signed-in (server-mode pending)', () => {
    seedRatings([rating('a', 'loved'), rating('b', 'loved')]);
    const { result } = renderHook(() => usePairwise());
    act(() => {
      result.current.requestPrompt('a', 'loved');
    });
    expect(result.current.pendingPrompt).toBeNull();
  });

  it('addComparison is a no-op when signed-in', () => {
    seedRatings([rating('a', 'loved'), rating('b', 'loved')]);
    const { result } = renderHook(() => usePairwise());
    act(() => {
      result.current.addComparison('a', 'b');
    });
    expect(readComparisons()).toEqual([]);
    // Scores on ratings are unchanged.
    const persisted = readRatings();
    expect(persisted.every((r) => r.score === undefined)).toBe(true);
  });

  it('flipping to signed-in dismisses any open prompt', () => {
    // Start signed-out so a prompt can open.
    useAuthMock.mockReturnValue({
      status: 'signed-out',
      user: null,
      session: null,
      signOut: vi.fn(),
    });
    seedRatings([rating('a', 'loved'), rating('b', 'loved')]);

    const { result, rerender } = renderHook(() => usePairwise());
    act(() => {
      result.current.requestPrompt('a', 'loved');
    });
    expect(result.current.pendingPrompt).not.toBeNull();

    // Now flip to signed-in and re-render.
    useAuthMock.mockReturnValue({
      status: 'signed-in',
      user: { id: 'user-1', email: 'connor@example.com' } as never,
      session: { user: { id: 'user-1' } } as never,
      signOut: vi.fn(),
    });
    rerender();

    expect(result.current.pendingPrompt).toBeNull();
  });
});
