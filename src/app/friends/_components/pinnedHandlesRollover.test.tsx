import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * THE 4:00 AM ROLLOVER IS THIS DEVICE'S GUESS AT THE SERVER'S (round-7 panel,
 * Codex, MEDIUM).
 *
 * The circle re-read was keyed on the night key CHANGING, and a key changes
 * once. With the device clock running fast the key flipped before the server's
 * own boundary; that single re-read returned rows the server was still serving
 * for the night in progress; and nothing asked again. When the server did roll
 * over and those rows expired, the panel went on showing friend pins that no
 * longer existed — for the rest of the session.
 *
 * Both the key and the tick are driven directly here. The property under test
 * is WHEN the hook re-asks, and a test that waits on a real 60-second interval
 * and a real 4 AM cannot express it.
 */

let nightKey = '2026-08-20';
let tick: (() => void) | null = null;

vi.mock('@/lib/nightKey', () => ({ nycNightKey: () => nightKey }));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ status: 'signed-in', user: { id: 'me' } }),
}));

vi.mock('@/lib/supabase/client', () => ({ getBrowserSupabase: () => ({}) }));

const fetchCirclePresence = vi.fn();
vi.mock('@/lib/presence/server', () => ({
  fetchCirclePresence: (...a: unknown[]) => fetchCirclePresence(...a),
  fetchMyPresence: vi.fn(),
}));

// The real hook runs the callback once on mount and then on a 60s interval.
// Here the interval is a handle the test pumps.
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

const SETTLE_MS = 15 * 60 * 1_000;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(Date.parse('2026-08-21T07:55:00.000Z'));
  nightKey = '2026-08-20';
  fetchCirclePresence.mockResolvedValue([]);
});

afterEach(() => {
  vi.useRealTimers();
  tick = null;
});

describe('the circle read survives the server’s own night rollover', () => {
  test('keeps asking for a bounded window after this device rolls over', async () => {
    renderHook(() => usePinnedHandles());
    await waitFor(() => expect(fetchCirclePresence).toHaveBeenCalledTimes(1));

    // A tick with no rollover is not a reason to re-ask.
    act(() => tick?.());
    expect(fetchCirclePresence).toHaveBeenCalledTimes(1);

    // This device crosses 4:00 AM. The server may not have yet.
    nightKey = '2026-08-21';
    act(() => tick?.());
    await waitFor(() => expect(fetchCirclePresence).toHaveBeenCalledTimes(2));

    // THE PART THAT WAS MISSING: the key does not change again, and the read
    // still has to catch the server's own boundary.
    act(() => {
      vi.setSystemTime(Date.now() + 60_000);
      tick?.();
    });
    await waitFor(() => expect(fetchCirclePresence).toHaveBeenCalledTimes(3));
  });

  test('stops asking once the settle window has passed', async () => {
    renderHook(() => usePinnedHandles());
    await waitFor(() => expect(fetchCirclePresence).toHaveBeenCalledTimes(1));

    nightKey = '2026-08-21';
    act(() => tick?.());
    await waitFor(() => expect(fetchCirclePresence).toHaveBeenCalledTimes(2));

    // Well past the window: the two clocks are not going to reconcile, and a
    // permanent minute-by-minute poll is not the answer.
    act(() => {
      vi.setSystemTime(Date.now() + SETTLE_MS + 60_000);
      tick?.();
    });
    act(() => tick?.());
    expect(fetchCirclePresence).toHaveBeenCalledTimes(2);
  });
});
