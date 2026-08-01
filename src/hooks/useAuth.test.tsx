import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AuthApiError,
  AuthRetryableFetchError,
  type Session,
} from '@supabase/supabase-js';

/**
 * Cross-device stale-session fix (staging bug 2026-08-01): a browser holding
 * a cached session for a DELETED user must be signed out promptly, because
 * getSession() trusts the cached JWT and never asks the server.
 *
 * These tests pin the shared store's network-validation state machine:
 *   - definitive auth rejection (deleted / revoked)  -> signed out + caches cleared
 *   - transport failure                              -> session KEPT (fail-open)
 *   - N subscribers                                  -> exactly ONE network call
 * The one-shared-operation invariant is the WebKit Web Lock constraint
 * documented in useAuth.ts — never weaken it back to per-consumer requests.
 */

const h = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  getUserMock: vi.fn(),
  clientSignOutMock: vi.fn(),
  onAuthStateChangeMock: vi.fn(),
  clearAccountCacheMock: vi.fn(),
  clearResidualAccountCacheMock: vi.fn(),
}));

vi.mock('@/lib/supabase/client', () => ({
  getBrowserSupabase: () => ({
    auth: {
      getSession: h.getSessionMock,
      getUser: h.getUserMock,
      signOut: h.clientSignOutMock,
      onAuthStateChange: h.onAuthStateChangeMock,
    },
  }),
}));

vi.mock('@/lib/accountCache', () => ({
  clearAccountCache: h.clearAccountCacheMock,
  clearResidualAccountCache: h.clearResidualAccountCacheMock,
}));

import { useAuth, __resetAuthWatchForTests } from './useAuth';

function makeSession(token: string, userId: string): Session {
  return {
    access_token: token,
    refresh_token: `refresh-${token}`,
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    token_type: 'bearer',
    user: { id: userId, aud: 'authenticated' },
  } as unknown as Session;
}

const SESSION_A = makeSession('token-a', 'user-a');

/** GoTrue's answer for a deleted auth user. */
function deletedUserResult() {
  return {
    data: { user: null },
    error: new AuthApiError(
      'User from sub claim in JWT does not exist',
      403,
      'user_not_found',
    ),
  };
}

let authChangeCallback:
  | ((event: string, session: Session | null) => void)
  | null = null;

