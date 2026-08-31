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

/**
 * The night key AT A GIVEN INSTANT, for the second describe block below.
 *
 * The no-argument call is "what night is it now", which these tests drive by
 * assigning `nightKey` directly. The hook also asks what the key was fifteen
 * minutes ago, and a stub that ignored its Date could not tell the two answers
 * apart — so the mount-rollover case below would have been untestable and the
 * defect invisible. The default keeps the original behaviour exactly: the same
 * key whenever it is asked, which is a device that has not just rolled over.
 */
let keyAt: (at: Date) => string = () => nightKey;

vi.mock('@/lib/nightKey', () => ({
  nycNightKey: (at?: Date) => (at === undefined ? nightKey : keyAt(at)),
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
  keyAt = () => nightKey;
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

/**
 * A ROLLOVER THIS HOOK NEVER SAW STILL COUNTS (round-9 panel).
 *
 * The block above pins the OBSERVED rollover — the key changes while the hook
 * is mounted. Arming only on that misses the commonest arrival of all: mounting
 * when the device has ALREADY rolled over, where there is no change to observe.
 * The key is simply the new night's from the first render, `rolledAt` stayed
 * null, and the hook never re-asked — so a device ten minutes fast, opened at
 * real 3:55 AM, read the night in progress and went on showing those pins after
 * the server expired them at 4:00, until a remount.
 *
 * The window is a property of WHERE THE CLOCK IS, not of what this instance
 * happened to watch, which is why the mock above has to answer for an instant.
 */
describe('mounting after this device has already rolled over', () => {
  /** The instant this DEVICE believes the night rolls over. */
  const ROLLOVER = Date.parse('2026-08-21T08:00:00.000Z');

  beforeEach(() => {
    nightKey = '2026-08-21';
    keyAt = (at: Date) => (at.getTime() >= ROLLOVER ? '2026-08-21' : '2026-08-20');
  });

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
    nightKey = '2026-08-20';
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
