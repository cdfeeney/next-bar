import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearAccountCache,
  clearResidualAccountCache,
  getCacheEpoch,
  guardAgainstForeignCache,
} from './accountCache';

const RATINGS_KEY = 'next-bar:ratings:v1';
const RATINGS_MERGED_KEY = 'next-bar:ratings:merged-for:v1';
const PAIRWISE_KEY = 'next-bar:pairwise:v1';
const PAIRWISE_MERGED_KEY = 'next-bar:pairwise:merged-for:v1';

function seedFullCache(owner: string): void {
  window.localStorage.setItem(RATINGS_KEY, '[{"barId":"attaboy"}]');
  window.localStorage.setItem(RATINGS_MERGED_KEY, owner);
  window.localStorage.setItem(PAIRWISE_KEY, '[{"winnerBarId":"a"}]');
  window.localStorage.setItem(PAIRWISE_MERGED_KEY, owner);
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

  it('wipes the cache when a merged-for flag shows a past sign-in (expired session residue)', () => {
    seedFullCache('user-a');
    expect(clearResidualAccountCache()).toBe(true);
    expect(window.localStorage.getItem(RATINGS_KEY)).toBeNull();
    expect(window.localStorage.getItem(PAIRWISE_KEY)).toBeNull();
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
