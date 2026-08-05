import { afterEach, describe, expect, it, vi } from 'vitest';
import robots from '@/app/robots';

/**
 * The OR-composition robots.ts guards on (env identity AND public origin)
 * is exactly the fail-closed indexing behavior the g-b83d1c77 audit cares
 * about — its two inputs are unit-tested individually, this pins the
 * composed route (santa: Claude, panel round).
 */
describe('robots.ts fail-closed composition', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('production + public https origin → allows and advertises the sitemap', () => {
    vi.stubEnv('VERCEL_TARGET_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://next-bar.com');
    const result = robots();
    expect(result.rules).toMatchObject({ userAgent: '*', allow: '/' });
    expect(result.sitemap).toBe('https://next-bar.com/sitemap.xml');
  });

  it('production with a LOCALHOST origin still disallows everything', () => {
    vi.stubEnv('VERCEL_TARGET_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', '');
    vi.stubEnv('VERCEL_PROJECT_PRODUCTION_URL', '');
    vi.stubEnv('VERCEL_URL', '');
    const result = robots();
    expect(result.rules).toMatchObject({ userAgent: '*', disallow: '/' });
    expect(result.sitemap).toBeUndefined();
  });

  it('staging disallows everything even with a public origin', () => {
    vi.stubEnv('VERCEL_TARGET_ENV', 'staging');
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://staging.next-bar.com');
    const result = robots();
    expect(result.rules).toMatchObject({ userAgent: '*', disallow: '/' });
  });
});
