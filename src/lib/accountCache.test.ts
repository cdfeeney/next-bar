import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearAccountCache,
  clearResidualAccountCache,
  getCacheEpoch,
  guardAgainstForeignCache,
  writeCacheOwner,
} from './accountCache';

const RATINGS_KEY = 'next-bar:ratings:v1';
const RATINGS_MERGED_KEY = 'next-bar:ratings:merged-for:v1';
const PAIRWISE_KEY = 'next-bar:pairwise:v1';
const PAIRWISE_MERGED_KEY = 'next-bar:pairwise:merged-for:v1';
const FOLLOWS_KEY = 'next-bar:follows:v1';

function seedFullCache(owner: string): void {
  window.localStorage.setItem(RATINGS_KEY, '[{"barId":"attaboy"}]');
  window.localStorage.setItem(RATINGS_MERGED_KEY, owner);
  window.localStorage.setItem(PAIRWISE_KEY, '[{"winnerBarId":"a"}]');
  window.localStorage.setItem(PAIRWISE_MERGED_KEY, owner);
  window.localStorage.setItem(FOLLOWS_KEY, '["claire"]');
}

describe('clearAccountCache', () => {
  beforeEach(() => window.localStorage.clear());

  it('removes ratings, pairwise, and both merged-for flags', () => {
    seedFullCache('user-a');
    clearAccountCache();
    expect(window.localStorage.getItem(RATINGS_KEY)).toBeNull();
    expect(window.localStorage.getItem(RATINGS_MERGED_KEY)).toBeNull();
    expect(window.localStorage.getItem(PAIRWISE_KEY)).toBeNull();
    expect(window.localStorage.getItem(PAIRWISE_MERGED_KEY)).toBeNull();
  });

  it('removes the follows key — B3 registered it as a synced surface', () => {
    // Blueprint rule: when a surface becomes server-synced its localStorage
    // keys join ALL_KEYS, or the cross-account guard silently skips them.
    seedFullCache('user-a');
    clearAccountCache();
    expect(window.localStorage.getItem(FOLLOWS_KEY)).toBeNull();
  });

  it('leaves unrelated keys alone', () => {
    window.localStorage.setItem('next-bar:profile:v1', '{"tags":[]}');
    clearAccountCache();
    expect(window.localStorage.getItem('next-bar:profile:v1')).not.toBeNull();
  });

  it('bumps the cache epoch so in-flight hydrates abandon their writes', () => {
    // The sign-out race: an async hydrate captures the epoch before its
    // fetch; a wipe during the fetch must invalidate the pending write.
    const before = getCacheEpoch();
    clearAccountCache();
    expect(getCacheEpoch()).toBe(before + 1);
  });
});

describe('clearResidualAccountCache', () => {
  beforeEach(() => window.localStorage.clear());

  it('preserves a V7 upgrade whose import sentinels predate explicit ownership', () => {
    seedFullCache('user-a');
    expect(clearResidualAccountCache()).toBe(false);
    expect(window.localStorage.getItem(RATINGS_KEY)).not.toBeNull();
    expect(window.localStorage.getItem(PAIRWISE_KEY)).not.toBeNull();
    expect(window.localStorage.getItem(FOLLOWS_KEY)).not.toBeNull();
  });

  it('leaves a genuinely anonymous cache alone (no flags → no past sign-in)', () => {
    window.localStorage.setItem(RATINGS_KEY, '[{"barId":"attaboy"}]');
    expect(clearResidualAccountCache()).toBe(false);
    expect(window.localStorage.getItem(RATINGS_KEY)).not.toBeNull();
  });
});

describe('guardAgainstForeignCache', () => {
  beforeEach(() => window.localStorage.clear());

  it('preserves an anonymous cache (no merged-for flags) — first sign-in merge is intended', () => {
    window.localStorage.setItem(RATINGS_KEY, '[{"barId":"attaboy"}]');
    expect(guardAgainstForeignCache('user-b')).toBe(false);
    expect(window.localStorage.getItem(RATINGS_KEY)).not.toBeNull();
  });

  it('preserves the cache when the flags name the current user', () => {
    seedFullCache('user-a');
    expect(guardAgainstForeignCache('user-a')).toBe(false);
    expect(window.localStorage.getItem(RATINGS_KEY)).not.toBeNull();
  });

  it('wipes everything when the ratings flag names a different user', () => {
    seedFullCache('user-a');
    expect(guardAgainstForeignCache('user-b')).toBe(true);
    expect(window.localStorage.getItem(RATINGS_KEY)).toBeNull();
    expect(window.localStorage.getItem(PAIRWISE_KEY)).toBeNull();
    expect(window.localStorage.getItem(RATINGS_MERGED_KEY)).toBeNull();
  });

  it('wipes everything when only the pairwise flag is foreign', () => {
    window.localStorage.setItem(PAIRWISE_MERGED_KEY, 'user-a');
    window.localStorage.setItem(RATINGS_KEY, '[{"barId":"attaboy"}]');
    expect(guardAgainstForeignCache('user-b')).toBe(true);
    expect(window.localStorage.getItem(RATINGS_KEY)).toBeNull();
  });
});

describe('cache ownership is separate from the import latch', () => {
  const OWNER_KEY = 'next-bar:account:owner:v1';

  beforeEach(() => window.localStorage.clear());

  it('writeCacheOwner records the account without claiming the import finished', () => {
    // The whole point of the split: a failed import must still leave the
    // cache owned, so the guards fire, WITHOUT marking the import done.
    writeCacheOwner('user-a');
    expect(window.localStorage.getItem(OWNER_KEY)).toBe('user-a');
    expect(window.localStorage.getItem(RATINGS_MERGED_KEY)).toBeNull();
    expect(window.localStorage.getItem(PAIRWISE_MERGED_KEY)).toBeNull();
  });

  it('a foreign owner wipes the cache even with no merged-for latch', () => {
    window.localStorage.setItem(RATINGS_KEY, '[{"barId":"attaboy"}]');
    writeCacheOwner('user-a');
    expect(guardAgainstForeignCache('user-b')).toBe(true);
    expect(window.localStorage.getItem(RATINGS_KEY)).toBeNull();
  });

  it('the current owner keeps the cache', () => {
    window.localStorage.setItem(RATINGS_KEY, '[{"barId":"attaboy"}]');
    writeCacheOwner('user-a');
    expect(guardAgainstForeignCache('user-a')).toBe(false);
    expect(window.localStorage.getItem(RATINGS_KEY)).not.toBeNull();
  });

  it('an owner key alone counts as residue on a signed-out resolution', () => {
    window.localStorage.setItem(RATINGS_KEY, '[{"barId":"attaboy"}]');
    writeCacheOwner('user-a');
    expect(clearResidualAccountCache()).toBe(true);
    expect(window.localStorage.getItem(RATINGS_KEY)).toBeNull();
  });

  it('clearAccountCache removes the owner key too', () => {
    writeCacheOwner('user-a');
    clearAccountCache();
    expect(window.localStorage.getItem(OWNER_KEY)).toBeNull();
  });

  it('still honours a legacy device that has only the old latches', () => {
    // Upgrading from V7/early-V8: merged-for exists, owner key does not.
    window.localStorage.setItem(RATINGS_KEY, '[{"barId":"attaboy"}]');
    window.localStorage.setItem(RATINGS_MERGED_KEY, 'user-a');
    expect(guardAgainstForeignCache('user-b')).toBe(true);
    expect(window.localStorage.getItem(RATINGS_KEY)).toBeNull();
  });
});
