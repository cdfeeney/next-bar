import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  defaultMediaFlags,
  needsGoogleAttribution,
  resolveMedia,
  type MediaFlags,
  type OwnedPhoto,
} from './mediaPolicy';
import type { Bar } from '@/types';

const bar = (over: Partial<Bar> = {}): Pick<Bar, 'id' | 'photoRef' | 'photoCount' | 'googlePlaceId'> => ({
  id: 'attaboy',
  photoRef: 'places/x/photos/y',
  photoCount: 3,
  googlePlaceId: 'ChIJtest',
  ...over,
});

const owned = (source: OwnedPhoto['source'], n = 1): OwnedPhoto[] =>
  Array.from({ length: n }, (_, i) => ({
    url: `/media/${source}-${i}.webp`,
    source,
    isPrimary: i === 0,
  }));

const FLAGS = (over: Partial<MediaFlags> = {}): MediaFlags => ({
  googleLive: false,
  legacyCache: true,
  ...over,
});

/**
 * Both flags must be FAIL-CLOSED: absent or malformed configuration can never
 * serve Google-derived media.
 *
 * legacyCache was `!== '0'` until 2026-07-29, i.e. opt-OUT — the ~3,435
 * re-hosted Google photo files served whenever the variable was missing. The
 * variable was in fact set NOWHERE in the repo, so the non-compliant path was
 * the live default. These tests set process.env explicitly rather than relying
 * on ambient state, because .env.local now sets the opt-in for dev and a test
 * that merely observed the ambient value would pass for the wrong reason.
 */
describe('defaultMediaFlags is fail-closed', () => {
  const KEYS = ['NEXT_PUBLIC_LEGACY_PHOTOS', 'NEXT_PUBLIC_GOOGLE_MEDIA'] as const;
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });
  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  test('absent config serves NO Google media of either kind', () => {
    expect(defaultMediaFlags()).toEqual({ googleLive: false, legacyCache: false });
  });

  // The rollback case: a build predating the variable compiles it in as
  // undefined and serves legacy photos for that build's entire life.
  test.each(['', 'false', 'FALSE', 'off', 'no', '0', 'true', 'yes'])(
    'legacy photos stay OFF for a reasonable-looking value %o',
    (value) => {
      process.env.NEXT_PUBLIC_LEGACY_PHOTOS = value;
      expect(defaultMediaFlags().legacyCache).toBe(false);
    },
  );

  test("exactly '1' is the only opt-in", () => {
    process.env.NEXT_PUBLIC_LEGACY_PHOTOS = '1';
    process.env.NEXT_PUBLIC_GOOGLE_MEDIA = '1';
    expect(defaultMediaFlags()).toEqual({ googleLive: true, legacyCache: true });
  });

  test('a bar with legacy photos resolves to glyph under absent config', () => {
    // The end-to-end consequence: no /bar-photos/ URL is ever produced, so the
    // default path issues zero requests for the non-compliant files.
    const d = resolveMedia(bar(), [], defaultMediaFlags());
    expect(d).toEqual({ source: 'glyph' });
    expect(JSON.stringify(d)).not.toContain('bar-photos');
  });
});

describe('resolveMedia priority', () => {
  test('owned Next Bar media beats everything', () => {
    const d = resolveMedia(bar(), [...owned('user'), ...owned('nextbar')]);
    expect(d).toEqual({ source: 'nextbar', urls: ['/media/nextbar-0.webp'] });
  });

  test('venue media beats user media', () => {
    const d = resolveMedia(bar(), [...owned('user'), ...owned('venue')]);
    expect(d.source).toBe('venue');
  });

  test('primary photo sorts first within a source', () => {
    const photos: OwnedPhoto[] = [
      { url: '/b.webp', source: 'venue', isPrimary: false },
      { url: '/a.webp', source: 'venue', isPrimary: true },
    ];
    const d = resolveMedia(bar(), photos);
    expect(d).toEqual({ source: 'venue', urls: ['/a.webp', '/b.webp'] });
  });

  // When the legacy cache IS opted into, it is LABELLED as Google-derived
  // rather than passed off as ours, and it demands attribution.
  //
  // Flags are explicit here on purpose. This used to call resolveMedia(bar(), [])
  // and lean on the ambient default, which silently encoded "legacy photos are
  // on unless told otherwise" — the fail-open behaviour removed on 2026-07-29.
  // The labelling/attribution guarantee is what this test is for; the default is
  // pinned separately in the fail-closed suite above.
  test('falls back to legacy cache, labelled honestly', () => {
    const d = resolveMedia(bar(), [], FLAGS({ legacyCache: true }));
    expect(d.source).toBe('legacy-google-cached');
    expect(needsGoogleAttribution(d)).toBe(true);
  });

  test('google live is OFF by default even with a place id', () => {
    expect(resolveMedia(bar(), []).source).not.toBe('google-live');
  });

  test('enabling google live outranks the legacy cache', () => {
    expect(resolveMedia(bar(), [], FLAGS({ googleLive: true }))).toEqual({
      source: 'google-live',
      placeId: 'ChIJtest',
    });
  });

  // The kill switch that makes deletion a cleanup instead of a cutover.
  test('killing the legacy cache degrades to a glyph, not a broken image', () => {
    expect(resolveMedia(bar(), [], FLAGS({ legacyCache: false }))).toEqual({
      source: 'glyph',
    });
  });

  test('both switches off with no owned media = glyph', () => {
    expect(
      resolveMedia(bar(), [], FLAGS({ legacyCache: false, googleLive: false })),
    ).toEqual({ source: 'glyph' });
  });

  test('owned media survives both kill switches', () => {
    const d = resolveMedia(
      bar(),
      owned('venue'),
      FLAGS({ legacyCache: false, googleLive: false }),
    );
    expect(d.source).toBe('venue');
    expect(needsGoogleAttribution(d)).toBe(false);
  });

  test('a bar with no photos at all is a glyph', () => {
    const d = resolveMedia(bar({ photoRef: undefined, photoCount: 0 }), []);
    expect(d).toEqual({ source: 'glyph' });
  });

  test('google live needs a place id to be selectable', () => {
    const d = resolveMedia(
      bar({ googlePlaceId: undefined, photoRef: undefined, photoCount: 0 }),
      [],
      FLAGS({ googleLive: true }),
    );
    expect(d).toEqual({ source: 'glyph' });
  });

  // Regression (review 2026-07-27): flags must NOT live in module scope.
  // On the server, Next.js module state is process-global and shared by
  // every concurrent request, so a mutable flag would let one request
  // silently change what another renders.
  test('flag choices do not leak between calls', () => {
    const off = resolveMedia(bar(), [], FLAGS({ legacyCache: false }));
    const on = resolveMedia(bar(), [], FLAGS({ legacyCache: true }));
    expect(off.source).toBe('glyph');
    expect(on.source).toBe('legacy-google-cached');
    // and the default is recomputed per call, never cached
    expect(defaultMediaFlags().googleLive).toBe(false);
  });
});
