import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { syncVibeProfile, pushVibeProfile } from './vibeProfileSync';
import { loadProfile, readProfileOwner, writeProfile } from './storedProfile';
import { clearAccountCache, getCacheEpoch } from './accountCache';

/**
 * G1 — vibe profile server persistence.
 *
 * The bug: the quiz result lived only in localStorage, so it died on device
 * switch, storage clear, the Safari↔PWA boundary, and account switch.
 *
 * These tests cover the six scenarios the mission requires: anonymous use,
 * first sign-in, second-device hydration, cross-account isolation, conflict
 * handling (both directions + tie), and failed synchronization.
 */

const PROFILE_KEY = 'next-bar:profile:v1';
const PROFILE_MERGED_KEY = 'next-bar:profile:merged-for:v1';

const OLDER = '2026-07-01T00:00:00.000Z';
const NEWER = '2026-07-20T00:00:00.000Z';

function profileAt(savedAt: string, archetype = 'Dive devotee') {
  return {
    tags: ['dive' as const, 'locals' as const],
    preferredNeighborhoods: ['East Village' as const],
    archetype,
    savedAt,
  };
}

/**
 * Minimal Supabase stub covering exactly the two calls the module makes:
 *   .from('vibe_profiles').select(...).maybeSingle()
 *   .from('vibe_profiles').upsert(...)
 */
function stubSupabase(opts: {
  row?: { profile: unknown; saved_at: string } | null;
  selectError?: boolean;
  upsertError?: boolean;
}) {
  // Typed payload param so `upsert.mock.calls[0][0]` is inspectable — a
  // zero-arg vi.fn() has an empty calls tuple and cannot be asserted against.
  const upsert = vi.fn(async (_payload: { saved_at: string }) => ({
    error: opts.upsertError ? { message: 'network' } : null,
  }));
  const maybeSingle = vi.fn(async () => ({
    data: opts.selectError ? null : (opts.row ?? null),
    error: opts.selectError ? { message: 'network' } : null,
  }));
  // `delete` is part of the stub because a corrupt server row is now cleared
  // before re-uploading (an UPDATE cannot fix it — the LWW trigger would skip
  // any write older than the corrupt row's timestamp).
  const del = vi.fn(async () => ({ error: null }));
  const client = {
    from: vi.fn(() => ({
      select: vi.fn(() => ({ maybeSingle })),
      upsert,
      delete: vi.fn(() => ({ eq: del })),
    })),
  } as unknown as SupabaseClient;
  return { client, upsert, maybeSingle, del };
}

const always = () => true;

beforeEach(() => {
  window.localStorage.clear();
});

describe('anonymous use', () => {
  it('never touches the network and keeps the local profile', async () => {
    // The anonymous path must be completely unchanged by G1. The component
    // gate (auth.status !== 'signed-in') is what enforces this in the app;
    // here we prove the local store still round-trips on its own.
    writeProfile(profileAt(OLDER));
    expect(loadProfile()?.savedAt).toBe(OLDER);
    // No ownership marker is ever written without a sign-in.
    expect(readProfileOwner()).toBeNull();
  });
});

describe('first sign-in', () => {
  it('uploads an anonymous local profile and latches ownership', async () => {
    writeProfile(profileAt(OLDER));
    const { client, upsert } = stubSupabase({ row: null });

    const outcome = await syncVibeProfile({
      supabase: client,
      userId: 'user-a',
      stillCurrent: always,
    });

    expect(outcome).toBe('uploaded');
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(readProfileOwner()).toBe('user-a');
    // The uploaded row carries the SAME savedAt as local — re-stamping it
    // would make the two sides disagree about which write is newer.
    expect(upsert.mock.calls[0][0].saved_at).toBe(OLDER);
  });

  it('does NOT overwrite a newer server profile with stale local data', async () => {
    // The explicit criterion: first sign-in must not lose a newer server
    // profile just because this browser happens to hold an older one.
    writeProfile(profileAt(OLDER, 'stale local'));
    const { client, upsert } = stubSupabase({
      row: { profile: profileAt(NEWER, 'fresh server'), saved_at: NEWER },
    });

    const outcome = await syncVibeProfile({
      supabase: client,
      userId: 'user-a',
      stillCurrent: always,
    });

    expect(outcome).toBe('hydrated');
    expect(upsert).not.toHaveBeenCalled();
    expect(loadProfile()?.archetype).toBe('fresh server');
  });

  it('signs in with nothing anywhere without writing', async () => {
    const { client, upsert } = stubSupabase({ row: null });
    const outcome = await syncVibeProfile({
      supabase: client,
      userId: 'user-a',
      stillCurrent: always,
    });
    expect(outcome).toBe('nothing-to-sync');
    expect(upsert).not.toHaveBeenCalled();
    // Ownership IS latched: the fetch succeeded, so this browser demonstrably
    // belongs to this account. An unmarked cache is what the residual/foreign
    // guards treat as anonymous data and would hand to the next account.
    expect(readProfileOwner()).toBe('user-a');
  });
});

