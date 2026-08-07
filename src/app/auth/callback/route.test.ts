import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthApiError, AuthPKCECodeVerifierMissingError } from '@supabase/supabase-js';

vi.mock('@/lib/supabase/server', () => ({ getServerSupabase: vi.fn() }));

import { getServerSupabase } from '@/lib/supabase/server';
import { CALLBACK_ERROR } from '@/lib/authCallbackErrors';
import { GET } from './route';

const getServerSupabaseMock = vi.mocked(getServerSupabase);

/**
 * The legacy PKCE callback stays in place for links already in flight. What
 * changed: it redirects with a STABLE SENTINEL instead of
 * `encodeURIComponent(error.message)`, so user-visible URLs no longer carry
 * SDK prose and the client's classification no longer depends on English
 * wording upstream can reword.
 */

function stubClient(result: { error: unknown } = { error: null }): ReturnType<typeof vi.fn> {
  const exchangeCodeForSession = vi.fn().mockResolvedValue(result);
  getServerSupabaseMock.mockReturnValue({
    auth: { exchangeCodeForSession },
  } as unknown as ReturnType<typeof getServerSupabase>);
  return exchangeCodeForSession;
}

function request(query: string): Parameters<typeof GET>[0] {
  return new Request(`https://app.test/auth/callback${query}`) as Parameters<typeof GET>[0];
}

function locationOf(response: { headers: Headers }): string {
  return response.headers.get('location') ?? '';
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('/auth/callback — the cross-context PKCE failure', () => {
  it('redirects with the pkce sentinel, not the raw SDK message', async () => {
    stubClient({ error: new AuthPKCECodeVerifierMissingError() });
    const response = await GET(request('?code=abc'));

    expect(locationOf(response)).toBe(
      `https://app.test/auth?error=${CALLBACK_ERROR.pkceMismatch}`,
    );
    // The old behaviour put this prose in the URL bar.
    expect(locationOf(response)).not.toContain('code%20verifier');
    expect(locationOf(response)).not.toContain('storage');
  });
});

describe('/auth/callback — sentinels', () => {
  it('reports a missing code', async () => {
    stubClient();
    const response = await GET(request(''));

    expect(locationOf(response)).toBe(
      `https://app.test/auth?error=${CALLBACK_ERROR.missingCode}`,
    );
  });

  it('reports an unconfigured server', async () => {
    getServerSupabaseMock.mockReturnValue(null);
    const response = await GET(request('?code=abc'));

    expect(locationOf(response)).toBe(
      `https://app.test/auth?error=${CALLBACK_ERROR.unconfigured}`,
    );
  });

  it('maps an expired link to the otp sentinel', async () => {
    stubClient({ error: new AuthApiError('Email link is invalid or has expired', 401, undefined) });
    const response = await GET(request('?code=abc'));

    expect(locationOf(response)).toBe(
      `https://app.test/auth?error=${CALLBACK_ERROR.otpExpired}`,
    );
  });

  it('maps anything else to the exchange sentinel and leaks nothing', async () => {
    stubClient({
      error: new AuthApiError('connect ECONNREFUSED 10.0.0.7:5432', 500, undefined),
    });
    const response = await GET(request('?code=abc'));
    const location = locationOf(response);

    expect(location).toBe(`https://app.test/auth?error=${CALLBACK_ERROR.exchangeFailed}`);
    expect(location).not.toContain('ECONNREFUSED');
  });
});

describe('/auth/callback — success and redirect safety', () => {
  it('exchanges the code and honours a same-origin redirect_to', async () => {
    const exchange = stubClient({ error: null });
    const response = await GET(request('?code=abc&redirect_to=%2Fsettings'));

    expect(exchange).toHaveBeenCalledWith('abc');
    expect(locationOf(response)).toBe('https://app.test/settings');
  });

  it.each([
    ['protocol-relative', '%2F%2Fevil.example.com'],
    ['absolute url', 'https%3A%2F%2Fevil.example.com'],
    ['backslash', '%2F%5Cevil.example.com'],
  ])('refuses a %s redirect_to', async (_label, target) => {
    stubClient({ error: null });
    const response = await GET(request(`?code=abc&redirect_to=${target}`));

    expect(locationOf(response)).toBe('https://app.test/');
  });
});
