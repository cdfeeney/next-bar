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
  beforeEach(() => {
    window.localStorage.clear();
    authChangeHandler = null;
    sessionResult = { data: { session: null } };
  });

  it('an existing session for a DIFFERENT user wipes the foreign cache on mount', async () => {
    // User A's residue, personal keys included.
    window.localStorage.setItem(OWNER_KEY, 'user-a');
    window.localStorage.setItem(RATINGS_KEY, '[{"barId":"attaboy"}]');
    window.localStorage.setItem(LISTS_KEY, '[{"id":"faves"}]');
    sessionResult = { data: { session: sessionFor('user-b') } };

    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.status).toBe('signed-in'));

    expect(window.localStorage.getItem(RATINGS_KEY)).toBeNull();
    expect(window.localStorage.getItem(LISTS_KEY)).toBeNull();
  });

  it('a sign-in completing via onAuthStateChange wipes a foreign cache too', async () => {
    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.status).toBe('signed-out'));

    window.localStorage.setItem(OWNER_KEY, 'user-a');
    window.localStorage.setItem(LISTS_KEY, '[{"id":"faves"}]');

    authChangeHandler?.('SIGNED_IN', sessionFor('user-b'));
    await waitFor(() => expect(result.current.status).toBe('signed-in'));

    expect(window.localStorage.getItem(LISTS_KEY)).toBeNull();
  });

  it('the same user signing back in keeps their own cache', async () => {
    window.localStorage.setItem(OWNER_KEY, 'user-a');
    window.localStorage.setItem(RATINGS_KEY, '[{"barId":"attaboy"}]');
    window.localStorage.setItem(LISTS_KEY, '[{"id":"faves"}]');
    sessionResult = { data: { session: sessionFor('user-a') } };

    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.status).toBe('signed-in'));

    expect(window.localStorage.getItem(RATINGS_KEY)).not.toBeNull();
    expect(window.localStorage.getItem(LISTS_KEY)).not.toBeNull();
  });

  it('an anonymous cache (no ownership signal) is left for the first-sign-in merge', async () => {
    window.localStorage.setItem(RATINGS_KEY, '[{"barId":"attaboy"}]');
    sessionResult = { data: { session: sessionFor('user-b') } };

    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.status).toBe('signed-in'));

    expect(window.localStorage.getItem(RATINGS_KEY)).not.toBeNull();
  });
});
