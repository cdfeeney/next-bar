import { describe, expect, it } from 'vitest';
import {
  buildMapsHref,
  buildPickPath,
  buildProfilePath,
  isShareAbort,
  sharePickText,
  shareProfileText,
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

describe('buildProfilePath', () => {
  it('builds the profile path from the handle', () => {
    expect(buildProfilePath('connor')).toBe('/u/connor');
  });

  it('URL-encodes handles defensively', () => {
    expect(buildProfilePath('we ird')).toBe('/u/we%20ird');
  });
});

describe('shareProfileText', () => {
  it('leads with the display name when there is one', () => {
    expect(shareProfileText('connor', 'Connor F')).toBe(
      "Connor F's bar list, ranked. On Next Bar.",
    );
  });

  it('falls back to the @handle when no display name', () => {
    expect(shareProfileText('connor')).toBe(
      "@connor's bar list, ranked. On Next Bar.",
    );
  });

  it('treats a null display name as absent', () => {
    expect(shareProfileText('connor', null)).toContain('@connor');
  });

  it('treats a whitespace-only display name as absent', () => {
    expect(shareProfileText('connor', '   ')).toContain('@connor');
  });

  it('trims a padded display name rather than emitting the padding', () => {
    expect(shareProfileText('connor', '  Connor F  ')).toBe(
      "Connor F's bar list, ranked. On Next Bar.",
    );
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

  /**
   * Deliberately inverted 2026-07-26 (DeepSeek review). This previously
   * asserted NotAllowedError => false, i.e. "fall through and write the
   * clipboard". That is the wrong side of an asymmetric bet: Firefox
   * Android has reported share-sheet CANCEL as NotAllowedError, and Chrome
   * raises it when transient user activation is missing. Guessing
   * "dismissed" costs a no-op; guessing "failed" silently writes to the
   * user's clipboard after they backed out — the exact bug this app
   * already shipped once (audit MED-16).
   */
  it('is true for NotAllowedError — treated as dismissal, never clipboard', () => {
    expect(isShareAbort(new DOMException('denied', 'NotAllowedError'))).toBe(
      true,
    );
  });

  it('is false for genuine share failures (clipboard fallback allowed)', () => {
    expect(isShareAbort(new TypeError('Invalid share payload'))).toBe(false);
    expect(isShareAbort(new DOMException('bad data', 'DataError'))).toBe(false);
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
