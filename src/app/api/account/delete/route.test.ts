import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * H2 account-deletion route — MOCKED-client tests only (nightlog rule 10:
 * the service-role path is author-only overnight; nothing here touches
 * live auth). createClient is mocked at the module boundary, so the route
 * logic runs for real against a fake Supabase admin client.
 */

const getUserMock = vi.fn();
const deleteUserMock = vi.fn();
const createClientMock = vi.fn(() => ({
  auth: {
    getUser: getUserMock,
    admin: { deleteUser: deleteUserMock },
  },
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: (...args: unknown[]) => createClientMock(...(args as [])),
}));

import { POST } from './route';

const USER_ID = 'uuid-caller';

function makeRequest(opts: { token?: string; ip?: string } = {}): Request {
  const headers = new Headers();
  if (opts.token) headers.set('authorization', `Bearer ${opts.token}`);
  // Distinct IP per test by default so the module-level rate limiter never
  // couples unrelated tests.
  headers.set('x-forwarded-for', opts.ip ?? `10.0.0.${counter++}`);
  return new Request('http://localhost/api/account/delete', {
    method: 'POST',
    headers,
  });
}
let counter = 1;

describe('POST /api/account/delete', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // The overnight loop exports LOOP_UNATTENDED=1 into the test process —
    // stub it OFF so the non-gate cases exercise the real logic, and the
    // gate case sets it explicitly.
    vi.stubEnv('LOOP_UNATTENDED', '');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role-test-key');
    getUserMock.mockResolvedValue({
      data: { user: { id: USER_ID } },
      error: null,
    });
    deleteUserMock.mockResolvedValue({ data: {}, error: null });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('hard-refuses with 503 under LOOP_UNATTENDED=1 (unattended safety gate)', async () => {
    vi.stubEnv('LOOP_UNATTENDED', '1');
    const res = await POST(makeRequest({ token: 'valid' }));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false, error: 'unavailable' });
    // The gate sits BEFORE any Supabase construction — no client, no call.
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it('503 unavailable when the service key is not configured', async () => {
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');
    const res = await POST(makeRequest({ token: 'valid' }));
    expect(res.status).toBe(503);
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it('401 without a bearer token — no Supabase calls at all', async () => {
    const res = await POST(makeRequest());
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ ok: false, error: 'unauthorized' });
    expect(getUserMock).not.toHaveBeenCalled();
    expect(deleteUserMock).not.toHaveBeenCalled();
  });

  it('401 when the token does not verify — deleteUser never fires', async () => {
    getUserMock.mockResolvedValue({
      data: { user: null },
      error: { message: 'invalid JWT' },
    });
    const res = await POST(makeRequest({ token: 'forged' }));
    expect(res.status).toBe(401);
    expect(deleteUserMock).not.toHaveBeenCalled();
  });

  it('deletes exactly the VERIFIED user id (never anything request-supplied)', async () => {
    const res = await POST(makeRequest({ token: 'valid' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(getUserMock).toHaveBeenCalledWith('valid');
    expect(deleteUserMock).toHaveBeenCalledTimes(1);
    expect(deleteUserMock).toHaveBeenCalledWith(USER_ID);
  });

  it('IGNORES an attacker-supplied body id — the verified id still wins (Opus review)', async () => {
    // Adversarial body: if any future refactor starts reading a target id
    // from the request, this pins the regression.
    const headers = new Headers({
      authorization: 'Bearer valid',
      'x-forwarded-for': '10.9.9.9',
      'content-type': 'application/json',
    });
    const res = await POST(
      new Request('http://localhost/api/account/delete', {
        method: 'POST',
        headers,
        body: JSON.stringify({ userId: 'uuid-victim', id: 'uuid-victim' }),
      }),
    );
    expect(res.status).toBe(200);
    expect(deleteUserMock).toHaveBeenCalledTimes(1);
    expect(deleteUserMock).toHaveBeenCalledWith(USER_ID);
  });

  it('converts transport THROWS into the same generic 500 (no escape)', async () => {
    getUserMock.mockRejectedValue(new Error('getaddrinfo ENOTFOUND'));
    const res = await POST(makeRequest({ token: 'valid' }));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ ok: false, error: 'server_error' });
    expect(deleteUserMock).not.toHaveBeenCalled();
  });

  it('500 with a GENERIC body when deletion fails (no detail leak)', async () => {
    deleteUserMock.mockResolvedValue({
      data: null,
      error: { message: 'internal: fk violation on shard 7' },
    });
    const res = await POST(makeRequest({ token: 'valid' }));
    expect(res.status).toBe(500);
    // The Postgres detail must never reach the caller.
    expect(await res.json()).toEqual({ ok: false, error: 'server_error' });
  });

  it('rate-limits per IP: 6th attempt inside the hour is 429', async () => {
    const ip = '203.0.113.99';
    for (let i = 0; i < 5; i++) {
      const res = await POST(makeRequest({ token: 'valid', ip }));
      expect(res.status).toBe(200);
    }
    const throttled = await POST(makeRequest({ token: 'valid', ip }));
    expect(throttled.status).toBe(429);
    expect(await throttled.json()).toEqual({ ok: false, error: 'rate_limited' });
  });
});
