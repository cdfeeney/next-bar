import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuth } from './useAuth';

/**
 * The foreign-cache guard belongs to the sign-in LIFECYCLE (V8-2 final
 * panel, Codex): before this test existed it ran only from data hooks, so a
 * deep-linked first mount on a page without useRatings rendered the previous
 * account's personal keys unguarded. useAuth is the one place every sign-in
 * transition passes through — pin the guard there.
 */

const OWNER_KEY = 'next-bar:account:owner:v1';
const LISTS_KEY = 'next-bar:lists:v1';
const RATINGS_KEY = 'next-bar:ratings:v1';

type AuthChangeHandler = (event: string, session: unknown) => void;

let authChangeHandler: AuthChangeHandler | null = null;
let sessionResult: { data: { session: unknown } } = { data: { session: null } };

function sessionFor(userId: string) {
  return { user: { id: userId, email: 'x@example.com' } };
}

vi.mock('@/lib/supabase/client', () => ({
  getBrowserSupabase: vi.fn(() => ({
    auth: {
      getSession: () => Promise.resolve(sessionResult),
      onAuthStateChange: (handler: AuthChangeHandler) => {
        authChangeHandler = handler;
        return { data: { subscription: { unsubscribe: () => {} } } };
      },
      signOut: () => Promise.resolve(),
    },
  })),
}));

describe('useAuth sign-in lifecycle guard', () => {
  const reloadSpy = vi.fn();

  beforeEach(() => {
    window.localStorage.clear();
    authChangeHandler = null;
    sessionResult = { data: { session: null } };
    reloadSpy.mockClear();
    // jsdom's location.reload is non-configurable on the instance — replace
    // the whole location object so the wipe→reload path is observable.
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, reload: reloadSpy },
    });
  });

  it('an existing session for a DIFFERENT user wipes the foreign cache and hard-reloads', async () => {
    // User A's residue, personal keys included. The reload (not setState) is
    // the contract: storage is wiped but an already-mounted surface still
    // holds A's data in React state — only a clean slate removes it
    // (new-cycle panel, Codex + Claude corroborated).
    window.localStorage.setItem(OWNER_KEY, 'user-a');
    window.localStorage.setItem(RATINGS_KEY, '[{"barId":"attaboy"}]');
    window.localStorage.setItem(LISTS_KEY, '[{"id":"faves"}]');
    sessionResult = { data: { session: sessionFor('user-b') } };

    renderHook(() => useAuth());
    await waitFor(() => expect(reloadSpy).toHaveBeenCalled());

    expect(window.localStorage.getItem(RATINGS_KEY)).toBeNull();
    expect(window.localStorage.getItem(LISTS_KEY)).toBeNull();
  });

  it('a sign-in completing via onAuthStateChange wipes a foreign cache and reloads too', async () => {
    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.status).toBe('signed-out'));

    window.localStorage.setItem(OWNER_KEY, 'user-a');
    window.localStorage.setItem(LISTS_KEY, '[{"id":"faves"}]');

    authChangeHandler?.('SIGNED_IN', sessionFor('user-b'));
    await waitFor(() => expect(reloadSpy).toHaveBeenCalled());

    expect(window.localStorage.getItem(LISTS_KEY)).toBeNull();
  });

  it('the same user signing back in keeps their cache, no reload', async () => {
    window.localStorage.setItem(OWNER_KEY, 'user-a');
    window.localStorage.setItem(RATINGS_KEY, '[{"barId":"attaboy"}]');
    window.localStorage.setItem(LISTS_KEY, '[{"id":"faves"}]');
    sessionResult = { data: { session: sessionFor('user-a') } };

    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.status).toBe('signed-in'));

    expect(reloadSpy).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(RATINGS_KEY)).not.toBeNull();
    expect(window.localStorage.getItem(LISTS_KEY)).not.toBeNull();
  });

  it('an anonymous cache is left for the first-sign-in merge, and the lifecycle CLAIMS ownership', async () => {
    // The claim is the other half of the fix (new-cycle panel, Codex):
    // without it, personal keys written by non-ratings surfaces stayed
    // ownerless, the seal no-oped, and the next account inherited them.
    window.localStorage.setItem(RATINGS_KEY, '[{"barId":"attaboy"}]');
    sessionResult = { data: { session: sessionFor('user-b') } };

    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.status).toBe('signed-in'));

    expect(window.localStorage.getItem(RATINGS_KEY)).not.toBeNull();
    expect(window.localStorage.getItem(OWNER_KEY)).toBe('user-b');
  });
});
