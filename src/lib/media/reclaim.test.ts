import { beforeEach, describe, expect, it, vi } from 'vitest';

import { claimAndRemove, sweepReclaimable } from './reclaim';

/**
 * V8-R-CMP-012: "physical media bytes are deleted only when no destination and
 * no Saved Nights Out archive references them."
 *
 * Three review rounds reported the same missing half in three disguises —
 * expired stories, abandoned uploads, silently orphaned bytes — and all three
 * were "eligible but nothing ever removes them". So the assertions here are not
 * about eligibility, which 0066 decides. They are about the three properties a
 * caller can get wrong:
 *
 *   1. NOTHING IS DELETED THAT WAS NOT CLAIMED. A claim is the database
 *      committing, under a lock, that these bytes are unreferenced. No claim,
 *      no `storage.remove`, ever. That now holds for the UNREGISTERED half too:
 *      `claim_orphan_paths` adopts and stamps, where the earlier
 *      `unreferenced_orphan_paths` handed back bare paths and left the
 *      publish-versus-delete race open for exactly that population.
 *   2. A REMOVAL THAT DID NOT LAND GIVES THE CLAIM BACK. Otherwise the registry
 *      records bytes as reclaimed while they sit in the bucket, and every
 *      future sweep skips them — the leak the sweep exists to stop, caused by
 *      the sweep.
 *   3. THE RELEASE IS THE SERVICE ROLE'S. 0066 grants `release_media_claim` to
 *      no application role, because an owner who could un-stamp an object
 *      mid-removal would publish a story into the gap and lose its photo to a
 *      delete already in flight.
 */

type RpcResponse = { data: unknown; error: unknown };

function callerWith(responses: Record<string, RpcResponse>) {
  const rpc = vi.fn(async (name: string) => responses[name] ?? { data: [], error: null });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { rpc } as any;
}

/**
 * A service-role double: a storage bucket whose `remove` reports back only the
 * names it names, plus the `rpc` surface the release goes through.
 */
function adminWith(
  removedNames: (paths: string[]) => string[],
  options: { listFails?: boolean; absent?: string[] } = {},
) {
  const remove = vi.fn(async (paths: string[]) => ({
    data: removedNames(paths).map((name) => ({ name })),
    error: null,
  }));
  // THE DOUBLE MUST BE ABLE TO LIST, and that is not a detail of the fake.
  // `removeClaims` releases a claim only on POSITIVE PROOF the bytes survived, and
  // that proof is a successful listing that returns the name. An earlier version of
  // this double supplied no `list` at all, so every probe threw and was counted as
  // presence — which meant every release assertion below was passing through the
  // error path rather than through proof, and the suite could not have caught a
  // regression in the release rule. `listFails` exercises the unknown branch
  // explicitly instead of by accident.
  const list = vi.fn(async (folder: string, opts: { search?: string }) => {
    if (options.listFails) return { data: null, error: { message: 'list unavailable' } };
    const name = opts?.search ?? '';
    const full = folder ? `${folder}/${name}` : name;
    return { data: (options.absent ?? []).includes(full) ? [] : [{ name }], error: null };
  });
  const rpc = vi.fn(async () => ({ data: true, error: null }));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = { storage: { from: () => ({ remove, list }) }, rpc } as any;
  return { admin, remove, rpc, list };
}

// `claimed_at` is part of what the database hands back: it is the claim's identity,
// and releaseMediaClaim quotes it back so a worker cannot clear a claim that is no
// longer its own. A fixture without it produces claims that CANNOT be released, which
// would quietly turn every release assertion below into a no-op.
const CLAIM_STAMP = '2026-08-24T18:00:00.000Z';
const claimed = (rows: Array<[string, string]>): RpcResponse => ({
  data: rows.map(([media_id, storage_path]) => ({
    media_id,
    bucket_id: 'story-media',
    storage_path,
    claimed_at: CLAIM_STAMP,
  })),
  error: null,
});

