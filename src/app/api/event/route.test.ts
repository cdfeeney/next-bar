import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * POST /api/event — the DARK analytics counter (C2 audit F6: previously
 * untested). Three properties carry the security model and all three are
 * pinned here: the ANALYTICS_ENABLED launch switch, the same-origin check
 * that stops third-party pages poisoning counts from a real browser, and
 * the server-computed night key (client clocks lie).
 */

const rpcMock = vi.fn();
const createClientMock = vi.fn(() => ({ rpc: rpcMock }));

vi.mock('@supabase/supabase-js', () => ({
  createClient: (...args: unknown[]) => createClientMock(...(args as [])),
}));

import { POST } from './route';
import { nycNightKey } from '@/lib/nightKey';

let ipCounter = 0;

function makeRequest(
  body: unknown,
  opts: { ip?: string; origin?: string; host?: string; raw?: string } = {},
): Request {
  const headers = new Headers({
    'content-type': 'application/json',
    'x-forwarded-for': opts.ip ?? `10.2.0.${++ipCounter}`,
    host: opts.host ?? 'nextbar.app',
  });
  if (opts.origin) headers.set('origin', opts.origin);
  return new Request('http://localhost/api/event', {
    method: 'POST',
    headers,
    body: opts.raw ?? JSON.stringify(body),
  });
}

describe('POST /api/event', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('ANALYTICS_ENABLED', '1');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role-test-key');
    rpcMock.mockResolvedValue({ error: null });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('C2 F6: stays DARK with 503 unless ANALYTICS_ENABLED === "1"', async () => {
    vi.stubEnv('ANALYTICS_ENABLED', '');
    const res = await POST(makeRequest({ name: 'search' }));

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false });
    // The gate is the launch switch — nothing downstream may run behind it.
    expect(createClientMock).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it('treats any value other than "1" as off (no truthy-string surprise)', async () => {
    vi.stubEnv('ANALYTICS_ENABLED', 'true');
    const res = await POST(makeRequest({ name: 'search' }));
    expect(res.status).toBe(503);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it('503s when the service-role key is not configured', async () => {
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');
    const res = await POST(makeRequest({ name: 'search' }));
    expect(res.status).toBe(503);
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it('counts a valid event with a SERVER-computed night key', async () => {
    const res = await POST(makeRequest({ name: 'share' }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(rpcMock).toHaveBeenCalledWith('bump_analytics_event', {
      p_name: 'share',
      p_night: nycNightKey(),
    });
  });

  it('IGNORES a client-supplied night — the body carries nothing but the name', async () => {
    await POST(makeRequest({ name: 'visit', night: '1999-01-01', p_night: '1999-01-01' }));

    expect(rpcMock).toHaveBeenCalledWith(
      'bump_analytics_event',
      expect.objectContaining({ p_night: nycNightKey() }),
    );
  });

  it('rejects an event name outside the allow-list', async () => {
    const res = await POST(makeRequest({ name: 'drop_table' }));
    expect(res.status).toBe(400);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it('rejects a non-string name and unparseable JSON', async () => {
    expect((await POST(makeRequest({ name: 42 }))).status).toBe(400);
    expect((await POST(makeRequest(null, { raw: '{' }))).status).toBe(400);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it('C2 F6: blocks CROSS-ORIGIN writes when Origin is present and mismatched', async () => {
    const res = await POST(
      makeRequest({ name: 'search' }, { origin: 'https://evil.example', host: 'nextbar.app' }),
    );

    expect(res.status).toBe(403);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it('rejects an unparseable Origin rather than failing open', async () => {
    const res = await POST(makeRequest({ name: 'search' }, { origin: 'not a url' }));
    expect(res.status).toBe(403);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it('allows a matching Origin, including a port-qualified host', async () => {
    const same = await POST(
      makeRequest({ name: 'search' }, { origin: 'https://nextbar.app', host: 'nextbar.app' }),
    );
    expect(same.status).toBe(200);

    const ported = await POST(
      makeRequest(
        { name: 'search' },
        { origin: 'http://localhost:3000', host: 'localhost:3000' },
      ),
    );
    expect(ported.status).toBe(200);
  });

  it('accepts Origin-less callers (beacons are indistinguishable from curl)', async () => {
    const res = await POST(makeRequest({ name: 'save' }));
    expect(res.status).toBe(200);
  });

  it('C2 F6: rate-limits at 60/minute per IP — the 61st is 429 and never counts', async () => {
    const ip = '198.18.0.9';
    for (let i = 0; i < 60; i++) {
      expect((await POST(makeRequest({ name: 'search' }, { ip }))).status).toBe(200);
    }
    expect(rpcMock).toHaveBeenCalledTimes(60);

    const throttled = await POST(makeRequest({ name: 'search' }, { ip }));
    expect(throttled.status).toBe(429);
    expect(rpcMock).toHaveBeenCalledTimes(60);
  });

  it('surfaces an RPC error as a generic 503 with no detail leak', async () => {
    rpcMock.mockResolvedValue({
      error: { code: '42883', message: 'function bump_analytics_event does not exist' },
    });
    const res = await POST(makeRequest({ name: 'search' }));

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false });
  });

  it('converts transport THROWS into the same generic 503', async () => {
    rpcMock.mockRejectedValue(new Error('getaddrinfo ENOTFOUND'));
    const res = await POST(makeRequest({ name: 'search' }));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false });
  });
});