describe('second device hydration', () => {
  it('pulls the server profile into an empty browser', async () => {
    // This is the actual reported bug: a second device had no profile at all.
    expect(loadProfile()).toBeNull();
    const { client } = stubSupabase({
      row: { profile: profileAt(NEWER, 'Jazz lounge sophisticate'), saved_at: NEWER },
    });

    const outcome = await syncVibeProfile({
      supabase: client,
      userId: 'user-a',
      stillCurrent: always,
    });

    expect(outcome).toBe('hydrated');
    expect(loadProfile()).toEqual(profileAt(NEWER, 'Jazz lounge sophisticate'));
    expect(readProfileOwner()).toBe('user-a');
  });

  it('never hydrates a corrupt server row, and clears it', async () => {
    const { client, del } = stubSupabase({
      row: { profile: { tags: 'not-an-array' }, saved_at: NEWER },
    });
    const outcome = await syncVibeProfile({
      supabase: client,
      userId: 'user-a',
      stillCurrent: always,
    });
    // Nothing local to upload, so nothing is synced — but the corrupt row is
    // still removed rather than left to poison every future sync.
    expect(outcome).toBe('nothing-to-sync');
    expect(del).toHaveBeenCalledTimes(1);
    expect(loadProfile()).toBeNull();
  });
});

describe('corrupt server row does not deadlock the upload', () => {
  it('DELETES an invalid row so the upload lands as a fresh INSERT', async () => {
    // The deadlock this fixes: a malformed row at a NEWER saved_at than the
    // local profile. Collapsing invalid into 'absent' made the client upsert,
    // the LWW trigger silently skip the UPDATE (local is older), the
    // confirmation read report 'absent' again, and the sync return 'uploaded' —
    // forever, with the good local profile never reaching another device.
    writeProfile(profileAt(OLDER, 'good local'));

    const del = vi.fn(async () => ({ error: null }));
    let call = 0;
    const maybeSingle = vi.fn(async () => {
      call += 1;
      // First read: the corrupt row. After the delete: genuinely absent.
      return call === 1
        ? { data: { profile: { tags: 'not-an-array' }, saved_at: NEWER }, error: null }
        : { data: null, error: null };
    });
    const upsert = vi.fn(async (_p: { saved_at: string }) => ({ error: null }));
    const client = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({ maybeSingle })),
        upsert,
        delete: vi.fn(() => ({ eq: del })),
      })),
    } as unknown as SupabaseClient;

    const outcome = await syncVibeProfile({
      supabase: client,
      userId: 'user-a',
      stillCurrent: always,
    });

    expect(del).toHaveBeenCalledTimes(1);
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert.mock.calls[0][0].saved_at).toBe(OLDER);
    expect(outcome).toBe('uploaded');
    // The good local profile survives and is what got uploaded.
    expect(loadProfile()?.archetype).toBe('good local');
  });

  it('does not clear local data when the corrupt-row delete fails', async () => {
    writeProfile(profileAt(OLDER, 'good local'));
    const del = vi.fn(async () => ({ error: { code: '08006', message: 'network' } }));
    const maybeSingle = vi.fn(async () => ({
      data: { profile: { tags: 'not-an-array' }, saved_at: NEWER },
      error: null,
    }));
    const upsert = vi.fn(async (_p: { saved_at: string }) => ({ error: null }));
    const client = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({ maybeSingle })),
        upsert,
        delete: vi.fn(() => ({ eq: del })),
      })),
    } as unknown as SupabaseClient;

    const outcome = await syncVibeProfile({
      supabase: client,
      userId: 'user-a',
      stillCurrent: always,
    });

    expect(outcome).toBe('upload-failed');
    expect(upsert).not.toHaveBeenCalled();
    expect(loadProfile()?.archetype).toBe('good local');
  });
});

