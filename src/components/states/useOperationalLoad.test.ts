import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  SILENT_AUTO_RETRY_CAP,
  shouldAutoRetry,
  useOperationalLoad,
} from './useOperationalLoad';

/**
 * V8-R-OPS-007 — "capped at 3 silent auto-retries, then manual", and "content
 * stays visible with a stale-data label" rather than being blanked.
 *
 * The cap is counted here rather than asserted as a constant: a policy nobody
 * measures is how "retry forever" and "give up immediately" both got shipped
 * as the same requirement elsewhere.
 */

describe('the silent-retry boundary', () => {
  it('is three, and stops there', () => {
    expect(SILENT_AUTO_RETRY_CAP).toBe(3);
    expect(shouldAutoRetry(0)).toBe(true);
    expect(shouldAutoRetry(2)).toBe(true);
    expect(shouldAutoRetry(3)).toBe(false);
    expect(shouldAutoRetry(9)).toBe(false);
  });
});

describe('a load that keeps failing', () => {
  it('retries silently exactly three times, then asks the user', async () => {
    const load = vi.fn(async () => null);
    const { result } = renderHook(() => useOperationalLoad(load));

    await waitFor(() => expect(result.current.needsManualRetry).toBe(true));

    // One first attempt plus the three the requirement allows.
    expect(load).toHaveBeenCalledTimes(1 + SILENT_AUTO_RETRY_CAP);
    expect(result.current.state).toBe('failed');
  });

  it('stays in loading — never "failed" — while the silent budget is unspent', async () => {
    let settle: ((value: string | null) => void) | undefined;
    const load = vi.fn(
      () =>
        new Promise<string | null>((resolve) => {
          settle = resolve;
        }),
    );
    const { result } = renderHook(() => useOperationalLoad(load));

    settle?.(null);
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    expect(result.current.state).toBe('loading');
    expect(result.current.needsManualRetry).toBe(false);
  });

  it('a manual retry restores the silent budget', async () => {
    const load = vi.fn(async () => null);
    const { result } = renderHook(() => useOperationalLoad(load));

    await waitFor(() => expect(result.current.needsManualRetry).toBe(true));
    const before = load.mock.calls.length;

    act(() => result.current.retry());

    // The budget is counted from the calls the retry causes, not from
    // `needsManualRetry`: that flag is still true the instant retry() is
    // called, so waiting on it would pass before anything had happened.
    await waitFor(() =>
      expect(load.mock.calls.length - before).toBe(1 + SILENT_AUTO_RETRY_CAP),
    );
    expect(result.current.needsManualRetry).toBe(true);
  });
});

describe('saved data is never blanked', () => {
  it('reports STALE, not failed, once a value has loaded and a refresh fails', async () => {
    let calls = 0;
    const load = vi.fn(async () => {
      calls += 1;
      return calls === 1 ? 'the saved list' : null;
    });
    const { result } = renderHook(() => useOperationalLoad(load));

    await waitFor(() => expect(result.current.value).toBe('the saved list'));
    expect(result.current.state).toBeNull();

    act(() => result.current.retry());

    await waitFor(() => expect(result.current.state).toBe('stale'));
    // The whole point: the content is still there to render under the label.
    expect(result.current.value).toBe('the saved list');
  });
});

describe('a load that works', () => {
  it('reports no operational state at all', async () => {
    const load = vi.fn(async () => ['a', 'b']);
    const { result } = renderHook(() => useOperationalLoad(load));

    await waitFor(() => expect(result.current.state).toBeNull());
    expect(result.current.value).toEqual(['a', 'b']);
    expect(result.current.failures).toBe(0);
    expect(load).toHaveBeenCalledTimes(1);
  });
});
