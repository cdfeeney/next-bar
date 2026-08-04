// @vitest-environment jsdom
import { beforeEach, describe, expect, test, vi } from 'vitest';
import {
  claimSessionPinSeed,
  getSessionPinnedBarId,
  getSessionPinRevision,
  isSessionPinSeedCurrent,
  releaseSessionPinSeed,
  resetSessionPin,
  setSessionPinnedBarId,
  subscribeSessionPin,
} from '@/lib/pinSignal';
import { clearAccountCache } from '@/lib/accountCache';

describe('pinSignal — session store', () => {
  beforeEach(() => {
    resetSessionPin();
  });

  test('set/get round-trip and change notification', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeSessionPin(listener);
    setSessionPinnedBarId('attaboy');
    expect(getSessionPinnedBarId()).toBe('attaboy');
    expect(listener).toHaveBeenCalledTimes(1);
    // Same value → no re-notify (useSyncExternalStore churn guard).
    setSessionPinnedBarId('attaboy');
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    setSessionPinnedBarId(null);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  test('seed latch: one claim per key; release re-opens; reset clears', () => {
    expect(claimSessionPinSeed('u1:0:2026-08-03')).toBe(true);
    // Second surface mounting must NOT fetch again.
    expect(claimSessionPinSeed('u1:0:2026-08-03')).toBe(false);
    expect(isSessionPinSeedCurrent('u1:0:2026-08-03')).toBe(true);
    // Failed fetch releases so a later mount retries.
    releaseSessionPinSeed('u1:0:2026-08-03');
    expect(claimSessionPinSeed('u1:0:2026-08-03')).toBe(true);
    // A different key (new epoch/night) supersedes.
    expect(claimSessionPinSeed('u1:1:2026-08-03')).toBe(true);
    expect(isSessionPinSeedCurrent('u1:0:2026-08-03')).toBe(false);
    // Reset clears the latch entirely.
    resetSessionPin();
    expect(isSessionPinSeedCurrent('u1:1:2026-08-03')).toBe(false);
  });

  test('stale release (superseded key) is a no-op', () => {
    claimSessionPinSeed('a');
    claimSessionPinSeed('b');
    releaseSessionPinSeed('a');
    expect(isSessionPinSeedCurrent('b')).toBe(true);
  });

  test('revision bumps on EVERY authoritative write, even same-value — a delayed snapshot can detect user actions', () => {
    const before = getSessionPinRevision();
    setSessionPinnedBarId('attaboy'); // the user pins while a seed is in flight
    expect(getSessionPinRevision()).toBe(before + 1);
    // Same-value write is STILL a user action (round-3 scoped review,
    // Codex lane): re-pinning the bar the store already shows must
    // invalidate an in-flight stale seed, so the revision advances…
    const listener = vi.fn();
    const unsubscribe = subscribeSessionPin(listener);
    setSessionPinnedBarId('attaboy');
    expect(getSessionPinRevision()).toBe(before + 2);
    // …while listeners are NOT re-notified (no render churn).
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });
});

describe('pinSignal — account lifecycle (round-2 review HIGH)', () => {
  test('clearAccountCache wipes the pinned bar AND the seed latch', () => {
    setSessionPinnedBarId('attaboy');
    claimSessionPinSeed('u1:0:2026-08-03');
    clearAccountCache();
    // The next account must see NO residue of the previous pin…
    expect(getSessionPinnedBarId()).toBeNull();
    // …and must be able to re-seed from ITS OWN server truth.
    expect(claimSessionPinSeed('u2:1:2026-08-03')).toBe(true);
  });

  test('an in-flight seed is abandoned by a wipe (guard the async gap)', () => {
    claimSessionPinSeed('u1:0:2026-08-03');
    clearAccountCache();
    // The fetch that started under the old key resolves late: the seed
    // key is no longer current, so the writer must drop the result.
    expect(isSessionPinSeedCurrent('u1:0:2026-08-03')).toBe(false);
  });
});