describe('a quiz finishing mid-upload is never clobbered', () => {
  it('keeps a profile saved DURING the upsert/confirm awaits', async () => {
    // uploadAndReconcile captured `local` before TWO awaits. A quiz completed
    // during them wrote a newer profile, and if the confirmed server row was
    // newer than the STALE snapshot the fresh quiz result was overwritten — and
    // if its own best-effort push had failed, it existed nowhere.
    const T1 = '2026-07-01T00:00:00.000Z'; // server, initially
    const T2 = '2026-07-10T00:00:00.000Z'; // our local at sync start
    const T3 = '2026-07-15T00:00:00.000Z'; // another device, mid-flight
    const T4 = '2026-07-20T00:00:00.000Z'; // the quiz that lands mid-flight

    writeProfile(profileAt(T2, 'our local'));

    let call = 0;
    const maybeSingle = vi.fn(async () => {
      call += 1;
      if (call === 1) {
        return { data: { profile: profileAt(T1, 'old server'), saved_at: T1 }, error: null };
      }
      // The confirmation read: another device's row, newer than our T2 snapshot
      // but OLDER than the quiz that just landed.
      return { data: { profile: profileAt(T3, 'other device'), saved_at: T3 }, error: null };
    });
    const upsert = vi.fn(async (_p: { saved_at: string }) => {
      // The quiz completes while the upsert is in flight.
      writeProfile(profileAt(T4, 'just finished quiz'));
      return { error: null };
    });
    const client = {
      from: vi.fn(() => ({ select: vi.fn(() => ({ maybeSingle })), upsert })),
    } as unknown as SupabaseClient;

    const outcome = await syncVibeProfile({
      supabase: client,
      userId: 'user-a',
      stillCurrent: always,
    });

    // The newest profile wins and survives locally.
    expect(loadProfile()?.archetype).toBe('just finished quiz');
    expect(loadProfile()?.savedAt).toBe(T4);
    expect(outcome).toBe('uploaded');
  });
});

describe('cross-account isolation', () => {
  it('a second account never uploads or displays the first account s profile', async () => {
    // Account A's synced residue is present WITH its marker.
    writeProfile(profileAt(OLDER, 'account A profile'));
    window.localStorage.setItem(PROFILE_MERGED_KEY, 'user-a');

    // The component runs guardAgainstForeignCache before syncing; that is the
    // step under test here, so invoke the same guard the component uses.
    const { guardAgainstForeignCache } = await import('./accountCache');
    expect(guardAgainstForeignCache('user-b')).toBe(true);
    expect(window.localStorage.getItem(PROFILE_KEY)).toBeNull();

    // Now B syncs against an empty server: nothing of A's can be uploaded.
    const { client, upsert } = stubSupabase({ row: null });
    const outcome = await syncVibeProfile({
      supabase: client,
      userId: 'user-b',
      stillCurrent: always,
    });

    expect(outcome).toBe('nothing-to-sync');
    expect(upsert).not.toHaveBeenCalled();
    expect(loadProfile()).toBeNull();
  });
});

