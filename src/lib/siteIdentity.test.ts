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
});

describe('isPublicOrigin', () => {
  it('accepts a public https origin', () => {
    expect(isPublicOrigin('https://next-bar.com')).toBe(true);
  });
  it.each(['http://localhost:3000', 'https://localhost', 'https://127.0.0.1', 'http://next-bar.com', 'garbage'])(
    'rejects %s',
    (origin) => {
      expect(isPublicOrigin(origin)).toBe(false);
    },
  );
});
