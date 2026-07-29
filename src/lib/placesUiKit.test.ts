import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
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

/**
 * The CONFIGURED path — script injection, polling, timeout, grace window.
 *
 * santa-loop round 2 (both reviewers, independently): every previous test here
 * short-circuited on the unconfigured branch, so none of them ever created a
 * script tag or started a timer. The exact race the module's comments describe
 * as a shipped production bug had ZERO coverage. These tests drive the real
 * path by stubbing the key check.
 */
describe('loadPlacesUiKit when configured', () => {
  let mod: typeof import('./placesUiKit');

  const setSdkPresent = () => {
    (window as unknown as Record<string, unknown>).google = {
      maps: { importLibrary: () => Promise.resolve({}) },
    };
  };
  const clearSdk = () => {
    delete (window as unknown as Record<string, unknown>).google;
  };
  const scripts = () => document.querySelectorAll('script[data-nextbar-maps]');

  let savedKey: string | undefined;

  beforeEach(async () => {
    clearSdk();
    document.head.querySelectorAll('script[data-nextbar-maps]').forEach((s) => s.remove());

    // API_KEY is captured at module init, so the env must be set BEFORE the
    // import. A vi.doMock of this module would not work: loadPlacesUiKit calls
    // isPlacesUiKitConfigured intra-module, which a module mock never intercepts.
    savedKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
    process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY = 'test-key';
    vi.resetModules();
    mod = await import('./placesUiKit');
    mod.__resetLoader();
    expect(mod.isPlacesUiKitConfigured()).toBe(true); // guard: not a vacuous suite
  });

  afterEach(() => {
    if (savedKey === undefined) delete process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
    else process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY = savedKey;
    vi.useRealTimers();
    clearSdk();
  });

  test('resolves true immediately when the SDK is already present', async () => {
    setSdkPresent();
    await expect(mod.loadPlacesUiKit()).resolves.toBe(true);
    // Nothing to inject — the SDK was already there.
    expect(scripts()).toHaveLength(0);
  });

  test('injects exactly ONE script tag, and a retry reuses it', async () => {
    vi.useFakeTimers();

    // Attempt 1: nothing ever arrives, so it times out past the grace window.
    const first = mod.loadPlacesUiKit();
    expect(scripts()).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(
      mod.SDK_LOAD_TIMEOUT_MS + mod.SDK_LOAD_GRACE_MS + 500,
    );
    await expect(first).resolves.toBe(false);

    // Attempt 2 must NOT append a second tag — the round-2 duplicate-injection
    // defect. It reuses the in-flight one and keeps polling.
    const second = mod.loadPlacesUiKit();
    expect(scripts()).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(
      mod.SDK_LOAD_TIMEOUT_MS + mod.SDK_LOAD_GRACE_MS + 500,
    );
    await expect(second).resolves.toBe(false);
    expect(scripts()).toHaveLength(1);
  });

  test('a LATE arrival inside the grace window still succeeds', async () => {
    vi.useFakeTimers();
    const pending = mod.loadPlacesUiKit();

    // Land the SDK after the nominal deadline but inside the grace window —
    // the round-2 "post-timeout arrival silently discarded" defect.
    await vi.advanceTimersByTimeAsync(mod.SDK_LOAD_TIMEOUT_MS + 200);
    setSdkPresent();
    await vi.advanceTimersByTimeAsync(500);

    await expect(pending).resolves.toBe(true);
  });

  /**
   * Regression, santa-loop round 3.
   *
   * Polling only ever waited for `importLibrary` to EXIST. Once it did, the code
   * handed off to a promise with no timeout of its own and stopped re-arming the
   * poll, so a partial CDN failure — main script served, library fetch stalls —
   * left this permanently unsettled. A probe advanced 60 simulated seconds with
   * the promise still pending.
   */
  test('a hanging importLibrary resolves false instead of hanging forever', async () => {
    vi.useFakeTimers();
    // Present, but its import never settles.
    (window as unknown as Record<string, unknown>).google = {
      maps: { importLibrary: () => new Promise(() => {}) },
    };

    const pending = mod.loadPlacesUiKit();
    let settled = false;
    void pending.then(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(mod.IMPORT_TIMEOUT_MS - 100);
    expect(settled, 'settled too early').toBe(false);

    await vi.advanceTimersByTimeAsync(500);
    await expect(pending).resolves.toBe(false);
  });

  test('MAX_LOAD_MS actually bounds the worst case', () => {
    // Callers arm their own safety timer against this, so it must equal the sum
    // of the phases rather than being an independently drifting guess.
    expect(mod.MAX_LOAD_MS).toBe(
      mod.SDK_LOAD_TIMEOUT_MS + mod.SDK_LOAD_GRACE_MS + mod.IMPORT_TIMEOUT_MS,
    );
  });

  test('a script network error fails fast and removes the tag so a retry can try again', async () => {
    vi.useFakeTimers();
    const pending = mod.loadPlacesUiKit();
    const tag = document.querySelector('script[data-nextbar-maps]') as HTMLScriptElement;
    expect(tag).toBeTruthy();

    tag.onerror?.(new Event('error'));
    await expect(pending).resolves.toBe(false);
    // Removed, so a later attempt is not blocked by a dead tag.
    expect(scripts()).toHaveLength(0);
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