describe('conflict handling', () => {
  it('local newer wins and is uploaded', async () => {
    writeProfile(profileAt(NEWER, 'offline retake'));
    const { client, upsert } = stubSupabase({
      row: { profile: profileAt(OLDER, 'old server'), saved_at: OLDER },
    });

    const outcome = await syncVibeProfile({
      supabase: client,
      userId: 'user-a',
      stillCurrent: always,
    });

    expect(outcome).toBe('uploaded');
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(loadProfile()?.archetype).toBe('offline retake');
  });

  it('server newer wins and is hydrated', async () => {
    writeProfile(profileAt(OLDER, 'old local'));
    const { client, upsert } = stubSupabase({
      row: { profile: profileAt(NEWER, 'new server'), saved_at: NEWER },
    });

    const outcome = await syncVibeProfile({
      supabase: client,
      userId: 'user-a',
      stillCurrent: always,
    });

    expect(outcome).toBe('hydrated');
    expect(upsert).not.toHaveBeenCalled();
    expect(loadProfile()?.archetype).toBe('new server');
  });

  it('a TIE resolves to the server AND writes the server payload', async () => {
    // Ties losing matches the 0033 vibe_profiles_lww trigger, which skips any
    // UPDATE that is not STRICTLY newer. If the client uploaded on a tie it
    // would believe it stored something the database silently dropped.
    //
    // But the tie must WRITE, not merely return: an equal savedAt with
    // DIFFERENT content would otherwise leave this device showing its own
    // variant forever while every other device shows the server's — silent,
    // permanent divergence reported as "in sync".
    writeProfile(profileAt(NEWER, 'local same-time'));
    const { client, upsert } = stubSupabase({
      row: { profile: profileAt(NEWER, 'server same-time'), saved_at: NEWER },
    });

    const outcome = await syncVibeProfile({
      supabase: client,
      userId: 'user-a',
      stillCurrent: always,
    });

    expect(outcome).toBe('in-sync');
    expect(upsert).not.toHaveBeenCalled();
    // The server's content now displays locally — the divergence is resolved.
    expect(loadProfile()?.archetype).toBe('server same-time');
    expect(readProfileOwner()).toBe('user-a');
  });

  it('adopts a newer concurrent row when the LWW trigger silently skips our write', async () => {
    // A no-error upsert means "request accepted", NOT "row stored": the 0033
    // trigger drops any UPDATE that is not strictly newer. If another device
    // wrote a newer row between our fetch and our upsert, reporting 'uploaded'
    // would leave this device on stale local data believing it had synced.
    const LATEST = '2026-07-25T00:00:00.000Z';
    writeProfile(profileAt(NEWER, 'our local'));

    // First read sees an older row (so we decide to upload); the confirmation
    // read sees the newer row another device wrote in the meantime.
    let call = 0;
    const maybeSingle = vi.fn(async () => {
      call += 1;
      return call === 1
        ? { data: { profile: profileAt(OLDER, 'old server'), saved_at: OLDER }, error: null }
        : { data: { profile: profileAt(LATEST, 'other device'), saved_at: LATEST }, error: null };
    });
    const upsert = vi.fn(async (_p: { saved_at: string }) => ({ error: null }));
    const client = {
      from: vi.fn(() => ({ select: vi.fn(() => ({ maybeSingle })), upsert })),
    } as unknown as SupabaseClient;

    const outcome = await syncVibeProfile({
      supabase: client,
      userId: 'user-a',
      stillCurrent: always,
    });

    expect(upsert).toHaveBeenCalledTimes(1);
    expect(outcome).toBe('hydrated');
    // The winner is adopted rather than silently ignored.
    expect(loadProfile()?.archetype).toBe('other device');
  });

  it('adopts the winner on a LOSING TIE after upload (equal savedAt, different content)', async () => {
    // Two devices upsert different content with the SAME savedAt. The first
    // lands as an INSERT (the LWW trigger only guards UPDATE); the second is
    // silently skipped and gets no error. The loser's confirmation read returns
    // the winner's content with an EQUAL savedAt, so a strictly-newer gate
    // would report 'uploaded' and leave this device showing content the server
    // does not hold. All four review lanes found this independently.
    writeProfile(profileAt(NEWER, 'our content'));

    let call = 0;
    const maybeSingle = vi.fn(async () => {
      call += 1;
      return call === 1
        ? { data: { profile: profileAt(OLDER, 'old server'), saved_at: OLDER }, error: null }
        : { data: { profile: profileAt(NEWER, 'winner content'), saved_at: NEWER }, error: null };
    });
    const upsert = vi.fn(async (_p: { saved_at: string }) => ({ error: null }));
    const client = {
      from: vi.fn(() => ({ select: vi.fn(() => ({ maybeSingle })), upsert })),
    } as unknown as SupabaseClient;

    const outcome = await syncVibeProfile({
      supabase: client,
      userId: 'user-a',
      stillCurrent: always,
    });

    expect(outcome).toBe('in-sync');
    // The divergence is resolved rather than silently persisting.
    expect(loadProfile()?.archetype).toBe('winner content');
  });

  it('does NOT churn when the confirmed row matches, only tag ORDER differs', async () => {
    // Content equality must be order-insensitive, or two devices holding the
    // same taste in a different order would hydrate/upload each other forever.
    const local = {
      tags: ['dive' as const, 'locals' as const],
      preferredNeighborhoods: ['East Village' as const],
      archetype: 'Dive devotee',
      savedAt: NEWER,
    };
    writeProfile(local);

    let call = 0;
    const maybeSingle = vi.fn(async () => {
      call += 1;
      return call === 1
        ? { data: { profile: profileAt(OLDER, 'old server'), saved_at: OLDER }, error: null }
        : {
            data: {
              profile: { ...local, tags: ['locals', 'dive'] },
              saved_at: NEWER,
            },
            error: null,
          };
    });
    const upsert = vi.fn(async (_p: { saved_at: string }) => ({ error: null }));
    const client = {
      from: vi.fn(() => ({ select: vi.fn(() => ({ maybeSingle })), upsert })),
    } as unknown as SupabaseClient;

    const outcome = await syncVibeProfile({
      supabase: client,
      userId: 'user-a',
      stillCurrent: always,
    });

    expect(outcome).toBe('uploaded');
    // Our own ordering is preserved — no pointless rewrite.
    expect(loadProfile()?.tags).toEqual(['dive', 'locals']);
  });

  it('reconciles against a quiz completed WHILE the fetch was in flight', async () => {
    // The local snapshot must be read AFTER the await. Reading it before would
    // reconcile against stale data and could hydrate an older server row over
    // a quiz result the user had just finished.
    const LATEST = '2026-07-25T00:00:00.000Z';
    const maybeSingle = vi.fn(async () => {
      // The concurrent quiz save lands during this fetch.
      writeProfile(profileAt(LATEST, 'just finished quiz'));
      return { data: { profile: profileAt(NEWER, 'server'), saved_at: NEWER }, error: null };
    });
    const upsert = vi.fn(async (_p: { saved_at: string }) => ({ error: null }));
    const client = {
      from: vi.fn(() => ({ select: vi.fn(() => ({ maybeSingle })), upsert })),
    } as unknown as SupabaseClient;

    const outcome = await syncVibeProfile({
      supabase: client,
      userId: 'user-a',
      stillCurrent: always,
    });

    // The fresh quiz result wins and is uploaded, not overwritten.
    expect(outcome).toBe('uploaded');
    expect(loadProfile()?.archetype).toBe('just finished quiz');
    expect(upsert.mock.calls[0][0].saved_at).toBe(LATEST);
  });
});

