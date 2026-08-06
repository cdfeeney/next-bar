import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';
import { __resetMediaMetricRateLimit, RATE_LIMIT_MAX } from '@/lib/mediaMetric.server';

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

  test('rate limit: requests beyond the per-instance window → 429', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    for (let i = 0; i < RATE_LIMIT_MAX; i += 1) {
      expect((await POST(post(JSON.stringify({ surface: 'result-card' })))).status).toBe(204);
    }
    expect((await POST(post(JSON.stringify({ surface: 'result-card' })))).status).toBe(429);
  });
});
