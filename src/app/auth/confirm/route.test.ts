import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthApiError } from '@supabase/supabase-js';

vi.mock('@/lib/supabase/server', () => ({ getServerSupabase: vi.fn() }));

import { getServerSupabase } from '@/lib/supabase/server';
import { CALLBACK_ERROR } from '@/lib/authCallbackErrors';
import { GET } from './route';

const getServerSupabaseMock = vi.mocked(getServerSupabase);

/**
 * /auth/confirm is the cross-context repair: `verifyOtp({ token_hash })`
 * needs no PKCE verifier, so it completes in whatever browser opens the
 * email. These tests use a mocked client — no network, no project access.
 */

/** Records cookie writes so we can prove they happen BEFORE the redirect. */
const cookieWrites: string[] = [];

function stubClient(
  verifyResult: { error: unknown } = { error: null },
): ReturnType<typeof vi.fn> {
  const verifyOtp = vi.fn(async () => {
    // Stands in for the cookie adapter in lib/supabase/server: a real
    // verifyOtp writes the session through it during this await.
    cookieWrites.push('sb-auth-token');
    return verifyResult;
  });
  getServerSupabaseMock.mockReturnValue({ auth: { verifyOtp } } as unknown as ReturnType<
    typeof getServerSupabase
  >);
  return verifyOtp;
}

function request(query: string): Parameters<typeof GET>[0] {
  return new Request(`https://app.test/auth/confirm${query}`) as Parameters<typeof GET>[0];
}

function locationOf(response: { headers: Headers }): string {
  return response.headers.get('location') ?? '';
}

/**
 * The route now emits a redacted diagnostic on every failure path. Captured
 * rather than silenced, so the assertions below can prove the token never
 * reaches a log sink — the same guarantee the e2e spec asserts from outside.
 */
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  cookieWrites.length = 0;
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  errorSpy.mockRestore();
});

/** Everything the route wrote to console during one test, as one string. */
function loggedText(): string {
  return JSON.stringify(errorSpy.mock.calls);
}

