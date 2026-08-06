import { afterEach, describe, expect, test, vi } from 'vitest';
import { GET, dynamic } from './route';

/**
 * The D1 runtime kill switch must FAIL CLOSED: only the exact server-only
 * value '1' enables google-live media; every other state — absent, empty,
 * 'true', '0' — reads as disabled. The variable is read at REQUEST time
 * (never inlined), which is the whole point of the route.
 */
describe('/api/flags — runtime google-media kill switch', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test('absent variable → disabled (fail closed)', async () => {
    vi.stubEnv('GOOGLE_MEDIA_RUNTIME_ENABLED', '');
    const res = GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ googleMedia: false });
  });

  test.each(['0', 'true', 'yes', 'on'])(
    'non-"1" value %s → disabled',
    async (value) => {
      vi.stubEnv('GOOGLE_MEDIA_RUNTIME_ENABLED', value);
      expect(await GET().json()).toEqual({ googleMedia: false });
    },
  );

  test('exactly "1" → enabled', async () => {
    vi.stubEnv('GOOGLE_MEDIA_RUNTIME_ENABLED', '1');
    expect(await GET().json()).toEqual({ googleMedia: true });
  });

  test('read at request time, not import time — a flip changes the next response', async () => {
    vi.stubEnv('GOOGLE_MEDIA_RUNTIME_ENABLED', '1');
    expect(await GET().json()).toEqual({ googleMedia: true });
    vi.stubEnv('GOOGLE_MEDIA_RUNTIME_ENABLED', '0');
    expect(await GET().json()).toEqual({ googleMedia: false });
  });

  test('carries the short shared-cache header that bounds kill propagation', () => {
    vi.stubEnv('GOOGLE_MEDIA_RUNTIME_ENABLED', '1');
    expect(GET().headers.get('Cache-Control')).toContain('s-maxage=60');
  });

  test('the route is pinned dynamic — static prerender would bake the env into the build', () => {
    // Caught live: without force-dynamic the build output showed `○ /api/flags`
    // (prerendered), which freezes the flag at BUILD time and silently
    // recreates the inlining problem the route exists to escape.
    expect(dynamic).toBe('force-dynamic');
  });
});
