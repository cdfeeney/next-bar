import { describe, expect, test } from 'vitest';
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

  // The compliance-critical default: without owned media and with Google
  // live OFF, we fall back to the legacy cache — and it is LABELLED as
  // Google-derived rather than passed off as ours.
  test('falls back to legacy cache, labelled honestly', () => {
    const d = resolveMedia(bar(), []);
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
