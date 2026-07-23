import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useIntent, useNightRefresh } from './useIntent';

const KEY = 'next-bar:intent:v1';

// Local-time strings (no Z) so assertions don't depend on the runner's TZ.
const FRI_10PM = new Date('2026-07-24T22:00:00');
const SAT_9PM = new Date('2026-07-25T21:00:00');

function seedStoredIntent(setAt: string): void {
  window.localStorage.setItem(
    KEY,
    JSON.stringify({ status: 'going', setAt }),
  );
}

beforeEach(() => {
  window.localStorage.clear();
  vi.useFakeTimers();
  vi.setSystemTime(FRI_10PM);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useIntent', () => {
  it('hydrates from existing storage after mount', () => {
    seedStoredIntent('2026-07-24T21:00:00');
    const { result } = renderHook(() => useIntent());
    expect(result.current.intent?.status).toBe('going');
  });

  it('toggles set and clear within the same night', () => {
    const { result } = renderHook(() => useIntent());

    act(() => result.current.toggleIntent('going'));
    expect(result.current.intent?.status).toBe('going');

    // A different status replaces, not clears.
    act(() => result.current.toggleIntent('maybe'));
    expect(result.current.intent?.status).toBe('maybe');

    // Tapping the active status clears.
    act(() => result.current.toggleIntent('maybe'));
    expect(result.current.intent).toBeNull();
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it('visually clears a stale intent when the 5am rollover passes while the tab stays open (F5a)', () => {
    seedStoredIntent('2026-07-24T22:00:00');
    const { result } = renderHook(() => useIntent());
    expect(result.current.intent?.status).toBe('going');

    act(() => {
      vi.setSystemTime(SAT_9PM);
      vi.advanceTimersByTime(60_000); // one refresh tick
    });
    expect(result.current.intent).toBeNull();
  });

  it('re-evaluates when the tab becomes visible again (F5a)', () => {
    seedStoredIntent('2026-07-24T22:00:00');
    const { result } = renderHook(() => useIntent());
    expect(result.current.intent?.status).toBe('going');

    act(() => {
      vi.setSystemTime(SAT_9PM);
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(result.current.intent).toBeNull();
  });

  it('tapping a still-lit chip after rollover CLEARS instead of setting a fresh intent (F5b)', () => {
    seedStoredIntent('2026-07-24T22:00:00');
    const { result } = renderHook(() => useIntent());
    expect(result.current.intent?.status).toBe('going');

    // The night rolls over but no refresh tick has fired yet — the chip is
    // still lit. The old load-then-decide flow saw null (expired) and SET a
    // fresh intent here; the toggle must honor the displayed state.
    vi.setSystemTime(SAT_9PM);
    act(() => result.current.toggleIntent('going'));

    expect(result.current.intent).toBeNull();
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });
});

describe('useNightRefresh', () => {
  it('fires after mount, on the interval, and on tab-visible', () => {
    const refresh = vi.fn();
    renderHook(() => useNightRefresh(refresh));
    expect(refresh).toHaveBeenCalledTimes(1); // mount

    act(() => vi.advanceTimersByTime(60_000));
    expect(refresh).toHaveBeenCalledTimes(2); // interval

    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(refresh).toHaveBeenCalledTimes(3); // visibility
  });

  it('stops firing after unmount', () => {
    const refresh = vi.fn();
    const { unmount } = renderHook(() => useNightRefresh(refresh));
    unmount();
    act(() => {
      vi.advanceTimersByTime(60_000 * 5);
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(refresh).toHaveBeenCalledTimes(1); // mount call only
  });
});
