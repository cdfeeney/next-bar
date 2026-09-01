import { beforeEach, describe, expect, it } from 'vitest';
import {
  ackRatingDirty,
  clearAccountCache,
  clearRatingsDirty,
  clearResidualAccountCache,
  destroyAccountDataOnDeletion,
  getCacheEpoch,
  getDirtyRatingEntries,
  getDirtyRatingIds,
  guardAgainstForeignCache,
  isSealDeferred,
  markRatingDirty,
  readCacheOwner,
  sealAccountCacheOnSignOut,
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

  it('wipes an owned cache whose imports all completed', () => {
    seedFullCache('user-a');
    writeCacheOwner('user-a');
    expect(clearResidualAccountCache()).toBe(true);
    expect(window.localStorage.getItem(RATINGS_KEY)).toBeNull();
    expect(window.localStorage.getItem(PAIRWISE_KEY)).toBeNull();
    expect(window.localStorage.getItem(FOLLOWS_KEY)).toBeNull();
    // The owner marker SURVIVES the residual clear (V8-2 round-3): it is what
    // lets a later foreign sign-in wipe the personal FOREIGN_ONLY_KEYS.
    // Removing it made post-expiry devices look anonymous.
    expect(readCacheOwner()).toBe('user-a');
  });

  it('never wipes ratings over a non-empty dirty journal — those writes were never acked', () => {
    // Round-3: latch === owner said "synced" while a failed fire-and-forget
    // upsert said otherwise. The journal is the tiebreaker.
    seedFullCache('user-a');
    writeCacheOwner('user-a');
    markRatingDirty('attaboy', '2026-05-10T00:00:00.000Z');
    expect(clearResidualAccountCache()).toBe(false);
    expect(window.localStorage.getItem(RATINGS_KEY)).not.toBeNull();
    // Acked → disposable again.
    ackRatingDirty('attaboy', '2026-05-10T00:00:00.000Z');
    expect(clearResidualAccountCache()).toBe(true);
  });

  it('clears per surface: a pending ratings row does not keep the synced pairwise cache (round-4)', () => {
    seedFullCache('user-a');
    writeCacheOwner('user-a');
    markRatingDirty('attaboy', '2026-05-10T00:00:00.000Z');
    expect(clearResidualAccountCache()).toBe(false);
    // Ratings (pending) survive; pairwise + follows (synced) are cleared.
    expect(window.localStorage.getItem(RATINGS_KEY)).not.toBeNull();
    expect(window.localStorage.getItem(PAIRWISE_KEY)).toBeNull();
    expect(window.localStorage.getItem(FOLLOWS_KEY)).toBeNull();
  });

  it('never wipes ratings whose import never completed — those rows exist nowhere else', () => {
    // The reported loss: the upload failed (no latch) but the fetch succeeded,
    // so the hydrate wrote the owner key. Expiry must not delete the rows.
    window.localStorage.setItem(RATINGS_KEY, '[{"barId":"attaboy"}]');
    writeCacheOwner('user-a');
    expect(clearResidualAccountCache()).toBe(false);
    expect(window.localStorage.getItem(RATINGS_KEY)).not.toBeNull();
    // The owner key stays, so a foreign sign-in still wipes this cache.
    expect(guardAgainstForeignCache('user-b')).toBe(true);
    expect(window.localStorage.getItem(RATINGS_KEY)).toBeNull();
  });

  it('never wipes a pairwise transcript whose import never completed', () => {
    window.localStorage.setItem(RATINGS_KEY, '[{"barId":"attaboy"}]');
    window.localStorage.setItem(RATINGS_MERGED_KEY, 'user-a');
    window.localStorage.setItem(PAIRWISE_KEY, '[{"winnerBarId":"a"}]');
    writeCacheOwner('user-a');
    expect(clearResidualAccountCache()).toBe(false);
    expect(window.localStorage.getItem(PAIRWISE_KEY)).not.toBeNull();
  });

  it('an empty payload is not a pending import — it has nothing to lose', () => {
    window.localStorage.setItem(RATINGS_KEY, '[]');
    window.localStorage.setItem(PAIRWISE_KEY, '[]');
    window.localStorage.setItem(FOLLOWS_KEY, '["claire"]');
    writeCacheOwner('user-a');
    expect(clearResidualAccountCache()).toBe(true);
    expect(window.localStorage.getItem(FOLLOWS_KEY)).toBeNull();
  });

  it('a whitespace or pretty-printed empty array is still empty', () => {
    // String-comparing against '[]' missed these and jammed the wipe forever.
    window.localStorage.setItem(RATINGS_KEY, '[\n  \n]');
    window.localStorage.setItem(PAIRWISE_KEY, '  [ ]  ');
    writeCacheOwner('user-a');
    expect(clearResidualAccountCache()).toBe(true);
  });

  it('a corrupt payload is not treated as rows worth blocking a wipe for', () => {
    window.localStorage.setItem(RATINGS_KEY, '{not json');
    writeCacheOwner('user-a');
    expect(clearResidualAccountCache()).toBe(true);
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

  it('an owner key counts as residue once the import that owns it completed', () => {
    // Was "an owner key ALONE counts as residue" — that encoded the round-1
    // defect. Data present with no matching latch has never reached the
    // server, so it is a pending import, not disposable residue; the latch is
    // what makes the wipe safe.
    window.localStorage.setItem(RATINGS_KEY, '[{"barId":"attaboy"}]');
    window.localStorage.setItem(RATINGS_MERGED_KEY, 'user-a');
    writeCacheOwner('user-a');
    expect(clearResidualAccountCache()).toBe(true);
    expect(window.localStorage.getItem(RATINGS_KEY)).toBeNull();
  });

  it('sign-out seal: clears synced data but keeps the owner marker', () => {
    // Round-3, all four lanes: removing the owner at sign-out handed the
    // personal FOREIGN_ONLY_KEYS to whoever signed in next.
    seedFullCache('user-a');
    writeCacheOwner('user-a');
    sealAccountCacheOnSignOut();
    expect(window.localStorage.getItem(RATINGS_KEY)).toBeNull();
    expect(readCacheOwner()).toBe('user-a');
    // The surviving owner is exactly what makes the next foreign sign-in
    // wipe the personal keys.
    window.localStorage.setItem('next-bar:lists:v1', '[{"id":"faves"}]');
    expect(guardAgainstForeignCache('user-b')).toBe(true);
    expect(window.localStorage.getItem('next-bar:lists:v1')).toBeNull();
  });

  /**
   * THE DELETION-UNCERTAINTY LATCH IS DROPPED ONLY WHERE THE SESSION IS GONE.
   *
   * Two rounds, two different mistakes, and the pair below pins the boundary
   * between them. First the key was merely registered in ALL_KEYS, which does
   * nothing here — this function clears by EXPLICIT LIST and only
   * clearAccountCache iterates ALL_KEYS — so the latch outlived every sign-out
   * and an account that demonstrably came back stayed permanently uncertain.
   * Then it was removed here unconditionally, on the argument that reaching
   * the danger zone again requires a real sign-in. That argument is false for
   * the SEAL: useAuth.signOut seals whatever supabase.auth.signOut() returned,
   * and a failed sign-out resolves with { error } while keeping the session —
   * so the danger zone stays mounted with the latch deleted, and the next
   * retry reprints the false "nothing was removed".
   *
   * The rule that survives both: the seal is not evidence of anything, and the
   * paths that ARE — useAuth's getSession()-empty and SIGNED_OUT handlers,
   * which call clearResidualAccountCache directly — take the default and clear
   * it. A successful button sign-out reaches those too.
   */
  it('sign-out seal: KEEPS the latch, because the session may still be alive', () => {
    window.localStorage.setItem(
      'next-bar:account:deletion-uncertain:v1',
      'user-a',
    );
    writeCacheOwner('user-a');
    sealAccountCacheOnSignOut();
    expect(
      window.localStorage.getItem('next-bar:account:deletion-uncertain:v1'),
    ).toBe('user-a');
  });

  it('a residual clear — the no-session path — DOES drop the latch', () => {
    // This is what useAuth calls when getSession() comes back empty or a
    // SIGNED_OUT event arrives. There the session is demonstrably gone, and a
    // later sign-in proves the account exists, so the uncertainty is over.
    window.localStorage.setItem(
      'next-bar:account:deletion-uncertain:v1',
      'user-a',
    );
    writeCacheOwner('user-a');
    clearResidualAccountCache();
    expect(
      window.localStorage.getItem('next-bar:account:deletion-uncertain:v1'),
    ).toBeNull();
  });

  it('a residual clear COMPLETING a deferred seal keeps the latch', () => {
    // useRatings calls clearResidualAccountCache when a pending ack lands
    // after a seal that had to keep rows. That is a continuation of the seal,
    // carrying the same lack of evidence about whether the session ended — and
    // it cannot pass a flag, because src/hooks/ is another lane's. Enforcing
    // it here means every caller is covered by one rule.
    window.localStorage.setItem(RATINGS_KEY, '[{"barId":"attaboy"}]');
    writeCacheOwner('user-a');
    sealAccountCacheOnSignOut(); // defers: the unsynced row is kept
    expect(isSealDeferred()).toBe(true);

    window.localStorage.setItem(
      'next-bar:account:deletion-uncertain:v1',
      'user-a',
    );
    clearResidualAccountCache();
    expect(
      window.localStorage.getItem('next-bar:account:deletion-uncertain:v1'),
    ).toBe('user-a');
  });

  it('the residual clear drops the latch even when pending rows defer the rest', () => {
    // The removal must not be hostage to the ratings/pairwise pending checks —
    // an unsynced rating has nothing to do with whether a deletion attempt was
    // left open.
    window.localStorage.setItem(RATINGS_KEY, '[{"barId":"attaboy"}]');
    window.localStorage.setItem(
      'next-bar:account:deletion-uncertain:v1',
      'user-a',
    );
    writeCacheOwner('user-a');
    clearResidualAccountCache();
    expect(window.localStorage.getItem(RATINGS_KEY)).not.toBeNull();
    expect(
      window.localStorage.getItem('next-bar:account:deletion-uncertain:v1'),
    ).toBeNull();
  });

  it('sign-out seal: keeps rows whose import never completed', () => {
    // Round-3 (Claude high): explicit sign-out destroyed local rows that had
    // never reached the server. Sealed instead: kept under the latched owner.
    window.localStorage.setItem(RATINGS_KEY, '[{"barId":"attaboy"}]');
    writeCacheOwner('user-a');
    sealAccountCacheOnSignOut();
    expect(window.localStorage.getItem(RATINGS_KEY)).not.toBeNull();
    expect(readCacheOwner()).toBe('user-a');
  });

  it('sign-out seal: keeps rows with an unacked write even when latched', () => {
    seedFullCache('user-a');
    writeCacheOwner('user-a');
    markRatingDirty('attaboy', '2026-05-10T00:00:00.000Z');
    sealAccountCacheOnSignOut();
    expect(window.localStorage.getItem(RATINGS_KEY)).not.toBeNull();
  });

  it('a deferred seal is remembered until the pending ack completes the clear (cycle-3)', () => {
    // The ack callback consults this flag instead of React state — the auth
    // change reaches hook refs one render late, and an ack in that gap used
    // to skip the deferred cleanup entirely.
    seedFullCache('user-a');
    writeCacheOwner('user-a');
    markRatingDirty('attaboy', '2026-05-10T00:00:00.000Z');
    sealAccountCacheOnSignOut();
    expect(isSealDeferred()).toBe(true);
    // The ack lands: journal empties, the deferred clear now succeeds.
    ackRatingDirty('attaboy', '2026-05-10T00:00:00.000Z');
    expect(clearResidualAccountCache()).toBe(true);
    expect(isSealDeferred()).toBe(false);
    expect(window.localStorage.getItem(RATINGS_KEY)).toBeNull();
  });

  it('a cross-tab/expiry sign-out defers exactly like the button seal (cycle-3 closing, both lanes)', () => {
    // useAuth's non-button sign-out paths call clearResidualAccountCache
    // directly — the flag must be set THERE, or the ack-vs-auth-transition
    // gap re-opens for every sign-out that is not the button.
    seedFullCache('user-a');
    writeCacheOwner('user-a');
    markRatingDirty('attaboy', '2026-05-10T00:00:00.000Z');
    expect(clearResidualAccountCache()).toBe(false); // pending kept
    expect(isSealDeferred()).toBe(true);
    ackRatingDirty('attaboy', '2026-05-10T00:00:00.000Z');
    expect(clearResidualAccountCache()).toBe(true);
    expect(isSealDeferred()).toBe(false);
  });

  it('a clean seal or a new owner claim clears the deferred flag', () => {
    seedFullCache('user-a');
    writeCacheOwner('user-a');
    markRatingDirty('attaboy', '2026-05-10T00:00:00.000Z');
    sealAccountCacheOnSignOut();
    expect(isSealDeferred()).toBe(true);
    writeCacheOwner('user-a'); // session claims ownership again
    expect(isSealDeferred()).toBe(false);
  });

  it('account deletion destroys everything: account cache, owner, AND personal keys (round-4)', () => {
    // clearAccountCache alone removed the ownership signal but left the
    // personal keys — the next account passed the foreign guard and
    // inherited the deleted user's lists/night history/profile.
    seedFullCache('user-a');
    writeCacheOwner('user-a');
    window.localStorage.setItem('next-bar:lists:v1', '[{"id":"faves"}]');
    window.localStorage.setItem('next-bar:night-log:v1', '{"night":"2026-08-12"}');
    window.localStorage.setItem('next-bar:profile:v1', '{"archetype":"x"}');
    destroyAccountDataOnDeletion();
    expect(readCacheOwner()).toBeNull();
    expect(window.localStorage.getItem(RATINGS_KEY)).toBeNull();
    expect(window.localStorage.getItem('next-bar:lists:v1')).toBeNull();
    expect(window.localStorage.getItem('next-bar:night-log:v1')).toBeNull();
    expect(window.localStorage.getItem('next-bar:profile:v1')).toBeNull();
  });

  it('account deletion drops the deleted user’s parked night-out record', () => {
    // Round-2 panel (Codex, medium). V8-3b moved the parked "created but never
    // opened" record from sessionStorage to localStorage so it survives a tab
    // close. That made it durable residue: the deleted account’s user id and
    // plan uuid outlived the strongest erase the app offers.
    const STARTED = 'next-bar:started-night-out:v1';
    window.localStorage.setItem(
      STARTED,
      JSON.stringify({
        'user-a': { planId: 'plan-a', nightKey: '2026-08-17' },
        'user-b': { planId: 'plan-b', nightKey: '2026-08-17' },
      }),
    );
    destroyAccountDataOnDeletion('user-a');
    const left = JSON.parse(window.localStorage.getItem(STARTED) as string);
    expect(left['user-a'], "the deleted account's plan pointer survived deletion").toBeUndefined();
    // The other account on this device still has a plan it created and has not
    // opened. Wiping it would re-arm THEIR Start button over an existing plan,
    // which is the duplicate-plan defect this record exists to prevent.
    expect(left['user-b']).toEqual({ planId: 'plan-b', nightKey: '2026-08-17' });
  });

  it('account deletion removes the parked key entirely when it was the only account', () => {
    const STARTED = 'next-bar:started-night-out:v1';
    window.localStorage.setItem(
      STARTED,
      JSON.stringify({ 'user-a': { planId: 'plan-a', nightKey: '2026-08-17' } }),
    );
    destroyAccountDataOnDeletion('user-a');
    expect(window.localStorage.getItem(STARTED)).toBeNull();
  });

  it('account deletion with no known user id clears the parked key outright', () => {
    const STARTED = 'next-bar:started-night-out:v1';
    window.localStorage.setItem(
      STARTED,
      JSON.stringify({ 'user-a': { planId: 'plan-a', nightKey: '2026-08-17' } }),
    );
    destroyAccountDataOnDeletion();
    expect(window.localStorage.getItem(STARTED)).toBeNull();
  });

  it('account deletion erases a MALFORMED parked value instead of leaving it', () => {
    // Round-3 panel (Codex, medium). Truncated JSON still contains the deleted
    // user's id and plan id in plaintext; JSON.parse threw into a catch that
    // removed nothing, so the identifiers survived the strongest erase.
    const STARTED = 'next-bar:started-night-out:v1';
    window.localStorage.setItem(
      STARTED,
      '{"user-a":{"planId":"plan-a","nightKey":"2026-08-1',
    );
    destroyAccountDataOnDeletion('user-a');
    expect(
      window.localStorage.getItem(STARTED),
      'a truncated value kept the deleted account’s identifiers on the device',
    ).toBeNull();
  });

  it('sign-out seal: no-op on an anonymous device, but always bumps the epoch', () => {
    window.localStorage.setItem(RATINGS_KEY, '[{"barId":"attaboy"}]');
    const before = getCacheEpoch();
    sealAccountCacheOnSignOut();
    expect(window.localStorage.getItem(RATINGS_KEY)).not.toBeNull();
    expect(getCacheEpoch()).toBeGreaterThan(before);
  });

  it('a foreign sign-in wipes the dirty journal with the rest of the cache', () => {
    writeCacheOwner('user-a');
    markRatingDirty('attaboy', '2026-05-10T00:00:00.000Z');
    expect(guardAgainstForeignCache('user-b')).toBe(true);
    expect(getDirtyRatingIds()).toEqual([]);
  });

  it('an older ack cannot clear a newer write — stamps, not counts (round-4)', () => {
    // Two writes race one ack across tabs: the count journal collapsed them
    // and the older ack erased the newer write's protection.
    markRatingDirty('attaboy', '2026-05-10T00:00:00.000Z');
    markRatingDirty('attaboy', '2026-05-10T00:00:05.000Z'); // newer tap
    ackRatingDirty('attaboy', '2026-05-10T00:00:00.000Z'); // older ack — no-op
    expect(getDirtyRatingIds()).toEqual(['attaboy']);
    ackRatingDirty('attaboy', '2026-05-10T00:00:05.000Z');
    expect(getDirtyRatingIds()).toEqual([]);
  });

  it('entries carry their op — a delete intent reads back as one', () => {
    markRatingDirty('attaboy', '2026-05-10T00:00:00.000Z', 'd');
    expect(getDirtyRatingEntries()).toEqual([
      { barId: 'attaboy', stamp: '2026-05-10T00:00:00.000Z', op: 'd' },
    ]);
  });

  it('clearRatingsDirty removes entries outright', () => {
    markRatingDirty('attaboy', '2026-05-10T00:00:00.000Z');
    markRatingDirty('dante', '2026-05-11T00:00:00.000Z');
    clearRatingsDirty(['attaboy']);
    expect(getDirtyRatingIds()).toEqual(['dante']);
  });

  it('a corrupt journal reads as empty instead of jamming the wipe', () => {
    window.localStorage.setItem('next-bar:dirty:v1', '{not json');
    expect(getDirtyRatingIds()).toEqual([]);
    writeCacheOwner('user-a');
    window.localStorage.setItem(RATINGS_KEY, '[{"barId":"attaboy"}]');
    window.localStorage.setItem(RATINGS_MERGED_KEY, 'user-a');
    expect(clearResidualAccountCache()).toBe(true);
  });

  it('clearAccountCache removes the owner key too', () => {
    writeCacheOwner('user-a');
    clearAccountCache();
    expect(window.localStorage.getItem(OWNER_KEY)).toBeNull();
  });

  it('a foreign sign-in also clears the previous user’s lists, profile, and night history', () => {
    // Not in ALL_KEYS on purpose: an ordinary sign-out must keep the device
    // owner's own data. A foreign sign-in is the one path where the device has
    // demonstrably changed hands.
    window.localStorage.setItem('next-bar:lists:v1', '[{"id":"faves"}]');
    window.localStorage.setItem('next-bar:profile:v1', '{"archetype":"x"}');
    window.localStorage.setItem('next-bar:night-log:v1', '{"night":"2026-08-12"}');
    window.localStorage.setItem('next-bar:saved:v1', '[{"barId":"attaboy"}]');
    writeCacheOwner('user-a');
    expect(guardAgainstForeignCache('user-b')).toBe(true);
    expect(window.localStorage.getItem('next-bar:lists:v1')).toBeNull();
    expect(window.localStorage.getItem('next-bar:profile:v1')).toBeNull();
    expect(window.localStorage.getItem('next-bar:night-log:v1')).toBeNull();
    expect(window.localStorage.getItem('next-bar:saved:v1')).toBeNull();
  });

  it('an ordinary sign-out keeps the device owner’s lists and night history', () => {
    window.localStorage.setItem('next-bar:lists:v1', '[{"id":"faves"}]');
    window.localStorage.setItem('next-bar:night-log:v1', '{"night":"2026-08-12"}');
    writeCacheOwner('user-a');
    clearAccountCache();
    expect(window.localStorage.getItem('next-bar:lists:v1')).not.toBeNull();
    expect(window.localStorage.getItem('next-bar:night-log:v1')).not.toBeNull();
  });

  it('still honours a legacy device that has only the old latches', () => {
    // Upgrading from V7/early-V8: merged-for exists, owner key does not.
    window.localStorage.setItem(RATINGS_KEY, '[{"barId":"attaboy"}]');
    window.localStorage.setItem(RATINGS_MERGED_KEY, 'user-a');
    expect(guardAgainstForeignCache('user-b')).toBe(true);
    expect(window.localStorage.getItem(RATINGS_KEY)).toBeNull();
  });
});
