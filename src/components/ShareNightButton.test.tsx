/**
 * ShareNightButton — the double-tap single-fire guard (social audit
 * g-0182f313 #6). Two taps landing in the same tick both read the
 * pre-render state ('idle'), so a state-based guard alone fires
 * shareNight twice; the inFlight ref must reduce them to ONE call.
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Recap } from '@/lib/recap';
import ShareNightButton from './ShareNightButton';

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ status: 'signed-in', user: { id: 'u-1' } }),
}));
vi.mock('@/lib/supabase/client', () => ({
  getBrowserSupabase: () => ({}) as unknown,
}));
vi.mock('@/lib/profile.server', () => ({
  fetchOwnProfile: vi.fn(async () => ({ handle: 'tester', displayName: 'Tester' })),
}));
const shareNightMock = vi.fn(
  async () => new Promise<string>((resolve) => setTimeout(() => resolve('tok-1'), 25)),
);
vi.mock('@/lib/nights.server', () => ({
  shareNight: () => shareNightMock(),
}));
vi.mock('@/lib/accountCache', () => ({
  getCacheEpoch: () => 1,
}));
vi.mock('@/lib/sharedNightsLocal', () => ({
  recordSharedNight: vi.fn(),
}));
vi.mock('@/lib/analytics', () => ({
  trackEvent: vi.fn(),
}));

const recap: Recap = {
  nightKey: '2026-08-02',
  bars: [
    { id: 'bar-1', name: 'Attaboy' } as unknown as Recap['bars'][number],
  ],
  loved: null,
  liked: [],
  passed: [],
} as unknown as Recap;

describe('ShareNightButton re-entrancy', () => {
  beforeEach(() => {
    shareNightMock.mockClear();
    // navigator.share path: resolve immediately so the flow completes.
    Object.defineProperty(window.navigator, 'share', {
      value: vi.fn(async () => undefined),
      configurable: true,
      writable: true,
    });
  });
  afterEach(() => {
    cleanup();
  });

  it('two same-tick taps fire shareNight exactly once', async () => {
    render(<ShareNightButton recap={recap} />);
    const button = await screen.findByRole('button', { name: /share/i });

    // Same-tick double tap: neither click yields to React between them,
    // so both closures see state === 'idle' — only the ref can dedupe.
    button.click();
    button.click();

    // Generous timeout: the full suite runs many jsdom environments in
    // parallel and the default 1s waitFor can starve under that load.
    await waitFor(() => expect(shareNightMock).toHaveBeenCalled(), { timeout: 10_000 });
    // Give any erroneous second call time to land before asserting.
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(shareNightMock).toHaveBeenCalledTimes(1);
  });
});