const released = (rpc: { mock: { calls: unknown[][] } }): string[] =>
  rpc.mock.calls
    .filter((call) => call[0] === 'release_media_claim')
    .map((call) => (call[1] as { p_media_id: string }).p_media_id);

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('claimAndRemove — nothing is deleted that was not claimed', () => {
  it('removes exactly the paths the database claimed', async () => {
    const caller = callerWith({
      claim_media_for_removal: claimed([['m1', 'u1/a.jpg']]),
    });
    const { admin, remove } = adminWith((paths) => paths);

    await expect(claimAndRemove(caller, admin, 'm1')).resolves.toEqual({
      reclaimed: ['u1/a.jpg'],
      orphaned: [],
      unchecked: [],
    });
    expect(remove).toHaveBeenCalledWith(['u1/a.jpg']);
  });

  // The whole race the claim exists to close: the database declined because a
  // reference reappeared, so Storage must never be touched.
  it('does NOT call storage at all when the claim comes back empty', async () => {
    const caller = callerWith({ claim_media_for_removal: { data: [], error: null } });
    const { admin, remove } = adminWith((paths) => paths);

    await expect(claimAndRemove(caller, admin, 'm1')).resolves.toEqual({
      reclaimed: [],
      orphaned: [],
      unchecked: [],
    });
    expect(remove).not.toHaveBeenCalled();
  });

  it('releases the claim when Storage silently skips the object', async () => {
    const caller = callerWith({
      claim_media_for_removal: claimed([['m1', 'u1/a.jpg']]),
    });
    // Storage reports a refusal by OMITTING the object, with error null.
    const { admin, rpc } = adminWith(() => []);

    await expect(claimAndRemove(caller, admin, 'm1')).resolves.toEqual({
      reclaimed: [],
      orphaned: ['u1/a.jpg'],
      unchecked: [],
    });
    expect(rpc).toHaveBeenCalledWith('release_media_claim', { p_media_id: 'm1', p_claimed_at: CLAIM_STAMP });
  });

  // 0066 revokes `release_media_claim` from `authenticated`. A caller-scoped
  // release would therefore fail in production while every test here still
  // passed, so the client identity is asserted, not just the call.
  it('releases with the SERVICE ROLE client, never the caller', async () => {
    const caller = callerWith({
      claim_media_for_removal: claimed([['m1', 'u1/a.jpg']]),
    });
    const { admin, rpc } = adminWith(() => []);

    await claimAndRemove(caller, admin, 'm1');

    expect(released(rpc)).toEqual(['m1']);
    expect(released(caller.rpc)).toEqual([]);
  });

  it('releases only the claims that failed, never the ones that landed', async () => {
    const caller = callerWith({
      claim_media_for_removal: claimed([['m1', 'u1/a.jpg'], ['m2', 'u1/b.jpg']]),
    });
    const { admin, rpc } = adminWith((paths) => paths.filter((p) => p === 'u1/a.jpg'));

    const result = await claimAndRemove(caller, admin, null);
    expect(result).toEqual({ reclaimed: ['u1/a.jpg'], orphaned: ['u1/b.jpg'], unchecked: [] });
    expect(released(rpc)).toEqual(['m2']);
  });
});

describe('sweepReclaimable — the tick that actually runs', () => {
  it('reclaims registered claims AND adopted orphans in one pass', async () => {
    const caller = callerWith({
      claim_media_for_removal: claimed([['m1', 'u1/registered.jpg']]),
      claim_orphan_paths: claimed([['m9', 'u1/legacy.jpg']]),
    });
    const { admin, remove } = adminWith((paths) => paths);

    await expect(sweepReclaimable(caller, admin)).resolves.toEqual({
      reclaimed: ['u1/registered.jpg', 'u1/legacy.jpg'],
      orphaned: [],
      unchecked: [],
    });
    // Two removals, because the two populations are obtained differently: one
    // already had a registry row, the other was adopted into one first.
    expect(remove).toHaveBeenCalledTimes(2);
  });

  // Pre-boundary media is EVERY story photo in the product today, so a sweep
  // that only ever looked at the registry would reclaim nothing that exists.
  it('reclaims unregistered bytes even when there is nothing to claim', async () => {
    const caller = callerWith({
      claim_media_for_removal: { data: [], error: null },
      claim_orphan_paths: claimed([['m9', 'u1/legacy.jpg']]),
    });
    const { admin } = adminWith((paths) => paths);

    await expect(sweepReclaimable(caller, admin)).resolves.toEqual({
      reclaimed: ['u1/legacy.jpg'],
      orphaned: [],
      unchecked: [],
    });
  });

  // The property the bare-path shape could not have: an adopted orphan whose
  // removal was refused is a CLAIM, so it can be handed back. Left stamped, the
  // registry would file pre-boundary bytes as gone while they sit in the bucket
  // and no later tick would look at them again.
  it('releases an adopted orphan whose removal Storage silently skipped', async () => {
    const caller = callerWith({
      claim_media_for_removal: { data: [], error: null },
      claim_orphan_paths: claimed([['m9', 'u1/legacy.jpg']]),
    });
    const { admin, rpc } = adminWith(() => []);

    await expect(sweepReclaimable(caller, admin)).resolves.toEqual({
      reclaimed: [],
      orphaned: ['u1/legacy.jpg'],
      unchecked: [],
    });
    expect(released(rpc)).toEqual(['m9']);
  });

  it('does nothing, safely, when the database offers nothing', async () => {
    const caller = callerWith({});
    const { admin, remove } = adminWith((paths) => paths);

    await expect(sweepReclaimable(caller, admin)).resolves.toEqual({
      reclaimed: [],
      orphaned: [],
      unchecked: [],
    });
    expect(remove).not.toHaveBeenCalled();
  });

  // An object that was ALREADY GONE is not a failed removal. Storage omits a refused
  // object and a nonexistent one identically, so treating both as failures released
  // the stamp on bytes that are genuinely gone — and the next sweep re-claimed the
  // same row, got the same empty result, and released again, forever.
  it('keeps the stamp when the bytes were already absent', async () => {
    const remove = vi.fn(async () => ({ data: [], error: null }));
    const list = vi.fn(async () => ({ data: [], error: null })); // not there
    const rpc = vi.fn(async () => ({ data: null, error: null }));
    const admin: any = { storage: { from: () => ({ remove, list }) }, rpc };
    const caller: any = {
      rpc: vi.fn(async (name: string) => (
        name === 'claim_media_for_removal'
          ? { data: [{ media_id: 'm1', bucket_id: 'story-media', storage_path: 'o/m1' }], error: null }
          : { data: [], error: null }
      )),
    };

    const swept = await sweepReclaimable(caller, admin, 5);

    expect(swept.orphaned).toEqual([]);
    expect(swept.reclaimed).toContain('o/m1');
    // The claim must NOT be handed back: the stamp is correct, the bytes are gone.
    expect(rpc).not.toHaveBeenCalledWith('release_media_claim', expect.anything());
  });
});

