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
function adminWith(removedNames: (paths: string[]) => string[]) {
  const remove = vi.fn(async (paths: string[]) => ({
    data: removedNames(paths).map((name) => ({ name })),
    error: null,
  }));
  const rpc = vi.fn(async () => ({ data: true, error: null }));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = { storage: { from: () => ({ remove }) }, rpc } as any;
  return { admin, remove, rpc };
}

const claimed = (rows: Array<[string, string]>): RpcResponse => ({
  data: rows.map(([media_id, storage_path]) => ({
    media_id,
    bucket_id: 'story-media',
    storage_path,
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
    });
    expect(rpc).toHaveBeenCalledWith('release_media_claim', { p_media_id: 'm1' });
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
    expect(result).toEqual({ reclaimed: ['u1/a.jpg'], orphaned: ['u1/b.jpg'] });
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
    });
    expect(released(rpc)).toEqual(['m9']);
  });

  it('does nothing, safely, when the database offers nothing', async () => {
    const caller = callerWith({});
    const { admin, remove } = adminWith((paths) => paths);

    await expect(sweepReclaimable(caller, admin)).resolves.toEqual({
      reclaimed: [],
      orphaned: [],
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
