import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';
import {
  __resetMediaMetricRateLimit,
  contentLengthExceeds,
  RATE_LIMIT_MAX,
  requestPublicHost,
} from '@/lib/mediaMetric.server';

/**
 * The advisory media-metric endpoint must be a hard-bounded sink: same-origin
 * only, enum-only payload, tiny body, rate-limited, and its ONLY side effect
 * a structured log line. Rejections are terminal and cheap.
 */

const ORIGIN = 'https://next-bar-staging.vercel.app';

function post(body: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(`${ORIGIN}/api/media-metric`, {
    method: 'POST',
    body,
    headers: {
      origin: ORIGIN,
      host: 'next-bar-staging.vercel.app',
      ...headers,
    },
  });
}

beforeEach(() => {
  __resetMediaMetricRateLimit();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('/api/media-metric', () => {
  test('a valid same-origin surface event → 204 and one structured log line', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const res = await POST(post(JSON.stringify({ surface: 'result-card' })));
    expect(res.status).toBe(204);
    expect(log).toHaveBeenCalledTimes(1);
    const line = JSON.parse(log.mock.calls[0][0] as string) as Record<string, unknown>;
    expect(line.type).toBe('google-media-request');
    expect(line.surface).toBe('result-card');
    // Surface + type + timestamp and NOTHING else can reach the logs.
    expect(Object.keys(line).sort()).toEqual(['at', 'surface', 'type']);
  });

  test('cross-origin → 403 before any parsing', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const res = await POST(
      post(JSON.stringify({ surface: 'result-card' }), { origin: 'https://evil.example' }),
    );
    expect(res.status).toBe(403);
    expect(log).not.toHaveBeenCalled();
  });

  test('missing Origin header → 403 (fail closed)', async () => {
    const req = new NextRequest(`${ORIGIN}/api/media-metric`, {
      method: 'POST',
      body: JSON.stringify({ surface: 'result-card' }),
      headers: { host: 'next-bar-staging.vercel.app' },
    });
    expect((await POST(req)).status).toBe(403);
  });

  test.each([
    ['malformed JSON', '{nope'],
    ['non-object body', '"result-card"'],
    ['unknown surface', JSON.stringify({ surface: 'bar-lightbox' })],
    ['missing surface', JSON.stringify({})],
  ])('%s → 400, no log', async (_name, body) => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    expect((await POST(post(body))).status).toBe(400);
    expect(log).not.toHaveBeenCalled();
  });

  test('a surface value with extra payload smuggled in is still just rejected by size or shape', async () => {
    const res = await POST(
      post(JSON.stringify({ surface: 'result-card', placeId: 'ChIJx'.repeat(20) })),
    );
    expect(res.status).toBe(413); // over the 64-byte cap
  });

  test('Vercel topology: public Origin + internal Host + public X-Forwarded-Host → 204', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const res = await POST(
      post(JSON.stringify({ surface: 'result-card' }), {
        host: 'iad1.internal.vercel.example',
        'x-forwarded-host': 'next-bar-staging.vercel.app',
      }),
    );
    expect(res.status).toBe(204);
  });

  test('comma-separated forwarding chain uses the FIRST (client-facing) host', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const res = await POST(
      post(JSON.stringify({ surface: 'result-card' }), {
        host: 'iad1.internal.vercel.example',
        'x-forwarded-host': 'next-bar-staging.vercel.app, lb.internal.example',
      }),
    );
    expect(res.status).toBe(204);
  });

  test('host comparison is case-insensitive', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const res = await POST(
      post(JSON.stringify({ surface: 'result-card' }), {
        'x-forwarded-host': 'Next-Bar-Staging.VERCEL.app',
      }),
    );
    expect(res.status).toBe(204);
  });

  test('forwarded host that mismatches Origin → 403', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const res = await POST(
      post(JSON.stringify({ surface: 'result-card' }), {
        'x-forwarded-host': 'evil.example',
      }),
    );
    expect(res.status).toBe(403);
    expect(log).not.toHaveBeenCalled();
  });

  test('malformed forwarding chain (empty first entry) → 403', async () => {
    const res = await POST(
      post(JSON.stringify({ surface: 'result-card' }), {
        'x-forwarded-host': ' , next-bar-staging.vercel.app',
      }),
    );
    expect(res.status).toBe(403);
  });

  test('64 ASCII bytes exactly → accepted; 65 → 413', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const base = JSON.stringify({ surface: 'result-card' }); // 25 bytes
    const at64 = base + ' '.repeat(64 - base.length); // JSON.parse tolerates trailing spaces
    expect(new TextEncoder().encode(at64).byteLength).toBe(64);
    expect((await POST(post(at64))).status).toBe(204);
    expect((await POST(post(at64 + ' '))).status).toBe(413);
  });

  test('multibyte UTF-8 is measured in BYTES, not string length', async () => {
    // 22 chars of '€' is a 22-length JS string but 66 UTF-8 bytes.
    const body = '€'.repeat(22);
    expect(body.length).toBe(22);
    expect(new TextEncoder().encode(body).byteLength).toBe(66);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    expect((await POST(post(body))).status).toBe(413);
    expect(log).not.toHaveBeenCalled(); // raw bodies never reach the logs
  });

  test('missing Content-Length (chunked stream) over the cap → 413 via the bounded incremental read', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const big = new TextEncoder().encode('x'.repeat(300));
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        // Three chunks so the cap trips mid-stream, not at a boundary.
        controller.enqueue(big.slice(0, 50));
        controller.enqueue(big.slice(50, 100));
        controller.enqueue(big.slice(100));
        controller.close();
      },
    });
    const req = new NextRequest('https://next-bar-staging.vercel.app/api/media-metric', {
      method: 'POST',
      body: stream,
      headers: { origin: ORIGIN, host: 'next-bar-staging.vercel.app' },
      // @ts-expect-error duplex is required for stream bodies but absent from the lib type
      duplex: 'half',
    });
    expect((await POST(req)).status).toBe(413);
    expect(log).not.toHaveBeenCalled();
  });
});

describe('header helpers — claims match implementation', () => {
  test('contentLengthExceeds: honest oversize true; at-cap, malformed, absent false (stream read is the backstop)', () => {
    expect(contentLengthExceeds('1000')).toBe(true);
    expect(contentLengthExceeds('65')).toBe(true);
    expect(contentLengthExceeds('64')).toBe(false);
    expect(contentLengthExceeds('abc')).toBe(false); // dishonest → bounded read decides
    expect(contentLengthExceeds(null)).toBe(false);
  });

  test('requestPublicHost: forwarded wins, chain takes first entry, lower-cased, empty → null', () => {
    expect(requestPublicHost('A.Example', 'internal')).toBe('a.example');
    expect(requestPublicHost('a.example, b.internal', 'internal')).toBe('a.example');
    expect(requestPublicHost(null, 'Host.Example')).toBe('host.example');
    expect(requestPublicHost(' , a.example', 'internal')).toBeNull();
    expect(requestPublicHost(null, null)).toBeNull();
  });

  test('rate limit: requests beyond the per-instance window → 429', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    for (let i = 0; i < RATE_LIMIT_MAX; i += 1) {
      expect((await POST(post(JSON.stringify({ surface: 'result-card' })))).status).toBe(204);
    }
    expect((await POST(post(JSON.stringify({ surface: 'result-card' })))).status).toBe(429);
  });
});