describe('a claim is released ONLY on positive proof the bytes survived', () => {
  it('keeps the stamp when the presence probe itself fails', async () => {
    // Storage skipped the object, so we must find out whether the bytes survived.
    // The listing that would establish that FAILS. Nothing is proven, so nothing is
    // released — releasing here would clear the stamp on bytes that may be mid-delete
    // and let publish_story attach a live story to them.
    const caller = callerWith({ claim_media_for_removal: claimed([['m1', 'u1/a.jpg']]) });
    const { admin, rpc } = adminWith(() => [], { listFails: true });

    const result = await claimAndRemove(caller, admin, 'm1');

    expect(released(rpc)).toEqual([]);
    expect(result.reclaimed).toEqual([]);
    expect(result.orphaned).toEqual([]);
  });

  it('releases when the listing succeeds and the object is really still there', async () => {
    const caller = callerWith({ claim_media_for_removal: claimed([['m1', 'u1/a.jpg']]) });
    const { admin, rpc } = adminWith(() => []);

    await claimAndRemove(caller, admin, 'm1');

    expect(released(rpc)).toEqual(['m1']);
  });

  it('does not release when the listing succeeds and the bytes are genuinely gone', async () => {
    const caller = callerWith({ claim_media_for_removal: claimed([['m1', 'u1/a.jpg']]) });
    const { admin, rpc } = adminWith(() => [], { absent: ['u1/a.jpg'] });

    const result = await claimAndRemove(caller, admin, 'm1');

    expect(released(rpc)).toEqual([]);
    expect(result.reclaimed).toEqual(['u1/a.jpg']);
  });
});

/**
 * A SWEEP THAT COULD NOT CHECK IS NOT A CLEAN SWEEP.
 *
 * Both claim helpers used to fail closed by returning an empty list, which is
 * byte-identical to "the database looked and nothing was eligible". The sweep
 * had no way to express the difference, so a scheduled run whose RPCs errored
 * produced `{ reclaimed: [], orphaned: [] }` — a clean bill of health — and the
 * cron route answered 200 `ok: true` over cleanup that never happened.
 *
 * Deletion behaviour is unchanged and deliberately re-asserted here: failing
 * closed still means nothing is removed. What is new is that the caller is told.
 */
