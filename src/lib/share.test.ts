import { describe, expect, it } from 'vitest';
import {
  buildMapsHref,
  buildPickPath,
  isShareAbort,
  sharePickText,
} from '@/lib/share';
import type { Bar } from '@/types';

const bar: Bar = {
  id: 'death-and-co',
  name: 'Death & Co',
  neighborhood: 'East Village',
  address: '433 E 6th St, New York, NY',
  lat: 40.7264,
  lng: -73.9843,
  priceTier: 3,
  tags: ['cocktail'],
  blurb: 'Pioneering cocktail den.',
  lastVerified: '2026-04-01',
};

describe('buildPickPath', () => {
  it('builds the share path from the bar id', () => {
    expect(buildPickPath('death-and-co')).toBe('/share/death-and-co');
  });

  it('URL-encodes ids defensively', () => {
    expect(buildPickPath('weird id')).toBe('/share/weird%20id');
  });
});

describe('sharePickText', () => {
  it('names the bar and neighborhood', () => {
    const text = sharePickText(bar);
    expect(text).toContain('Death & Co');
    expect(text).toContain('East Village');
  });
});

describe('isShareAbort', () => {
  it('is true for an AbortError (user dismissed the share sheet)', () => {
    const err = new Error('Share canceled');
    err.name = 'AbortError';
    expect(isShareAbort(err)).toBe(true);
  });

  it('is true for a DOMException named AbortError', () => {
    expect(isShareAbort(new DOMException('canceled', 'AbortError'))).toBe(
      true,
    );
  });

  it('is false for other share failures (clipboard fallback allowed)', () => {
    expect(isShareAbort(new TypeError('Invalid share payload'))).toBe(false);
    expect(isShareAbort(new DOMException('denied', 'NotAllowedError'))).toBe(
      false,
    );
  });

  it('is false for non-Error rejections', () => {
    expect(isShareAbort('AbortError')).toBe(false);
    expect(isShareAbort(undefined)).toBe(false);
  });
});

describe('buildMapsHref', () => {
  it('builds a Google Maps search link from name + address', () => {
    const href = buildMapsHref(bar);
    expect(href).toBe(
      'https://www.google.com/maps/search/?api=1&query=' +
        encodeURIComponent('Death & Co 433 E 6th St, New York, NY'),
    );
  });

  it('URL-encodes the query so specials like & survive', () => {
    const href = buildMapsHref(bar);
    expect(href).not.toContain('Death & Co');
    expect(href).toContain('Death%20%26%20Co');
  });
});
