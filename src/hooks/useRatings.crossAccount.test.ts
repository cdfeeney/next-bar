/**
 * Regression cover for the cross-account write race in server-mode hydration.
 *
 * `useRatings` hydration is single-flighted across all mounted instances (one
 * per RatingBadge — 975 of them when BarPicker opens). Sharing the run removed
 * the thing that used to cancel its cache writes: each instance's effect
 * cleanup. Without a live-session check, account A's in-flight run could land
 * `writeRatings()` / `writeMergedFlag('user-a')` after the session had already
 * become account B — cross-account cache poisoning on a shared device.
 *
 * The cache epoch alone does NOT catch this: it only moves on a cache wipe, so
 * an A→B switch with no sign-out leaves the epoch untouched.
 */
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BarRating } from '@/types/ratings';

const KEY = 'next-bar:ratings:v1';
const MERGED_KEY = 'next-bar:ratings:merged-for:v1';

type AuthShape = {
  status: 'signed-in' | 'signed-out';
  user: { id: string } | null;
  session: Record<string, unknown> | null;
};

let authState: AuthShape = {
  status: 'signed-in',
  user: { id: 'user-a' },
  session: {},
};
let liveUserId: string | null = 'user-a';

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ ...authState, signOut: vi.fn() }),
  getCurrentAuthUserId: () => liveUserId,
}));

const fetchResolvers: Array<(rows: BarRating[] | null) => void> = [];

vi.mock('@/lib/ratings.server', () => ({
  fetchServerRatings: vi.fn(
    () =>
      new Promise<BarRating[] | null>((resolve) => {
        fetchResolvers.push(resolve);
      }),
  ),
  mergeLocalRatingsToServer: vi.fn(async () => [] as BarRating[]),
  upsertServerRating: vi.fn(),
  deleteServerRating: vi.fn(),
}));

vi.mock('@/lib/supabase/client', () => ({
  getBrowserSupabase: () => ({ __stub: true }),
}));

vi.mock('@/lib/accountCache', () => ({
  getCacheEpoch: () => 1,
  guardAgainstForeignCache: vi.fn(),
  clearAccountCache: vi.fn(),
  clearResidualAccountCache: vi.fn(),
}));

// Imported after the mocks so the hook picks them up.
const { useRatings, __resetRatingsHydrationForTests } = await import('./useRatings');

const ACCOUNT_A_ROWS: BarRating[] = [
  { barId: 'attaboy', rating: 'loved', ratedAt: '2026-07-01T00:00:00.000Z' },
];

describe('useRatings server hydration — account switch mid-flight', () => {
  beforeEach(() => {
    window.localStorage.clear();
    fetchResolvers.length = 0;
    __resetRatingsHydrationForTests();
    authState = { status: 'signed-in', user: { id: 'user-a' }, session: {} };
    liveUserId = 'user-a';
  });

  it("discards account A's hydration once the live session is account B", async () => {
    const { rerender } = renderHook(() => useRatings());
    // A's run is in flight (fetchServerRatings pending).
    expect(fetchResolvers.length).toBeGreaterThan(0);

    // The session becomes account B before A's fetch settles.
    authState = { status: 'signed-in', user: { id: 'user-b' }, session: {} };
    liveUserId = 'user-b';
    rerender();

    // Now A's fetch finally lands.
    fetchResolvers[0](ACCOUNT_A_ROWS);
    await Promise.resolve();
    await Promise.resolve();

    // Neither A's rows nor A's ownership marker may reach the shared cache.
    expect(window.localStorage.getItem(MERGED_KEY)).not.toBe('user-a');
    expect(window.localStorage.getItem(KEY) ?? '').not.toContain('attaboy');
  });

  it("still applies a hydration that completes while its own account is live", async () => {
    renderHook(() => useRatings());
    expect(fetchResolvers.length).toBeGreaterThan(0);

    // No account switch — the run belongs to the live session.
    fetchResolvers[0](ACCOUNT_A_ROWS);
    await Promise.resolve();
    await Promise.resolve();

    expect(window.localStorage.getItem(MERGED_KEY)).toBe('user-a');
    expect(window.localStorage.getItem(KEY) ?? '').toContain('attaboy');
  });
});
