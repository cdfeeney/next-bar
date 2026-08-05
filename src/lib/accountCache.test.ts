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
const FOLLOWS_KEY = 'next-bar:follows:v1';
const PROFILE_KEY = 'next-bar:profile:v1';
const PROFILE_MERGED_KEY = 'next-bar:profile:merged-for:v1';

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

  it('removes the shared-nights token record and the night archive — g-919dae84 registered them', () => {
    // Shared-night tokens mirror the account's server rows; the archive is
    // 60 nights of whereabouts — both are exactly what must not leak to the
    // next account on a shared device (santa: Opus, g-919 round 1 — a
    // future ALL_KEYS edit must not silently drop either).
    window.localStorage.setItem(
      'next-bar:shared-nights:v1',
      JSON.stringify({ '2026-08-01': { token: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', sharedAt: 'x' } }),
    );
    window.localStorage.setItem(
      'next-bar:night-archive:v1',
      JSON.stringify([{ nightKey: '2026-08-01', visits: [{ barId: 'attaboy', at: 'x' }] }]),
    );
    clearAccountCache();
    expect(window.localStorage.getItem('next-bar:shared-nights:v1')).toBeNull();
    expect(window.localStorage.getItem('next-bar:night-archive:v1')).toBeNull();
  });

  it('leaves unrelated keys alone', () => {
    // Exemplar changed from the vibe profile to the age acknowledgement (G1).
    // This test's PURPOSE — clearAccountCache is scoped to ALL_KEYS and does
    // not nuke arbitrary storage — is unchanged and asserted at equal
    // strength. Only the exemplar moved, because the vibe profile stopped
    // being "unrelated" the moment it became a server-synced surface. The
    // age-ack is a genuinely unrelated compliance flag: it belongs to the
    // DEVICE, not the account, and must survive a sign-out.
    window.localStorage.setItem('next-bar:age-ack:v1', '1');
    clearAccountCache();
    expect(window.localStorage.getItem('next-bar:age-ack:v1')).not.toBeNull();
  });

  it('removes the vibe profile and its ownership marker — G1 registered them', () => {
    // Same blueprint rule as the follows key above: a surface that becomes
    // server-synced joins ALL_KEYS or the cross-account guard silently skips
    // it. Registering the profile means sign-out DELETES it locally, which is
    // deliberate: an anonymous browser must not keep showing the previous
    // account's taste profile on a shared phone.
    window.localStorage.setItem(PROFILE_KEY, '{"tags":[],"savedAt":"x"}');
    window.localStorage.setItem(PROFILE_MERGED_KEY, 'user-a');
    clearAccountCache();
    expect(window.localStorage.getItem(PROFILE_KEY)).toBeNull();
    expect(window.localStorage.getItem(PROFILE_MERGED_KEY)).toBeNull();
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

  it('wipes everything when only the PROFILE flag is foreign (G1)', () => {
    // The cross-account isolation criterion. Account A synced a profile and
    // left; account B signs in on the same browser. B must never see or
    // upload A's profile — and the wipe stays GLOBAL, because a proven
    // foreign marker means this whole cache is someone else's residue.
    window.localStorage.setItem(PROFILE_MERGED_KEY, 'user-a');
    window.localStorage.setItem(PROFILE_KEY, '{"tags":["dive"],"savedAt":"x"}');
    window.localStorage.setItem(RATINGS_KEY, '[{"barId":"attaboy"}]');
    expect(guardAgainstForeignCache('user-b')).toBe(true);
    expect(window.localStorage.getItem(PROFILE_KEY)).toBeNull();
    expect(window.localStorage.getItem(PROFILE_MERGED_KEY)).toBeNull();
    expect(window.localStorage.getItem(RATINGS_KEY)).toBeNull();
  });

  it('preserves an anonymous profile — first sign-in upload is intended', () => {
    // No marker anywhere = genuine pre-first-sign-in data. Wiping it here
    // would destroy the quiz result of someone who just made an account.
    window.localStorage.setItem(PROFILE_KEY, '{"tags":["dive"],"savedAt":"x"}');
    expect(guardAgainstForeignCache('user-b')).toBe(false);
    expect(window.localStorage.getItem(PROFILE_KEY)).not.toBeNull();
  });
});

describe('clearResidualAccountCache — profile marker (G1)', () => {
  beforeEach(() => window.localStorage.clear());

  it('treats a lone profile marker as account residue', () => {
    // A user who took the quiz and rated nothing still left account residue.
    // Before G1 the profile marker was the one ownership signal the residual
    // guard could not see, so this session's data looked anonymous.
    window.localStorage.setItem(PROFILE_MERGED_KEY, 'user-a');
    window.localStorage.setItem(PROFILE_KEY, '{"tags":[],"savedAt":"x"}');
    expect(clearResidualAccountCache()).toBe(true);
    expect(window.localStorage.getItem(PROFILE_KEY)).toBeNull();
  });
});
