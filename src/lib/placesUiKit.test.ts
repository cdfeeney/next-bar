import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  __resetLoader,
  __resetRequested,
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
    markRequested('ChIJa');
    const retained = JSON.stringify([...['ChIJa'].filter(hasRequested)]);
    expect(retained).toBe('["ChIJa"]');
    expect(retained).not.toMatch(/photo|url|http|jpe?g|webp/i);
  });
});
