import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePinnedHandles } from './usePinnedHandles';
import type { CirclePresence } from '@/lib/presence';

/**
 * The property under test is the THREE-STATE read, because collapsing two of
 * them is the bug that lies to the user:
 *
 *   loading   → we do not know yet
 *   rows: []  → nobody is out
 *   rows: null→ the read failed
 *
 * Rendering "no friends out yet" because a request failed tells someone their
 * friends are staying in. Every case below pins one of those apart from the
 * others, plus the 4:00 AM night scoping the whole feature rests on.
 */

vi.mock('@/hooks/useAuth', () => ({
  useAuth: vi.fn(() => ({
    status: 'signed-in',
    user: { id: 'me' },
    session: {},
    signOut: vi.fn(),
  })),
}));

vi.mock('@/lib/supabase/client', () => ({
  getBrowserSupabase: vi.fn(() => ({}) as unknown),
}));

vi.mock('@/lib/presence/server', () => ({
  fetchCirclePresence: vi.fn(),
}));

// The night-refresh signal is a 60s interval plus a visibilitychange listener
// in the real hook. Here it fires once after mount — IN AN EFFECT, exactly as
// the real one does. Firing it during render instead is not a shortcut: the
// callback calls setState, and a render-phase update loops.
vi.mock('@/hooks/useIntent', async () => {
  const { useEffect } = await import('react');
  return {
    useNightRefresh: (refresh: () => void) => {
      useEffect(() => {
        refresh();
        // Mount-only, matching the real hook's empty dependency list.
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, []);
    },
  };
});

import { useAuth } from '@/hooks/useAuth';
import { getBrowserSupabase } from '@/lib/supabase/client';
import { fetchCirclePresence } from '@/lib/presence/server';

const ROW: CirclePresence = {
  handle: 'ana',
  displayName: 'Ana',
  status: 'going',
  barId: 'attaboy',
  updatedAt: '2026-07-25T02:00:00Z',
};

function signedIn(): void {
  vi.mocked(useAuth).mockReturnValue({
    status: 'signed-in',
    user: { id: 'me' },
    session: {},
    signOut: vi.fn(),
  } as unknown as ReturnType<typeof useAuth>);
}

beforeEach(() => {
  vi.mocked(getBrowserSupabase).mockReturnValue({} as never);
  vi.mocked(fetchCirclePresence).mockResolvedValue([]);
  signedIn();
});

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe('usePinnedHandles', () => {
  it('reports who is out tonight once the read lands', async () => {
    vi.mocked(fetchCirclePresence).mockResolvedValue([ROW]);
    const { result } = renderHook(() => usePinnedHandles());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.rows).toEqual([ROW]);
  });

  it('reports an empty circle as [] — nobody is out', async () => {
    vi.mocked(fetchCirclePresence).mockResolvedValue([]);
    const { result } = renderHook(() => usePinnedHandles());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.rows).toEqual([]);
  });

  it('reports a FAILED read as null, never as an empty circle', async () => {
    // The distinction that matters. fetchCirclePresence returns null on a
    // transport or RLS error; passing that through unchanged is what lets the
    // surface say "couldn't load" instead of "nobody is out".
    vi.mocked(fetchCirclePresence).mockResolvedValue(null);
    const { result } = renderHook(() => usePinnedHandles());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.rows).toBeNull();
    expect(result.current.rows).not.toEqual([]);
  });

  it('treats an unconfigured Supabase client as a failed read, not an empty one', async () => {
    vi.mocked(getBrowserSupabase).mockReturnValue(null as never);
    const { result } = renderHook(() => usePinnedHandles());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.rows).toBeNull();
    expect(fetchCirclePresence).not.toHaveBeenCalled();
  });

  it('asks for nothing while auth is still resolving', async () => {
    vi.mocked(useAuth).mockReturnValue({
      status: 'loading',
      user: null,
      session: null,
      signOut: vi.fn(),
    } as unknown as ReturnType<typeof useAuth>);
    const { result } = renderHook(() => usePinnedHandles());

    expect(result.current.loading).toBe(true);
    expect(fetchCirclePresence).not.toHaveBeenCalled();
  });

  it('signed out is an empty circle, not a failure: there is nobody to ask about', async () => {
    vi.mocked(useAuth).mockReturnValue({
      status: 'signed-out',
      user: null,
      session: null,
      signOut: vi.fn(),
    } as unknown as ReturnType<typeof useAuth>);
    const { result } = renderHook(() => usePinnedHandles());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.rows).toEqual([]);
    expect(fetchCirclePresence).not.toHaveBeenCalled();
  });

  it('scopes rows to the night that ends at 4:00 AM America/New_York', async () => {
    // 2026-07-25T07:59:00Z is 3:59 AM EDT — still Friday night. One minute
    // later the key is Saturday. The hook reports the night it is showing, so
    // a surface can never render last night's rows under tonight's heading.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-25T07:59:00Z'));
    const before = renderHook(() => usePinnedHandles());
    expect(before.result.current.night).toBe('2026-07-24');

    vi.setSystemTime(new Date('2026-07-25T08:00:00Z'));
    const after = renderHook(() => usePinnedHandles());
    expect(after.result.current.night).toBe('2026-07-25');
  });

  it('re-reads on demand, so the list reflects a pin the viewer just set', async () => {
    vi.mocked(fetchCirclePresence).mockResolvedValue([]);
    const { result } = renderHook(() => usePinnedHandles());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetchCirclePresence).toHaveBeenCalledTimes(1);

    vi.mocked(fetchCirclePresence).mockResolvedValue([ROW]);
    result.current.refresh();

    await waitFor(() => expect(result.current.rows).toEqual([ROW]));
    expect(fetchCirclePresence).toHaveBeenCalledTimes(2);
  });
});