describe('failed synchronization', () => {
  it('a failed upload preserves local data and stays RETRYABLE', async () => {
    writeProfile(profileAt(NEWER, 'unsynced work'));
    const { client } = stubSupabase({ row: null, upsertError: true });

    const outcome = await syncVibeProfile({
      supabase: client,
      userId: 'user-a',
      stillCurrent: always,
    });

    expect(outcome).toBe('upload-failed');
    // Local data intact.
    expect(loadProfile()?.archetype).toBe('unsynced work');
    // Ownership is latched (the FETCH succeeded — see the cross-account note
    // below), but that is not a sync receipt: nothing reads this marker as
    // proof of synchronization.
    expect(readProfileOwner()).toBe('user-a');
  });

  it('a failed upload is RETRIED on the next sync, not treated as done', async () => {
    // This is the assertion that actually enforces "not falsely marked
    // synchronized". Retry is driven by the conflict rule (local newer than
    // server), never by the ownership marker — so a latched marker must not
    // suppress the retry.
    writeProfile(profileAt(NEWER, 'unsynced work'));
    const failing = stubSupabase({ row: null, upsertError: true });
    await syncVibeProfile({
      supabase: failing.client,
      userId: 'user-a',
      stillCurrent: always,
    });
    expect(readProfileOwner()).toBe('user-a');

    // Second sign-in, server now reachable: the upload must happen again.
    const retry = stubSupabase({ row: null });
    const outcome = await syncVibeProfile({
      supabase: retry.client,
      userId: 'user-a',
      stillCurrent: always,
    });
    expect(outcome).toBe('uploaded');
    expect(retry.upsert).toHaveBeenCalledTimes(1);
    expect(retry.upsert.mock.calls[0][0].saved_at).toBe(NEWER);
  });

  it('an unmarked cache cannot be handed to the next account after a failed upload', async () => {
    // The hole this closes: if a failed upload left the cache UNMARKED, then
    // after a session expiry (clearResidualAccountCache preserves unmarked
    // data as "genuine anonymous") the next account to sign in would upload
    // this profile as its own. Latching on the successful fetch is what makes
    // the residual guard able to see the residue at all.
    writeProfile(profileAt(NEWER, 'account A work'));
    const { client } = stubSupabase({ row: null, upsertError: true });
    await syncVibeProfile({
      supabase: client,
      userId: 'user-a',
      stillCurrent: always,
    });

    const { clearResidualAccountCache } = await import('./accountCache');
    expect(clearResidualAccountCache()).toBe(true);
    expect(loadProfile()).toBeNull();
  });

  it('a failed FETCH never uploads — it could clobber an unread newer row', async () => {
    writeProfile(profileAt(OLDER));
    const { client, upsert } = stubSupabase({ selectError: true });

    const outcome = await syncVibeProfile({
      supabase: client,
      userId: 'user-a',
      stillCurrent: always,
    });

    expect(outcome).toBe('fetch-failed');
    expect(upsert).not.toHaveBeenCalled();
    expect(loadProfile()?.savedAt).toBe(OLDER);
    expect(readProfileOwner()).toBeNull();
  });

  it('a failed push leaves the marker unlatched for retry', async () => {
    const { client } = stubSupabase({ upsertError: true });
    const ok = await pushVibeProfile(client, 'user-a', profileAt(NEWER), always);
    expect(ok).toBe(false);
    expect(readProfileOwner()).toBeNull();
  });

  it('a push whose account switched mid-flight does NOT stamp the old owner', async () => {
    // Without this guard, an account switch landing while the quiz-completion
    // upsert is in flight would stamp the signed-OUT account as owner of a
    // cache that now holds the NEW account's data — tripping the foreign guard
    // and wiping the new user's ratings, pairwise and profile for no reason.
    const { client } = stubSupabase({ row: null });
    const ok = await pushVibeProfile(
      client,
      'user-a',
      profileAt(NEWER),
      () => false, // the epoch moved: a sign-out landed
    );
    expect(ok).toBe(false);
    expect(readProfileOwner()).toBeNull();
  });
});

describe('sign-out landing mid-flight', () => {
  it('abandons the hydrate write when the cache epoch moved', async () => {
    // React's `cancelled` cleanup flips at commit, which can be AFTER an
    // in-flight fetch resolves — the epoch check is what actually stops a
    // just-wiped cache from being re-polluted.
    const { client } = stubSupabase({
      row: { profile: profileAt(NEWER, 'server'), saved_at: NEWER },
    });

    const epoch = getCacheEpoch();
    clearAccountCache(); // the sign-out

    const outcome = await syncVibeProfile({
      supabase: client,
      userId: 'user-a',
      stillCurrent: () => getCacheEpoch() === epoch,
    });

    expect(outcome).toBe('aborted');
    expect(loadProfile()).toBeNull();
    expect(readProfileOwner()).toBeNull();
  });
});
