import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * A ROLLOVER THIS HOOK NEVER SAW STILL COUNTS (round-9 panel).
 *
 * The settle-window polling was armed only when a TICK observed the night key
 * change. Mount after the device has already crossed its own 4:00 AM and there
 * is no change to observe: the key is the new night's from the first render,
 * `rolledAt` stays null, and the hook never re-asks. A device ten minutes fast,
 * opened at real 3:55 AM, therefore read the night in progress and went on
 * showing those pins after the server expired them at 4:00 — until a remount.
 *
 * The sibling file pins the OBSERVED rollover. This one pins the arrival that
 * observes nothing, which is the one the panel found.
 */

/** The instant this DEVICE believes the night rolls over. */
const ROLLOVER = Date.parse('2026-08-21T08:00:00.000Z');
const SETTLE_MS = 15 * 60 * 1_000;

let tick: (() => void) | null = null;

vi.mock('@/lib/nightKey', () => ({
  // Argument-honouring, unlike the sibling test's stub: the fix asks what the
  // night key was fifteen minutes ago, and a stub that ignores its Date cannot
  // tell the two answers apart.
  nycNightKey: (at: Date = new Date()) =>
    at.getTime() >= ROLLOVER ? '2026-08-21' : '2026-08-20',
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ status: 'signed-in', user: { id: 'me' } }),
}));

vi.mock('@/lib/supabase/client', () => ({ getBrowserSupabase: () => ({}) }));

const fetchCirclePresence = vi.fn();
vi.mock('@/lib/presence/server', () => ({
  fetchCirclePresence: (...a: unknown[]) => fetchCirclePresence(...a),
  fetchMyPresence: vi.fn(),
}));

vi.mock('@/hooks/useIntent', async () => {
  const { useEffect, useRef } = await import('react');
  return {
    useNightRefresh: (refresh: () => void) => {
      const latest = useRef(refresh);
      latest.current = refresh;
      useEffect(() => {
        tick = () => latest.current();
        latest.current();
        return () => {
          tick = null;
        };
      }, []);
    },
  };
});

import { usePinnedHandles } from './usePinnedHandles';

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  fetchCirclePresence.mockResolvedValue([]);
});

afterEach(() => {
  vi.useRealTimers();
  tick = null;
});

describe('mounting after this device has already rolled over', () => {
  test('keeps asking, though it never observed the key change', async () => {
    // Five minutes past the device's own boundary — the server, ten minutes
    // slower, is still serving the previous night.
    vi.setSystemTime(ROLLOVER + 5 * 60_000);
    renderHook(() => usePinnedHandles());
    // Two, not one: the mount read, plus the tick the shared clock fires on
    // mount, which is already inside the settle window.
    await waitFor(() => expect(fetchCirclePresence).toHaveBeenCalledTimes(2));

    // No key change on this tick, and none on any later one: the whole point.
    act(() => {
      vi.setSystemTime(Date.now() + 60_000);
      tick?.();
    });
    await waitFor(() => expect(fetchCirclePresence).toHaveBeenCalledTimes(3));

    act(() => {
      vi.setSystemTime(Date.now() + 60_000);
      tick?.();
    });
    await waitFor(() => expect(fetchCirclePresence).toHaveBeenCalledTimes(4));
  });

  test('stops once the settle window has passed', async () => {
    vi.setSystemTime(ROLLOVER + 5 * 60_000);
    renderHook(() => usePinnedHandles());
    await waitFor(() => expect(fetchCirclePresence).toHaveBeenCalledTimes(2));

    act(() => {
      vi.setSystemTime(Date.now() + SETTLE_MS + 60_000);
      tick?.();
    });
    act(() => tick?.());
    expect(fetchCirclePresence).toHaveBeenCalledTimes(2);
  });

  test('an ordinary mid-evening mount arms nothing', async () => {
    // Well before the boundary: fifteen minutes ago was the same night, so
    // there is nothing to settle and no reason to poll.
    vi.setSystemTime(ROLLOVER - 3 * 60 * 60 * 1_000);
    renderHook(() => usePinnedHandles());
    await waitFor(() => expect(fetchCirclePresence).toHaveBeenCalledTimes(1));

    act(() => {
      vi.setSystemTime(Date.now() + 60_000);
      tick?.();
    });
    act(() => tick?.());
    expect(fetchCirclePresence).toHaveBeenCalledTimes(1);
  });
});
