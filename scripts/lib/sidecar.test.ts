import { describe, expect, test } from 'vitest';
import { SERVICE_AREA_BBOX } from '@/lib/constants';
import {
  DB_ONLY_SIDECAR_IDS,
  SERVICE_AREA,
  assertSidecarWritable,
  insideServiceArea,
  locationAcceptable,
  mergeOnlyPatches,
} from './sidecar.mjs';

/**
 * BEHAVIOURAL tests for the sidecar invariants.
 *
 * These replace source-text greps in bars.test.ts that asserted the generator
 * *contained* certain strings. Those greps passed while three real defects were
 * live — they would still have passed with dead code, a removed `continue`, or
 * any of the bypasses /review-routed found. Grepping for a guard is not the same
 * as exercising it.
 *
 * The logic lives in scripts/lib/sidecar.mjs precisely so it can be imported:
 * refresh-places.mjs has top-level side effects (unattended-loop guard, API-key
 * check, process.exit) and cannot be loaded by a test at all.
 */

const KNOWN = new Set(['attaboy', 'the-bonnie']);

describe('insideServiceArea', () => {
  test('mirrors SERVICE_AREA_BBOX exactly', () => {
    // The generator cannot import the TypeScript constant, so it holds a copy.
    // This is the only thing preventing silent divergence.
    expect(SERVICE_AREA).toEqual(SERVICE_AREA_BBOX);
  });

  test('accepts a point inside and rejects one outside', () => {
    expect(insideServiceArea(40.7188, -73.9913)).toBe(true);
    // Nassau County — the real 2026-07-23 wrong-venue match.
    expect(insideServiceArea(40.7, -73.6)).toBe(false);
  });

  test.each([
    ['minLat', SERVICE_AREA.minLat, -73.99, true],
    ['maxLat', SERVICE_AREA.maxLat, -73.99, true],
    ['just below minLat', SERVICE_AREA.minLat - 0.0001, -73.99, false],
    ['just above maxLat', SERVICE_AREA.maxLat + 0.0001, -73.99, false],
  ])('boundary: %s', (_label, lat, lng, expected) => {
    expect(insideServiceArea(lat as number, lng as number)).toBe(expected);
  });
});

describe('locationAcceptable fails CLOSED', () => {
  // The main refresh path used to write an unchecked patch when Google omitted
  // `location`, because the guard only ran when both coordinates were present.
  // An unchecked write is indistinguishable from a checked one once it is filed.
  test.each([
    ['undefined', undefined],
    ['null', null],
    ['empty object', {}],
    ['latitude only', { latitude: 40.72 }],
    ['non-numeric', { latitude: '40.72', longitude: '-73.99' }],
  ])('rejects a location that is %s', (_label, location) => {
    expect(locationAcceptable(location as never)).toBe(false);
  });

  test('accepts a real in-area location', () => {
    expect(locationAcceptable({ latitude: 40.7188, longitude: -73.9913 })).toBe(true);
  });

  test('rejects an in-range-looking but out-of-area location', () => {
    expect(locationAcceptable({ latitude: 40.7, longitude: -73.6 })).toBe(false);
  });
});

describe('assertSidecarWritable', () => {
  test('accepts a clean patch set', () => {
    expect(() =>
      assertSidecarWritable(
        { attaboy: { googlePlaceId: 'ChIJx', hours: {} } },
        KNOWN,
      ),
    ).not.toThrow();
  });

  test('THROWS on a persisted coordinate, naming the offender', () => {
    // The compliance invariant: Google allows 30 days, this file ships forever.
    expect(() =>
      assertSidecarWritable({ attaboy: { googlePlaceId: 'ChIJx', lat: 40.72 } }, KNOWN),
    ).toThrow(/attaboy\.lat/);
  });

  test('throws on lng as well as lat', () => {
    expect(() =>
      assertSidecarWritable({ attaboy: { lng: -73.99 } }, KNOWN),
    ).toThrow(/attaboy\.lng/);
  });

  test('THROWS on an orphan id', () => {
    // 29 orphans accumulated unnoticed because nothing checked.
    expect(() =>
      assertSidecarWritable({ 'ghost-bar': { googlePlaceId: 'ChIJx' } }, KNOWN),
    ).toThrow(/orphan/i);
  });

  test('allows a DB-only id from the shared allowlist', () => {
    const [dbOnly] = [...DB_ONLY_SIDECAR_IDS];
    expect(dbOnly).toBeTruthy();
    expect(() =>
      assertSidecarWritable({ [dbOnly]: { googlePlaceId: 'ChIJx' } }, KNOWN),
    ).not.toThrow();
  });

  test('rejects a non-object entry rather than writing garbage', () => {
    expect(() => assertSidecarWritable({ attaboy: null }, KNOWN)).toThrow(/not an object/);
  });
});

describe('mergeOnlyPatches — the --only regression', () => {
  /**
   * The defect this exists for: under --only the writer did
   * `{ ...existing, ...patches }`. A bar failing the location check hit
   * `continue`, so patches[id] was never set — and the spread PRESERVED its
   * stale entry. The guard perpetuated exactly the patch it was meant to reject.
   */
  test('DELETES a rejected bar rather than carrying it forward', () => {
    const existing = {
      attaboy: { googlePlaceId: 'ChIJgood' },
      'the-bonnie': { googlePlaceId: 'ChIJwrong-venue' },
    };
    const merged = mergeOnlyPatches(existing, {}, new Set(['the-bonnie']));

    expect(merged['the-bonnie']).toBeUndefined();
    // …while every untargeted bar survives, which is why --only merges at all.
    expect(merged.attaboy).toEqual({ googlePlaceId: 'ChIJgood' });
  });

  test('a fresh patch still overwrites the existing entry', () => {
    const merged = mergeOnlyPatches(
      { attaboy: { googlePlaceId: 'old' } },
      { attaboy: { googlePlaceId: 'new' } },
    );
    expect(merged.attaboy).toEqual({ googlePlaceId: 'new' });
  });

  test('rejection wins even if a patch was somehow also produced', () => {
    const merged = mergeOnlyPatches(
      { attaboy: { googlePlaceId: 'old' } },
      { attaboy: { googlePlaceId: 'new' } },
      new Set(['attaboy']),
    );
    expect(merged.attaboy).toBeUndefined();
  });

  test('no rejections behaves as a plain merge', () => {
    const merged = mergeOnlyPatches({ a: { x: 1 } } as never, { b: { y: 2 } } as never);
    expect(Object.keys(merged).sort()).toEqual(['a', 'b']);
  });
});
