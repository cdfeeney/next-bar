import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The headline behaviour of Item 10, at the ROUTE level rather than the unit
 * level: when the shared rate-limit store is unreachable, account deletion
 * REFUSES.
 *
 * This needs its own file because the route builds its durable counter from
 * the environment at MODULE LOAD, so the env has to be in place before the
 * route is imported. `vi.resetModules()` plus a dynamic import is the only
 * way to exercise both the configured and unconfigured shapes in one suite.
 *
 * Why this matters enough to test at this level: `/api/account/delete` is the
 * only quota in the app guarding an irreversible action, and it is the only
 * consumer whose DegradedPolicy is fail-closed. Every other route fails open.
 * A refactor that "helpfully" made the policy uniform would be invisible to
 * the unit tests — they prove `createTieredLimiter` honours whichever policy
 * it is handed, not that THIS route hands it the right one.
 */

const getUserMock = vi.fn();
const deleteUserMock = vi.fn();
const adminSignOutMock = vi.fn();
const rpcMock = vi.fn();

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: {
      getUser: getUserMock,
      admin: { deleteUser: deleteUserMock, signOut: adminSignOutMock },
    },
    rpc: rpcMock,
  }),
}));

function request(ip: string): Request {
  const headers = new Headers({
    authorization: 'Bearer valid-token',
    'x-forwarded-for': ip,
  });
  return new Request('http://localhost/api/account/delete', {
    method: 'POST',
    headers,
  });
}

async function loadRoute() {
  vi.resetModules();
  const mod = await import('./route');
  return mod.POST;
}

describe('POST /api/account/delete — shared rate-limit store unavailable', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://stub.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'stub-service-key');
    // Present salt => the route builds a durable counter and will consult it.
    vi.stubEnv('RATE_LIMIT_KEY_SALT', 'stub-salt-not-a-secret');
    getUserMock.mockResolvedValue({
      data: { user: { id: 'user-fail-closed' } },
      error: null,
    });
    deleteUserMock.mockResolvedValue({ error: null });
    adminSignOutMock.mockResolvedValue({ error: null });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('REFUSES the deletion (429) rather than proceeding unbounded', async () => {
    // The shared counter is unreachable: the RPC rejects outright.
    rpcMock.mockRejectedValue(new Error('store unreachable'));
    const POST = await loadRoute();

    const res = await POST(request('198.51.100.1'));

    expect(res.status).toBe(429);
    // The whole point: an unreachable quota must not become an unlimited one.
    expect(deleteUserMock).not.toHaveBeenCalled();
  });

  it('also refuses when the RPC returns an error rather than throwing', async () => {
    // e.g. migration 0043 not applied yet — an unapplied migration must not
    // silently disable the bound on an irreversible action.
    rpcMock.mockResolvedValue({ data: null, error: { code: '42883' } });
    const POST = await loadRoute();

    const res = await POST(request('198.51.100.2'));

    expect(res.status).toBe(429);
    expect(deleteUserMock).not.toHaveBeenCalled();
  });

  it('proceeds normally when the shared store answers "within budget"', async () => {
    // Positive control: proves the refusals above come from the STORE being
    // unavailable, not from the route being broken in this configuration.
    rpcMock.mockResolvedValue({ data: true, error: null });
    const POST = await loadRoute();

    const res = await POST(request('198.51.100.3'));

    expect(res.status).toBe(200);
    expect(deleteUserMock).toHaveBeenCalledTimes(1);
  });

  it('refuses when the shared store answers "over budget"', async () => {
    rpcMock.mockResolvedValue({ data: false, error: null });
    const POST = await loadRoute();

    const res = await POST(request('198.51.100.4'));

    expect(res.status).toBe(429);
    expect(deleteUserMock).not.toHaveBeenCalled();
  });

  it('REQUIRE_DURABLE_RATE_LIMIT=1 refuses when no shared tier is configured', async () => {
    // Staging must be able to rehearse the exact production refusal. Gating
    // this on NODE_ENV alone would make the one loud-failing configuration
    // the one nobody can test before shipping it.
    vi.stubEnv('RATE_LIMIT_KEY_SALT', '');
    vi.stubEnv('REQUIRE_DURABLE_RATE_LIMIT', '1');
    const POST = await loadRoute();

    const res = await POST(request('198.51.100.6'));

    expect(res.status).toBe(429);
    expect(deleteUserMock).not.toHaveBeenCalled();
  });

  it('does NOT arm on a Vercel PREVIEW deploy, where NODE_ENV is also production', async () => {
    // next build sets NODE_ENV=production for previews too; VERCEL_ENV is
    // what actually distinguishes them. A bare NODE_ENV check would 429 the
    // deletion flow on every preview.
    vi.stubEnv('RATE_LIMIT_KEY_SALT', '');
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VERCEL_ENV', 'preview');
    const POST = await loadRoute();

    const res = await POST(request('198.51.100.7'));

    expect(res.status).toBe(200);
    expect(deleteUserMock).toHaveBeenCalledTimes(1);
  });

  it('DOES arm on a Vercel PRODUCTION deploy with no salt', async () => {
    vi.stubEnv('RATE_LIMIT_KEY_SALT', '');
    vi.stubEnv('VERCEL_ENV', 'production');
    const POST = await loadRoute();

    const res = await POST(request('198.51.100.8'));

    expect(res.status).toBe(429);
    expect(deleteUserMock).not.toHaveBeenCalled();
  });

  it('with NO shared tier configured, still deletes (local-only, not degraded)', async () => {
    // A laptop or preview deploy has no salt. That is not an outage and must
    // not be treated as one — otherwise local development cannot delete an
    // account at all.
    vi.stubEnv('RATE_LIMIT_KEY_SALT', '');
    const POST = await loadRoute();

    const res = await POST(request('198.51.100.5'));

    expect(res.status).toBe(200);
    expect(rpcMock).not.toHaveBeenCalled();
    expect(deleteUserMock).toHaveBeenCalledTimes(1);
  });
});
