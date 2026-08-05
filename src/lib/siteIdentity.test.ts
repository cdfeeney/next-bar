import { describe, expect, it } from 'vitest';
import { isPublicOrigin, resolveSiteUrl } from '@/lib/siteIdentity';

describe('resolveSiteUrl', () => {
  it('prefers NEXT_PUBLIC_SITE_URL and normalizes to the origin', () => {
    expect(
      resolveSiteUrl({
        NEXT_PUBLIC_SITE_URL: 'https://next-bar.com/',
        VERCEL_URL: 'preview.vercel.app',
      }),
    ).toBe('https://next-bar.com');
  });

  it('a BLANK explicit value falls through to the Vercel identity', () => {
    expect(
      resolveSiteUrl({
        NEXT_PUBLIC_SITE_URL: '  ',
        VERCEL_PROJECT_PRODUCTION_URL: 'next-bar-two.vercel.app',
      }),
    ).toBe('https://next-bar-two.vercel.app');
  });

  it('an unparseable value falls through instead of propagating', () => {
    expect(
      resolveSiteUrl({
        NEXT_PUBLIC_SITE_URL: 'not a url',
        VERCEL_URL: 'deploy.vercel.app',
      }),
    ).toBe('https://deploy.vercel.app');
  });

  it('falls back to localhost dev origin with nothing set', () => {
    expect(resolveSiteUrl({})).toBe(
      'http://localhost:3000',
    );
  });

  it('rejects opaque schemes whose origin is the string "null"', () => {
    expect(
      resolveSiteUrl({
        NEXT_PUBLIC_SITE_URL: 'mailto:hi@example.com',
        VERCEL_URL: 'deploy.vercel.app',
      }),
    ).toBe('https://deploy.vercel.app');
  });
});

describe('isPublicOrigin', () => {
  it('accepts a public https origin', () => {
    expect(isPublicOrigin('https://next-bar.com')).toBe(true);
  });
  it.each([
    'http://localhost:3000',
    'https://localhost',
    'https://foo.localhost',
    'https://127.0.0.1',
    'https://127.0.0.2',
    'https://[::1]',
    'https://0.0.0.0',
    'https://10.1.2.3',
    'https://192.168.1.10',
    'https://172.16.5.5',
    'https://169.254.0.1',
    'https://printer.local',
    'https://100.64.0.1',
    'https://[fd12:3456::1]',
    'https://[fe80::1]',
    'https://[::ffff:10.0.0.1]',
    'https://[::]',
    'http://next-bar.com',
    'garbage',
  ])('rejects %s', (origin) => {
    expect(isPublicOrigin(origin)).toBe(false);
  });
});