describe('a sweep reports what it could NOT check', () => {
  it('flags the registered half when its claim RPC errors, and deletes nothing', async () => {
    const caller = callerWith({
      claim_media_for_removal: { data: null, error: { message: 'down' } },
      claim_orphan_paths: { data: [], error: null },
    });
    const { admin, remove } = adminWith((paths) => paths);

    const result = await sweepReclaimable(caller, admin);

    expect(result.unchecked).toEqual(['claim_media_for_removal']);
    expect(result.reclaimed).toEqual([]);
    // Failing closed is unchanged: an unreadable claim deletes nothing.
    expect(remove).not.toHaveBeenCalled();
  });

  it('flags the orphan half when ITS claim RPC errors', async () => {
    const caller = callerWith({
      claim_media_for_removal: { data: [], error: null },
      claim_orphan_paths: { data: null, error: { message: 'down' } },
    });
    const { admin, remove } = adminWith((paths) => paths);

    const result = await sweepReclaimable(caller, admin);

    expect(result.unchecked).toEqual(['claim_orphan_paths']);
    expect(remove).not.toHaveBeenCalled();
  });

  it('flags BOTH halves when both fail, rather than stopping at the first', async () => {
    // The two calls cover different populations. Short-circuiting after the
    // first failure would report one unreadable population and leave the other
    // silently unexamined.
    const caller = callerWith({
      claim_media_for_removal: { data: null, error: { message: 'down' } },
      claim_orphan_paths: { data: null, error: { message: 'down' } },
    });
    const result = await sweepReclaimable(caller, adminWith((paths) => paths).admin);

    expect(result.unchecked).toEqual(['claim_media_for_removal', 'claim_orphan_paths']);
  });

  it('reports a THROWN claim as unchecked, not as an empty sweep', async () => {
    const caller = {
      rpc: vi.fn(async (name: string) => {
        if (name === 'claim_media_for_removal') throw new Error('socket hang up');
        return { data: [], error: null };
      }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    const result = await sweepReclaimable(caller, adminWith((paths) => paths).admin);

    expect(result.unchecked).toEqual(['claim_media_for_removal']);
  });

  it('reports NOTHING unchecked when both halves ran and found nothing', async () => {
    // The case that must stay distinguishable from all four above, and the one
    // a green cron is entitled to report.
    const caller = callerWith({
      claim_media_for_removal: { data: [], error: null },
      claim_orphan_paths: { data: [], error: null },
    });

    const result = await sweepReclaimable(caller, adminWith((paths) => paths).admin);

    expect(result).toEqual({ reclaimed: [], orphaned: [], unchecked: [] });
  });
});

/**
 * A FAILED PRESENCE PROBE IS AN UNKNOWN OUTCOME, NOT A CLEAN ONE.
 *
 * Reproduced by the advisor: Storage omits the object from its removal report,
 * the presence lookup that would settle whether the bytes survived then fails,
 * and the path falls out of every list — excluded from `reclaimed` because its
 * presence is unknown, excluded from `orphaned` because it was never proven
 * present. The sweep returned `{ reclaimed: [], orphaned: [], unchecked: [] }`
 * and the scheduled route reported success over an outcome nobody established.
 *
 * The conservative half was already right and is re-asserted below: the claim is
 * NOT released and the bytes are NOT counted as reclaimed. Only the reporting
 * changes.
 */
describe('an unknown removal outcome is reported, not rounded down to success', () => {
  it('marks the path unchecked when the presence probe fails', async () => {
    const caller = callerWith({
      claim_media_for_removal: claimed([['m1', 'u1/a.jpg']]),
      claim_orphan_paths: { data: [], error: null },
    });
    // Storage omits the object from its report AND the follow-up listing fails.
    const { admin, rpc } = adminWith(() => [], { listFails: true });

    const result = await sweepReclaimable(caller, admin);

    expect(result.unchecked).toEqual(['presence_unknown:u1/a.jpg']);
    // Unchanged, and the point of the conservative design: nothing is claimed as
    // reclaimed, and the stamp is NOT handed back on an outcome we do not know.
    expect(result.reclaimed).toEqual([]);
    expect(released(rpc)).toEqual([]);
  });

  it('marks it unchecked when the presence probe THROWS', async () => {
    const caller = callerWith({
      claim_media_for_removal: claimed([['m1', 'u1/a.jpg']]),
      claim_orphan_paths: { data: [], error: null },
    });
    const remove = vi.fn(async () => ({ data: [], error: null }));
    const list = vi.fn(async () => { throw new Error('network'); });
    const rpc = vi.fn(async () => ({ data: true, error: null }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = { storage: { from: () => ({ remove, list }) }, rpc } as any;

    const result = await sweepReclaimable(caller, admin);

    expect(result.unchecked).toEqual(['presence_unknown:u1/a.jpg']);
    expect(result.reclaimed).toEqual([]);
    expect(released(rpc)).toEqual([]);
  });

  it('still reports a clean run when the probe SUCCEEDS and the bytes are gone', async () => {
    // The case that must stay a success, so the flag above cannot be read as
    // "any sweep touching storage is now incomplete".
    const caller = callerWith({
      claim_media_for_removal: claimed([['m1', 'u1/a.jpg']]),
      claim_orphan_paths: { data: [], error: null },
    });
    const { admin } = adminWith((paths) => paths);

    const result = await sweepReclaimable(caller, admin);

    expect(result.unchecked).toEqual([]);
    expect(result.reclaimed).toEqual(['u1/a.jpg']);
  });
});
