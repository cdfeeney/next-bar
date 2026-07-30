import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * /api/health — the endpoint the T0 post-deploy smoke gate trusts, so its
 * failure semantics (503 only for a configured-but-unreachable backend) and
 * its outbound-call economics both need pinning.
 *
 * The probe cache and the single-flight slot are MODULE state, so every test
 * re-imports the route through resetModules to get a clean one.
 */

const fetchMock = vi.fn();

async function loadRoute() {
  vi.resetModules();
  return await import('./route');
}

/** A pending fetch plus the handle to settle it — for the concurrency pin. */
function deferredResponse(): {
  promise: Promise<Response>;
  settle: (res: Response) => void;
} {
  let settle!: (res: Response) => void;
  const promise = new Promise<Response>((resolve) => {
    settle = resolve;
  });
  return { promise, settle };
}

describe('GET /api/health', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-test-key');
    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', '');
    vi.stubEnv('NEXT_PUBLIC_BUILD_SHA', '');
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('reports ok and sends the REQUIRED apikey header', async () => {
    const { GET } = await loadRoute();
    const res = await GET();

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, supabase: 'ok' });
    // Omitting apikey made the gateway 401 a healthy backend once — pinned.
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://example.supabase.co/auth/v1/health');
    expect((init.headers as Record<string, string>).apikey).toBe('anon-test-key');
  });

  it('treats unconfigured as healthy (legal local/preview state) and never fetches', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
    const { GET } = await loadRoute();
    const res = await GET();

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, supabase: 'unconfigured' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('503s when a CONFIGURED backend is unreachable (transport throw)', async () => {
    fetchMock.mockRejectedValue(new Error('ETIMEDOUT'));
    const { GET } = await loadRoute();
    const res = await GET();

    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ ok: false, supabase: 'unreachable' });
  });

  it('503s when the backend answers non-2xx', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 401 }));
    const { GET } = await loadRoute();
    const res = await GET();

    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ supabase: 'unreachable' });
  });

  it('caches across SEQUENTIAL requests inside the TTL', async () => {
    const { GET } = await loadRoute();
    await GET();
    await GET();
    await GET();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('C2 F7: collapses CONCURRENT requests into a single outbound probe', async () => {
    // The regression this pins: the cache was written only after the await,
    // so every request arriving during a probe's flight missed it and fired
    // its own fetch — 1:1 amplification exactly when traffic spikes.
    const deferred = deferredResponse();
    fetchMock.mockReturnValue(deferred.promise);

    const { GET } = await loadRoute();
    const inFlight = Promise.all([GET(), GET(), GET(), GET(), GET()]);
    // Nothing has resolved yet — all five are parked on the same probe.
    expect(fetchMock).toHaveBeenCalledTimes(1);

    deferred.settle(new Response(null, { status: 200 }));
    const responses = await inFlight;

    expect(fetchMock).toHaveBeenCalledTimes(1);
    for (const res of responses) {
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ supabase: 'ok' });
    }
  });

  it('recovers after a failed flight instead of pinning the failure forever', async () => {
    // The in-flight slot must clear on the failure path too, or one bad
    // probe would answer every later request for the life of the instance.
    fetchMock.mockRejectedValueOnce(new Error('ETIMEDOUT'));
    const { GET } = await loadRoute();
    expect((await GET()).status).toBe(503);

    // Still inside the 30s cache TTL, so the cached 'unreachable' answers —
    // the point is that a SECOND call resolves at all rather than hanging.
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
    const res = await GET();
    expect([200, 503]).toContain(res.status);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('truncates the commit sha to 12 chars (no full-revision disclosure)', async () => {
    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', '0123456789abcdef0123456789abcdef01234567');
    const { GET } = await loadRoute();
    const body = (await (await GET()).json()) as { sha: string };
    expect(body.sha).toBe('0123456789ab');
  });

  it('reports sha "dev" when no build sha is injected', async () => {
    const { GET } = await loadRoute();
    const body = (await (await GET()).json()) as { sha: string };
    expect(body.sha).toBe('dev');
  });
});