describe('/auth/confirm — parameter validation', () => {
  it('rejects a missing token_hash without calling Supabase', async () => {
    const verifyOtp = stubClient();
    const response = await GET(request('?type=recovery'));

    expect(locationOf(response)).toBe(
      `https://app.test/auth?error=${CALLBACK_ERROR.invalidConfirmationLink}`,
    );
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it('rejects a blank token_hash', async () => {
    const verifyOtp = stubClient();
    const response = await GET(request('?token_hash=%20%20&type=recovery'));

    expect(locationOf(response)).toContain(CALLBACK_ERROR.invalidConfirmationLink);
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it('rejects a missing type', async () => {
    const verifyOtp = stubClient();
    const response = await GET(request('?token_hash=abc123'));

    expect(locationOf(response)).toContain(CALLBACK_ERROR.invalidConfirmationLink);
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it.each(['email_change', 'magiclink', 'invite', 'phone_change', 'sms', 'RECOVERY', 'admin'])(
    'rejects the out-of-allowlist type %s',
    async (type) => {
      const verifyOtp = stubClient();
      const response = await GET(request(`?token_hash=abc123&type=${type}`));

      expect(locationOf(response)).toContain(CALLBACK_ERROR.invalidConfirmationLink);
      expect(verifyOtp).not.toHaveBeenCalled();
    },
  );

  it('returns the unconfigured sentinel when Supabase env vars are missing', async () => {
    getServerSupabaseMock.mockReturnValue(null);
    const response = await GET(request('?token_hash=abc123&type=recovery'));

    expect(locationOf(response)).toBe(
      `https://app.test/auth?error=${CALLBACK_ERROR.unconfigured}`,
    );
  });
});

describe('/auth/confirm — both email types complete', () => {
  it('verifies a password recovery token and lands on /settings', async () => {
    const verifyOtp = stubClient({ error: null });
    const response = await GET(request('?token_hash=hash-r&type=recovery'));

    expect(verifyOtp).toHaveBeenCalledWith({ type: 'recovery', token_hash: 'hash-r' });
    expect(locationOf(response)).toBe('https://app.test/settings');
  });

  it('verifies a signup confirmation token and lands on /settings', async () => {
    // The PKCE boundary breaks signup confirmation too — not just recovery.
    const verifyOtp = stubClient({ error: null });
    const response = await GET(request('?token_hash=hash-e&type=email'));

    expect(verifyOtp).toHaveBeenCalledWith({ type: 'email', token_hash: 'hash-e' });
    expect(locationOf(response)).toBe('https://app.test/settings');
  });

  /**
   * Normalisation, pinned on the EXACT argument.
   *
   * Before this, validation tested `tokenHash.trim()` but `verifyOtp` received
   * the raw value, so a link whose token picked up encoded whitespace (mail
   * clients and copy-paste both do this) passed the blank check and then failed
   * upstream against `"abc "` — a valid confirmation lost to a stray space,
   * surfacing as the generic failure banner.
   */
  it('trims surrounding whitespace before calling verifyOtp', async () => {
    const verifyOtp = stubClient({ error: null });
    await GET(request('?token_hash=%20abc%20&type=recovery'));

    expect(verifyOtp).toHaveBeenCalledWith({ type: 'recovery', token_hash: 'abc' });
  });

  it('rejects a whitespace-only token without calling Supabase', async () => {
    const verifyOtp = stubClient();
    const response = await GET(request('?token_hash=%09%20%20&type=recovery'));

    expect(locationOf(response)).toContain(CALLBACK_ERROR.invalidConfirmationLink);
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it('writes the session cookie BEFORE returning the redirect', async () => {
    stubClient({ error: null });
    const response = await GET(request('?token_hash=hash-r&type=recovery'));

    // If the redirect were built before awaiting verifyOtp, the user would
    // land on /settings with no session.
    expect(cookieWrites).toEqual(['sb-auth-token']);
    expect(response.status).toBeGreaterThanOrEqual(300);
    expect(response.status).toBeLessThan(400);
  });
});

describe('/auth/confirm — redirect safety', () => {
  it('honours a same-origin absolute path', async () => {
    stubClient({ error: null });
    const response = await GET(request('?token_hash=h&type=recovery&next=%2Frankings'));

    expect(locationOf(response)).toBe('https://app.test/rankings');
  });

  it.each([
    ['protocol-relative', '%2F%2Fevil.example.com'],
    ['absolute url', 'https%3A%2F%2Fevil.example.com'],
    ['backslash', '%2F%5Cevil.example.com'],
    ['relative without slash', 'rankings'],
  ])('falls back to the default for a %s next value', async (_label, next) => {
    stubClient({ error: null });
    const response = await GET(request(`?token_hash=h&type=recovery&next=${next}`));

    expect(locationOf(response)).toBe('https://app.test/settings');
  });
});

describe('/auth/confirm — failure sentinels leak nothing', () => {
  it('maps an expired token to the otp sentinel', async () => {
    stubClient({ error: new AuthApiError('Token has expired', 403, 'otp_expired') });
    const response = await GET(request('?token_hash=h&type=recovery'));

    expect(locationOf(response)).toBe(
      `https://app.test/auth?error=${CALLBACK_ERROR.otpExpired}`,
    );
  });

  it('maps any other verifyOtp failure to the confirmation sentinel', async () => {
    stubClient({ error: new AuthApiError('teapot', 418, 'im_a_teapot') });
    const response = await GET(request('?token_hash=h&type=recovery'));

    expect(locationOf(response)).toBe(
      `https://app.test/auth?error=${CALLBACK_ERROR.confirmationFailed}`,
    );
  });

  /**
   * The operator-visibility half of the contract: a template pointed at the
   * wrong verification type must be diagnosable from logs, not only from a wave
   * of "my link expired" reports. Asserts the category, and that the token and
   * raw prose stay out of the record.
   */
  it('emits a redacted diagnostic naming the wrong-type category', async () => {
    stubClient();
    await GET(request('?token_hash=super-secret-token-hash&type=signup'));

    const logged = loggedText();
    expect(logged).toContain('auth.confirm.failure');
    expect(logged).toContain('known-supabase-type');
    expect(logged).not.toContain('super-secret-token-hash');
  });

  it('keeps the token and SDK prose out of the verification-failure log', async () => {
    stubClient({
      error: new AuthApiError('connect ECONNREFUSED 10.0.0.7:5432', 500, undefined),
    });
    await GET(request('?token_hash=super-secret-token-hash&type=recovery'));

    const logged = loggedText();
    expect(logged).toContain('auth.confirm.failure');
    expect(logged).not.toContain('super-secret-token-hash');
    expect(logged).not.toContain('ECONNREFUSED');
    expect(logged).not.toContain('10.0.0.7');
  });

  it('never puts the token hash or the raw error in the redirect', async () => {
    stubClient({
      error: new AuthApiError('connect ECONNREFUSED 10.0.0.7:5432', 500, undefined),
    });
    const response = await GET(
      request('?token_hash=super-secret-token-hash&type=recovery'),
    );
    const location = locationOf(response);

    expect(location).not.toContain('super-secret-token-hash');
    expect(location).not.toContain('ECONNREFUSED');
    expect(location).not.toContain('10.0.0.7');
  });
});
