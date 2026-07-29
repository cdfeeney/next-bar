import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  __resetLoader,
  __resetRequested,
  __retainedForTests,
  billableEventCount,
  hasRequested,
  isPlacesUiKitConfigured,
  loadPlacesUiKit,
  markRequested,
  requestedCount,
} from './placesUiKit';

/**
 * The SDK seam. These tests pin the two properties that cost money if wrong:
 * absent configuration must never attempt a request, and every failure path must
 * resolve false so the caller degrades to a glyph rather than throwing.
 */

describe('isPlacesUiKitConfigured', () => {
  // Fail-closed, exactly like the media flags. A deploy missing the key would
  // otherwise inject a script tag that 403s on every single card.
  test('is false when no API key is configured', () => {
    // NEXT_PUBLIC_GOOGLE_MAPS_API_KEY is inlined at build time and is unset in
    // this repo, so the honest assertion is that we are NOT configured yet.
    expect(isPlacesUiKitConfigured()).toBe(false);
  });
});

describe('loadPlacesUiKit', () => {
  beforeEach(() => __resetLoader());
  afterEach(() => __resetLoader());

  test('resolves false rather than throwing when unconfigured', async () => {
    await expect(loadPlacesUiKit()).resolves.toBe(false);
  });

  test('is single-flight — repeated calls share one promise', async () => {
    const a = loadPlacesUiKit();
    const b = loadPlacesUiKit();
    expect(a).toBe(b);
    await expect(a).resolves.toBe(false);
  });

  /**
   * Regression, santa-loop round 1.
   *
   * A FAILED load must not be memoized. The 5s timeout and the script callback
   * race to settle one module-level promise; when the timer won on a transient
   * slow network the promise was permanently `false`, the script's later
   * resolve(true) was a silent no-op, and every card for the rest of the session
   * rendered a glyph even though window.google.maps was available. One blip
   * killed Google photos session-wide with no retry path.
   */
  test('a failed load is NOT memoized, so a later call can retry', async () => {
    const first = loadPlacesUiKit();
    await expect(first).resolves.toBe(false);

    const second = loadPlacesUiKit();
    expect(second).not.toBe(first);
    await expect(second).resolves.toBe(false);
  });

  test('never injects a script tag while unconfigured', async () => {
    const before = document.querySelectorAll('script[src*="maps.googleapis.com"]').length;
    await loadPlacesUiKit();
    const after = document.querySelectorAll('script[src*="maps.googleapis.com"]').length;
    expect(after).toBe(before);
  });
});

describe('the request meter', () => {
  beforeEach(() => __resetRequested());

  test('records that we asked, and counts distinct place_ids', () => {
    expect(requestedCount()).toBe(0);
    markRequested('ChIJa');
    markRequested('ChIJb');
    markRequested('ChIJa');
    expect(requestedCount()).toBe(2);
    expect(hasRequested('ChIJa')).toBe(true);
    expect(hasRequested('ChIJz')).toBe(false);
  });

  /**
   * The compliance guarantee, pinned as a test because it is the exact mistake
   * that produced public/bar-photos/ in the first place: both routed reviewers
   * recommended "a cache keyed on placeId", and if anyone later implements that
   * as a byte cache we recreate the violation. The meter may retain place_id —
   * the one value Google exempts — and nothing else.
   */
  test('retains only place_id, never any Google content', () => {
    // This test was VACUOUS until santa-loop review: it filtered a
    // locally-constructed array rather than the module's real state, so it could
    // not have detected markRequested() being changed to retain Google content.
    // __retainedForTests() exposes the actual Set.
    markRequested('ChIJa');
    markRequested('ChIJb');

    const retained = __retainedForTests();
    expect(retained).toHaveLength(2);
    for (const value of retained) {
      expect(typeof value).toBe('string');
      // A place_id is an opaque token. Anything URL-ish or media-ish means
      // Google-returned CONTENT got retained, which is the violation.
      expect(String(value)).not.toMatch(/photo|https?:|\/|\.jpe?g|\.webp|places\//i);
    }
    expect(JSON.stringify(retained)).toBe('["ChIJa","ChIJb"]');
  });

  test('counts widget creations separately from distinct places', () => {
    // Google bills per widget created. Two cards sharing one googlePlaceId bill
    // twice while the distinct-id count says one, so reporting only the set size
    // would undercount real spend.
    markRequested('ChIJshared');
    markRequested('ChIJshared');
    markRequested('ChIJother');
    expect(requestedCount()).toBe(2);
    expect(billableEventCount()).toBe(3);
  });
});