describe('useAuth cached-session network validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetAuthWatchForTests();
    authChangeCallback = null;
    h.onAuthStateChangeMock.mockImplementation(
      (cb: (event: string, session: Session | null) => void) => {
        authChangeCallback = cb;
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      },
    );
    h.getSessionMock.mockResolvedValue({ data: { session: SESSION_A } });
    h.getUserMock.mockResolvedValue({
      data: { user: SESSION_A.user },
      error: null,
    });
    // Reproduce the REAL SDK contract (santa round-3): GoTrueClient awaits
    // its own SIGNED_OUT listeners BEFORE the signOut() promise resolves, so
    // the store flips mid-await. A bare resolved mock hid a bug where a
    // post-await ownership check skipped the cache wipe on the happy path.
    h.clientSignOutMock.mockImplementation(async () => {
      authChangeCallback?.('SIGNED_OUT', null);
      return { error: null };
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('validates a cached session with exactly ONE getUser call shared by many subscribers', async () => {
    const first = renderHook(() => useAuth());
    const second = renderHook(() => useAuth());
    const third = renderHook(() => useAuth());

    await waitFor(() => {
      expect(first.result.current.status).toBe('signed-in');
      expect(second.result.current.status).toBe('signed-in');
      expect(third.result.current.status).toBe('signed-in');
    });

    // The whole point: N consumers, one session read, one network validation.
    expect(h.getSessionMock).toHaveBeenCalledTimes(1);
    expect(h.getUserMock).toHaveBeenCalledTimes(1);
    expect(h.clientSignOutMock).not.toHaveBeenCalled();
  });

  it('signs out a cached session whose user was DELETED server-side', async () => {
    h.getUserMock.mockResolvedValue(deletedUserResult());

    const { result } = renderHook(() => useAuth());

    await waitFor(() => expect(result.current.status).toBe('signed-out'));
    // Local scope: the server-side revocation/deletion already handled the
    // other devices; this browser only needs its own storage cleared.
    expect(h.clientSignOutMock).toHaveBeenCalledWith({ scope: 'local' });
    // Cache residue of the deleted account must not survive (shared device) —
    // and the wipe must be the UNCONDITIONAL one: pre-hydrate data carries no
    // ownership marker, so the flag-gated residual clear alone would leave it
    // for the next account to merge (santa round-2, Codex).
    expect(h.clearAccountCacheMock).toHaveBeenCalled();
    expect(h.clearResidualAccountCacheMock).toHaveBeenCalled();
  });

  it('signs out a cached session the server says is revoked/expired (401 session_not_found)', async () => {
    h.getUserMock.mockResolvedValue({
      data: { user: null },
      error: new AuthApiError('Session not found', 401, 'session_not_found'),
    });

    const { result } = renderHook(() => useAuth());

    await waitFor(() => expect(result.current.status).toBe('signed-out'));
    expect(h.clientSignOutMock).toHaveBeenCalledWith({ scope: 'local' });
  });

  it('KEEPS the session on a transport failure — the network being down is not a sign-out', async () => {
    h.getUserMock.mockResolvedValue({
      data: { user: null },
      error: new AuthRetryableFetchError('fetch failed', 0),
    });

    const { result } = renderHook(() => useAuth());

    await waitFor(() => expect(h.getUserMock).toHaveBeenCalledTimes(1));
    // Fail-open: the cached session survives; JWT expiry is the backstop.
    expect(result.current.status).toBe('signed-in');
    expect(h.clientSignOutMock).not.toHaveBeenCalled();
  });

  it('KEEPS the session on an unknown error shape (explicit fail-open fallthrough)', async () => {
    h.getUserMock.mockRejectedValue(new Error('something unexpected'));

    const { result } = renderHook(() => useAuth());

    await waitFor(() => expect(h.getUserMock).toHaveBeenCalledTimes(1));
    expect(result.current.status).toBe('signed-in');
    expect(h.clientSignOutMock).not.toHaveBeenCalled();
  });

  it('retries ONCE ~30s after a transport failure and applies a definitive verdict then', async () => {
    vi.useFakeTimers();
    h.getUserMock.mockResolvedValueOnce({
      data: { user: null },
      error: new AuthRetryableFetchError('fetch failed', 0),
    });

    const { result } = renderHook(() => useAuth());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.status).toBe('signed-in');
    expect(h.getUserMock).toHaveBeenCalledTimes(1);

    // The user was deleted while we were offline; the bounded retry finds out.
    h.getUserMock.mockResolvedValue(deletedUserResult());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });

    expect(h.getUserMock).toHaveBeenCalledTimes(2);
    expect(result.current.status).toBe('signed-out');
    expect(h.clientSignOutMock).toHaveBeenCalledWith({ scope: 'local' });
  });

  it('a retry that ALSO fails transport does not loop — no third call without a new trigger', async () => {
    vi.useFakeTimers();
    h.getUserMock.mockResolvedValue({
      data: { user: null },
      error: new AuthRetryableFetchError('fetch failed', 0),
    });

    const { result } = renderHook(() => useAuth());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(h.getUserMock).toHaveBeenCalledTimes(2);

    // Hours pass with no lifecycle trigger: still exactly two calls, still
    // signed in. Bounded means bounded.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4 * 60 * 60 * 1000);
    });
    expect(h.getUserMock).toHaveBeenCalledTimes(2);
    expect(result.current.status).toBe('signed-in');
  });

  it('does NOT touch the network when there is no cached session', async () => {
    h.getSessionMock.mockResolvedValue({ data: { session: null } });

    const { result } = renderHook(() => useAuth());

    await waitFor(() => expect(result.current.status).toBe('signed-out'));
    expect(h.getUserMock).not.toHaveBeenCalled();
  });

  it('revalidates when the tab becomes visible again, at most once per interval', async () => {
    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.status).toBe('signed-in'));
    expect(h.getUserMock).toHaveBeenCalledTimes(1);

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });

    // Immediately after the initial validation: inside the min interval, the
    // visibility ping must NOT spend another network call.
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(h.getUserMock).toHaveBeenCalledTimes(1);

    // Later (past the interval) the account has been deleted elsewhere; the
    // focus revalidation is what signs this browser out.
    const realNow = Date.now();
    const nowSpy = vi
      .spyOn(Date, 'now')
      .mockReturnValue(realNow + 5 * 60_000 + 1_000);
    h.getUserMock.mockResolvedValue(deletedUserResult());

    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    await waitFor(() => expect(result.current.status).toBe('signed-out'));
    expect(h.getUserMock).toHaveBeenCalledTimes(2);
    nowSpy.mockRestore();
  });

  it('a stale INVALID verdict cannot sign out a NEWER session (sign-in during validation)', async () => {
    let resolveGetUser!: (value: unknown) => void;
    h.getUserMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveGetUser = resolve;
      }),
    );

    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.status).toBe('signed-in'));

    // A different account signs in (e.g. another tab) while the validation
    // of the OLD token is still in flight.
    const sessionB = makeSession('token-b', 'user-b');
    act(() => {
      authChangeCallback?.('SIGNED_IN', sessionB);
    });

    await act(async () => {
      resolveGetUser(deletedUserResult());
      await Promise.resolve();
    });

    // The verdict belonged to token-a; session-b must be untouched.
    expect(h.clientSignOutMock).not.toHaveBeenCalled();
    expect(result.current.status).toBe('signed-in');
    expect(result.current.user?.id).toBe('user-b');
  });

  it('a sign-in landing DURING the invalidation sign-out is not clobbered', async () => {
    // Santa round-1 (Claude+Codex convergent): the guard used to be checked
    // only BEFORE the awaited signOut; a session arriving inside that await
    // was then wiped by an unconditional applySession(null).
    h.getUserMock.mockResolvedValue(deletedUserResult());
    let resolveSignOut!: (value: unknown) => void;
    h.clientSignOutMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveSignOut = resolve;
      }),
    );

    const { result } = renderHook(() => useAuth());
    await waitFor(() =>
      expect(h.clientSignOutMock).toHaveBeenCalledWith({ scope: 'local' }),
    );

    // A different account signs in while the local sign-out is in flight.
    const sessionB = makeSession('token-b2', 'user-b2');
    act(() => {
      authChangeCallback?.('SIGNED_IN', sessionB);
    });

    await act(async () => {
      resolveSignOut({ error: null });
      await Promise.resolve();
    });

    // The stale verdict must not flip the store that now belongs to user-b2.
    expect(result.current.status).toBe('signed-in');
    expect(result.current.user?.id).toBe('user-b2');
  });

  it('signOut clears the account cache even when the SDK sign-out throws', async () => {
    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.status).toBe('signed-in'));

    h.clientSignOutMock.mockRejectedValueOnce(new Error('network down'));

    await expect(result.current.signOut()).rejects.toThrow('network down');
    // The wipe must not be skippable by a throw — cross-account contamination
    // on a shared browser is worse than a failed server-side sign-out.
    expect(h.clearAccountCacheMock).toHaveBeenCalled();
  });
});
