import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Contract test for the SERVER cookie adapter.
 *
 * WHY THIS EXISTS (santa round 1 on g-3fc3789d, Codex MEDIUM). Every route test
 * mocks `@/lib/supabase/server` wholesale, so the adapter below was never
 * executed by anything. Making `cookieStore.set` a no-op left the entire suite
 * green while `/auth/confirm` would redirect a successfully-verified user to
 * `/settings` with no session — the exact cross-context failure that route was
 * written to fix, reintroduced silently one layer down.
 *
 * So this file mocks only the BOUNDARIES (`next/headers` and `@supabase/ssr`)
 * and exercises the real closures in `server.ts`. Nothing here contacts
 * Supabase: `createServerClient` is stubbed and never issues a request.
 */

vi.mock('next/headers', () => ({ cookies: vi.fn() }));
vi.mock('@supabase/ssr', () => ({ createServerClient: vi.fn(() => ({ __stub: true })) }));

import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { getServerSupabase } from './server';

type CookieAdapter = {
  get(name: string): string | undefined;
  set(name: string, value: string, options: Record<string, unknown>): void;
  remove(name: string, options: Record<string, unknown>): void;
};

const cookiesMock = vi.mocked(cookies);
const createServerClientMock = vi.mocked(createServerClient);

/** Stands in for Next's request cookie store. */
function makeCookieStore(initial: Record<string, string> = {}) {
  return {
    get: vi.fn((name: string) =>
      name in initial ? { name, value: initial[name] } : undefined,
    ),
    set: vi.fn(),
  };
}

/** Runs getServerSupabase() and hands back the adapter it registered. */
function captureAdapter(store: ReturnType<typeof makeCookieStore>): CookieAdapter {
  cookiesMock.mockReturnValue(store as unknown as ReturnType<typeof cookies>);
  const client = getServerSupabase();
  expect(client).not.toBeNull();

  // Through `unknown`: @supabase/ssr types `cookies` as the CookieMethodsServer
  // union (get/set/remove OR getAll/setAll). server.ts supplies the former, so
  // narrowing to it here is a test-local assertion, not a claim about the union.
  const options = createServerClientMock.mock.calls[0]?.[2] as unknown as
    | { cookies: CookieAdapter }
    | undefined;
  expect(options?.cookies).toBeDefined();
  return options!.cookies;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://stub-project.supabase.co');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'stub-anon-key-not-a-credential');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('getServerSupabase — configuration gate', () => {
  it('returns null when the env vars are missing, without constructing a client', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', '');

    expect(getServerSupabase()).toBeNull();
    expect(createServerClientMock).not.toHaveBeenCalled();
  });

  it('passes the configured url and key through to createServerClient', () => {
    captureAdapter(makeCookieStore());

    expect(createServerClientMock.mock.calls[0]?.[0]).toBe(
      'https://stub-project.supabase.co',
    );
    expect(createServerClientMock.mock.calls[0]?.[1]).toBe(
      'stub-anon-key-not-a-credential',
    );
  });
});

describe('getServerSupabase — cookie adapter delegates to the request store', () => {
  it('reads an existing cookie value', () => {
    const store = makeCookieStore({ 'sb-stub-auth-token': 'session-value' });
    const adapter = captureAdapter(store);

    expect(adapter.get('sb-stub-auth-token')).toBe('session-value');
  });

  it('returns undefined for a cookie that is not set', () => {
    const adapter = captureAdapter(makeCookieStore());

    expect(adapter.get('sb-stub-auth-token')).toBeUndefined();
  });

  /**
   * The load-bearing one. `/auth/confirm` awaits `verifyOtp` specifically so
   * this write lands on the redirect response; if it stops reaching the store,
   * the user arrives signed out. Asserts the exact payload, so dropping the
   * options (Max-Age/Path/HttpOnly/SameSite) fails too — a session cookie
   * written without them would not survive the redirect the way it must.
   */
  it('writes a session cookie through to the store with its options intact', () => {
    const store = makeCookieStore();
    const adapter = captureAdapter(store);

    adapter.set('sb-stub-auth-token', 'new-session', {
      path: '/',
      maxAge: 3600,
      httpOnly: true,
      sameSite: 'lax',
    });

    expect(store.set).toHaveBeenCalledTimes(1);
    expect(store.set).toHaveBeenCalledWith({
      name: 'sb-stub-auth-token',
      value: 'new-session',
      path: '/',
      maxAge: 3600,
      httpOnly: true,
      sameSite: 'lax',
    });
  });

  it('clears a cookie by writing an empty value with its options', () => {
    const store = makeCookieStore();
    const adapter = captureAdapter(store);

    adapter.remove('sb-stub-auth-token', { path: '/' });

    expect(store.set).toHaveBeenCalledWith({
      name: 'sb-stub-auth-token',
      value: '',
      path: '/',
    });
  });

  /**
   * The try/catch in `server.ts` exists because Set-Cookie from a Server
   * Component is a no-op in Next 14. It must stay a SWALLOW, not a crash —
   * but only for that case. Pinning it here keeps the catch honest: if it were
   * ever widened to hide a real Route Handler failure, the assertions above
   * would still hold, so this test pairs with them rather than replacing them.
   */
  it('does not throw when the store rejects the write', () => {
    const store = makeCookieStore();
    store.set.mockImplementation(() => {
      throw new Error('Cookies can only be modified in a Server Action or Route Handler');
    });
    const adapter = captureAdapter(store);

    expect(() => adapter.set('sb-stub-auth-token', 'v', { path: '/' })).not.toThrow();
    expect(() => adapter.remove('sb-stub-auth-token', { path: '/' })).not.toThrow();
  });
});
