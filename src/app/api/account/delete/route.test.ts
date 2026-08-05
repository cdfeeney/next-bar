import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * H2 account-deletion route — MOCKED-client tests only (nightlog rule 10:
 * the service-role path is author-only overnight; nothing here touches
 * live auth). createClient is mocked at the module boundary, so the route
 * logic runs for real against a fake Supabase admin client.
 */

const getUserMock = vi.fn();
const deleteUserMock = vi.fn();
const adminSignOutMock = vi.fn();
const createClientMock = vi.fn(() => ({
  auth: {
    getUser: getUserMock,
    admin: { deleteUser: deleteUserMock, signOut: adminSignOutMock },
  },
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: (...args: unknown[]) => createClientMock(...(args as [])),
}));

import { POST } from './route';

/**
 * The route's limiters are module-scoped, so state leaks between tests in
 * this file by design. Every test therefore gets its OWN verified user id
 * (and, by default, its own IP) — otherwise a successful delete in one test
 * silently spends another test's 5/hour quota.
 */
let USER_ID = '';
let userIdCounter = 0;

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
    USER_ID = `uuid-caller-${++userIdCounter}`;
    getUserMock.mockResolvedValue({
      data: { user: { id: USER_ID } },
      error: null,
    });
    deleteUserMock.mockResolvedValue({ data: {}, error: null });
    adminSignOutMock.mockResolvedValue({ data: null, error: null });
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

  it('rate-limits the VERIFIED USER, not the IP: 6th delete inside the hour is 429', async () => {
    // Every request comes from a DIFFERENT address. Under the old IP-keyed
    // limiter all six would have passed (C2 F3: one user rotating IPs was
    // unlimited); the quota now follows the identity.
    for (let i = 0; i < 5; i++) {
      const res = await POST(makeRequest({ token: 'valid', ip: `198.51.100.${i}` }));
      expect(res.status).toBe(200);
    }
    const throttled = await POST(
      makeRequest({ token: 'valid', ip: '198.51.100.200' }),
    );
    expect(throttled.status).toBe(429);
    expect(await throttled.json()).toEqual({ ok: false, error: 'rate_limited' });
    expect(deleteUserMock).toHaveBeenCalledTimes(5);
  });

  it('C2 F1: unauthenticated POSTs never spend a real user’s delete budget', async () => {
    // The exact attack: someone POSTs from the victim's egress address,
    // hoping to burn the quota that stands between the victim and deleting
    // their own account. Before the two-stage fix, five of these locked the
    // address out for an hour.
    const sharedIp = '203.0.113.7';
    for (let i = 0; i < 12; i++) {
      const res = await POST(makeRequest({ ip: sharedIp }));
      expect(res.status).toBe(401);
    }
    expect(getUserMock).not.toHaveBeenCalled();

    // The real user, behind that same NAT, is unaffected.
    for (let i = 0; i < 5; i++) {
      const res = await POST(makeRequest({ token: 'valid', ip: sharedIp }));
      expect(res.status).toBe(200);
    }
    expect(deleteUserMock).toHaveBeenCalledTimes(5);
  });

  it('a successful delete does NOT charge the shared IP bucket', async () => {
    // Legitimate traffic must never walk the address toward the coarse
    // pre-auth bound — that is what keeps stage 1 from becoming F1 again.
    const sharedIp = '203.0.113.21';
    for (let i = 0; i < 5; i++) {
      expect((await POST(makeRequest({ token: 'valid', ip: sharedIp }))).status).toBe(200);
    }
    // A DIFFERENT user on the same address still gets a full budget.
    USER_ID = 'uuid-housemate';
    getUserMock.mockResolvedValue({
      data: { user: { id: USER_ID } },
      error: null,
    });
    const housemate = await POST(makeRequest({ token: 'valid', ip: sharedIp }));
    expect(housemate.status).toBe(200);
    expect(deleteUserMock).toHaveBeenLastCalledWith('uuid-housemate');
  });

  it('still bounds forged-token floods per IP (stage 1 coarse cap)', async () => {
    // Rejected tokens DO cost an outbound verification call, so they are
    // charged. Past the cap the route stops calling Supabase at all.
    const floodIp = '203.0.113.44';
    getUserMock.mockResolvedValue({
      data: { user: null },
      error: { message: 'invalid JWT' },
    });
    for (let i = 0; i < 20; i++) {
      expect((await POST(makeRequest({ token: 'forged', ip: floodIp }))).status).toBe(401);
    }
    expect(getUserMock).toHaveBeenCalledTimes(20);

    const throttled = await POST(makeRequest({ token: 'forged', ip: floodIp }));
    expect(throttled.status).toBe(429);
    // The point of the cap: no further amplification into Supabase.
    expect(getUserMock).toHaveBeenCalledTimes(20);
  });

  it('revokes ALL refresh sessions (global) BEFORE deleting the user', async () => {
    // Cross-device stale-session fix (staging 2026-08-01): deleting the auth
    // user does not invalidate issued access tokens, and a browser that can
    // still REFRESH holds authenticated UI forever. Revocation-then-delete
    // closes the refresh path; order matters so a refresh cannot land in a
    // delete-then-revoke gap.
    const res = await POST(makeRequest({ token: 'valid' }));
    expect(res.status).toBe(200);
    expect(adminSignOutMock).toHaveBeenCalledTimes(1);
    expect(adminSignOutMock).toHaveBeenCalledWith('valid', 'global');
    expect(deleteUserMock).toHaveBeenCalledTimes(1);
    expect(adminSignOutMock.mock.invocationCallOrder[0]).toBeLessThan(
      deleteUserMock.mock.invocationCallOrder[0],
    );
  });

  it('still deletes when revocation resolves with { error } (defense-in-depth must not block)', async () => {
    // supabase-js resolves with { error } instead of throwing (DeepSeek
    // design review) — a structured 503 from GoTrue must not stop deletion.
    adminSignOutMock.mockResolvedValue({
      data: null,
      error: { message: 'service unavailable', status: 503 },
    });
    const res = await POST(makeRequest({ token: 'valid' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(deleteUserMock).toHaveBeenCalledTimes(1);
  });

  it('still deletes when revocation THROWS (transport)', async () => {
    adminSignOutMock.mockRejectedValue(new Error('socket hang up'));
    const res = await POST(makeRequest({ token: 'valid' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(deleteUserMock).toHaveBeenCalledTimes(1);
  });

  it('accepted partial failure: revoke succeeded, delete failed → 500, and a retry still works', async () => {
    // Santa round-1 (DeepSeek): after a successful global revocation a failed
    // deleteUser leaves the user signed out everywhere with the account
    // intact. Documented trade — NOT a lockout: the access token stays valid
    // until expiry, so the same bearer can retry immediately.
    deleteUserMock.mockResolvedValueOnce({
      data: null,
      error: { message: 'db timeout' },
    });
    const failed = await POST(makeRequest({ token: 'valid' }));
    expect(failed.status).toBe(500);
    expect(await failed.json()).toEqual({ ok: false, error: 'server_error' });
    expect(adminSignOutMock).toHaveBeenCalledTimes(1);

    const retry = await POST(makeRequest({ token: 'valid' }));
    expect(retry.status).toBe(200);
    expect(await retry.json()).toEqual({ ok: true });
    expect(deleteUserMock).toHaveBeenCalledTimes(2);
  });

  it('never revokes sessions for an UNVERIFIED token', async () => {
    getUserMock.mockResolvedValue({
      data: { user: null },
      error: { message: 'invalid JWT' },
    });
    const res = await POST(makeRequest({ token: 'forged' }));
    expect(res.status).toBe(401);
    expect(adminSignOutMock).not.toHaveBeenCalled();
  });

  it('never revokes sessions on a rate-limited request', async () => {
    // Revocation is a side effect reserved for a deletion we are committed
    // to — a 429 must not sign the user out of every device.
    for (let i = 0; i < 5; i++) {
      expect(
        (await POST(makeRequest({ token: 'valid', ip: `198.51.101.${i}` })))
          .status,
      ).toBe(200);
    }
    const throttled = await POST(
      makeRequest({ token: 'valid', ip: '198.51.101.99' }),
    );
    expect(throttled.status).toBe(429);
    expect(adminSignOutMock).toHaveBeenCalledTimes(5);
  });

  it('does not charge the IP bucket for OUR OWN transport failures', async () => {
    // An outage is not the caller's fault; billing their address for it
    // would re-create the lockout after every backend wobble.
    const ip = '203.0.113.90';
    getUserMock.mockRejectedValue(new Error('getaddrinfo ENOTFOUND'));
    for (let i = 0; i < 25; i++) {
      expect((await POST(makeRequest({ token: 'valid', ip }))).status).toBe(500);
    }

    getUserMock.mockResolvedValue({
      data: { user: { id: USER_ID } },
      error: null,
    });
    const recovered = await POST(makeRequest({ token: 'valid', ip }));
    expect(recovered.status).toBe(200);
  });
});
