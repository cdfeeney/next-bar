import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The mirror of `account/delete/route.failclosed.test.ts`.
 *
 * That file argues a route's own policy must be pinned at the route level,
 * because unit tests only prove `createTieredLimiter` honours whichever
 * policy it is handed — not that THIS route hands it the right one. Review
 * pointed out the argument is symmetric: nothing was stopping a refactor from
 * flipping the waitlist to fail-closed, which would 429 every signup during
 * any RPC failure, INCLUDING the entirely normal state where migration 0043
 * has not been applied yet.
 *
 * That is not hypothetical. The salt is the activation switch, and if it is
 * set before 0043 lands, every durable call errors. Fail-open is what keeps
 * the funnel alive through that window.
 */

const insertMock = vi.fn();
const rpcMock = vi.fn();

const holder = vi.hoisted(() => ({ client: null as unknown }));
vi.mock('@/lib/supabase', () => ({
  get supabase() {
    return holder.client;
  },
}));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ rpc: rpcMock }),
}));

function request(email: string, ip: string): Request {
  return new Request('http://localhost/api/waitlist', {
    method: 'POST',
    headers: new Headers({
      'content-type': 'application/json',
      host: 'nextbar.app',
      origin: 'https://nextbar.app',
      'x-forwarded-for': ip,
    }),
    body: JSON.stringify({ email }),
  });
}

async function loadRoute() {
  vi.resetModules();
  const mod = await import('./route');
  return mod.POST;
}

describe('POST /api/waitlist — shared rate-limit store unavailable', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://stub.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'stub-service-key');
    vi.stubEnv('RATE_LIMIT_KEY_SALT', 'stub-salt-not-a-secret');
    holder.client = { from: () => ({ insert: insertMock }) };
    insertMock.mockResolvedValue({ error: null });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('FAILS OPEN: a real signup still succeeds when the store throws', async () => {
    rpcMock.mockRejectedValue(new Error('store unreachable'));
    const POST = await loadRoute();

    const res = await POST(request('degraded@example.com', '198.51.100.10'));

    expect(res.status).toBe(200);
    expect(insertMock).toHaveBeenCalledTimes(1);
  });

  it('FAILS OPEN when 0043 is simply not applied yet', async () => {
    // 42883 = undefined_function. This is the expected state between
    // deploying the code and applying the migration.
    rpcMock.mockResolvedValue({ data: null, error: { code: '42883' } });
    const POST = await loadRoute();

    const res = await POST(request('unapplied@example.com', '198.51.100.11'));

    expect(res.status).toBe(200);
    expect(insertMock).toHaveBeenCalledTimes(1);
  });

  it('but fail-open is NOT unlimited — the local backstop still binds', async () => {
    // The property that makes fail-open acceptable: worst case is exactly the
    // OLD `limit x instances` behaviour, never unbounded.
    rpcMock.mockRejectedValue(new Error('store unreachable'));
    const POST = await loadRoute();

    const ip = '198.51.100.12';
    for (let i = 0; i < 10; i++) {
      expect((await POST(request(`ok${i}@example.com`, ip))).status).toBe(200);
    }
    const eleventh = await POST(request('over@example.com', ip));
    expect(eleventh.status).toBe(429);
  });

  it('still refuses when the store answers "over budget"', async () => {
    // Fail-open concerns UNAVAILABILITY only. A store that answers must be
    // obeyed, or the shared cap would be decorative.
    rpcMock.mockResolvedValue({ data: false, error: null });
    const POST = await loadRoute();

    const res = await POST(request('overbudget@example.com', '198.51.100.13'));

    expect(res.status).toBe(429);
    expect(insertMock).not.toHaveBeenCalled();
  });
});
