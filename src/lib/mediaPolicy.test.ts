import { afterEach, describe, expect, test, vi } from 'vitest';
import { defaultMediaFlags, resolveFallbackMedia, resolveMedia, type OwnedPhoto } from './mediaPolicy';

const bar = { id: 'attaboy', googlePlaceId: 'ChIJtest', photoRef: 'old-photo', photoCount: 3 };
const venue: OwnedPhoto[] = [{ url: '/media/venue.webp', source: 'venue', isPrimary: true }];
afterEach(() => vi.unstubAllEnvs());

describe('Places UI Kit media policy', () => {
  test.each([undefined, '', '0', 'false', 'true'])('live requests stay off for %s', value => {
    vi.stubEnv('NEXT_PUBLIC_GOOGLE_MEDIA', value);
    expect(defaultMediaFlags()).toEqual({ googleLive: false });
    expect(resolveMedia(bar)).toEqual({ source: 'glyph' });
  });

  test('the retired legacy flag cannot reopen cached photos', () => {
    vi.stubEnv('NEXT_PUBLIC_LEGACY_PHOTOS', '1');
    vi.stubEnv('NEXT_PUBLIC_GOOGLE_MEDIA', '0');
    expect(resolveMedia(bar)).toEqual({ source: 'glyph' });
    vi.stubEnv('NEXT_PUBLIC_GOOGLE_MEDIA', '1');
    expect(resolveMedia(bar)).toEqual({ source: 'google-live', placeId: 'ChIJtest' });
    expect(resolveMedia({ ...bar, googlePlaceId: undefined })).toEqual({ source: 'glyph' });
    expect(resolveFallbackMedia(bar)).toEqual({ source: 'glyph' });
  });

  test('owned media takes priority and sorts the primary first without mutating input', () => {
    const photos: OwnedPhoto[] = [
      ...venue,
      { url: '/media/secondary.webp', source: 'nextbar', isPrimary: false },
      { url: '/media/primary.webp', source: 'nextbar', isPrimary: true },
    ];
    const before = [...photos];
    expect(resolveMedia(bar, photos, { googleLive: true })).toEqual({
      source: 'nextbar', urls: ['/media/primary.webp', '/media/secondary.webp'],
    });
    expect(photos).toEqual(before);
  });

  test('venue media beats user media and survives a widget failure', () => {
    const photos: OwnedPhoto[] = [{ url: '/media/user.webp', source: 'user', isPrimary: true }, ...venue];
    expect(resolveMedia(bar, photos, { googleLive: true })).toEqual({ source: 'venue', urls: ['/media/venue.webp'] });
    expect(resolveFallbackMedia(bar, photos)).toEqual({ source: 'venue', urls: ['/media/venue.webp'] });
    expect(resolveMedia(bar, photos.slice(0, 1))).toEqual({ source: 'user', urls: ['/media/user.webp'] });
  });

  test('request flags do not leak between callers', () => {
    expect(resolveMedia(bar, [], { googleLive: true }).source).toBe('google-live');
    expect(resolveMedia(bar, [], { googleLive: false }).source).toBe('glyph');
  });
});
