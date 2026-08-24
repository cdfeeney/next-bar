import { beforeEach, describe, expect, it, vi } from 'vitest';

import { claimAndRemove, sweepReclaimable } from './reclaim';

/**
 * V8-R-CMP-012: "physical media bytes are deleted only when no destination and
 * no Saved Nights Out archive references them."
 *
 * Three review rounds reported the same missing half in three disguises —
 * expired stories, abandoned uploads, silently orphaned bytes — and all three
 * were "eligible but nothing ever removes them". So the assertions here are not
 * about eligibility, which 0066 decides. They are about the two properties a
 * caller can get wrong:
 *
 *   1. NOTHING IS DELETED THAT WAS NOT CLAIMED. A claim is the database
 *      committing, under a lock, that these bytes are unreferenced. No claim,
 *      no `storage.remove`, ever.
 *   2. A REMOVAL THAT DID NOT LAND GIVES THE CLAIM BACK. Otherwise the registry
 *      records bytes as reclaimed while they sit in the bucket, and every
 *      future sweep skips them — the leak the sweep exists to stop, caused by
 *      the sweep.
 */

type RpcResponse = { data: unknown; error: unknown };

function callerWith(responses: Record<string, RpcResponse>) {
  const rpc = vi.fn(async (name: string) => responses[name] ?? { data: [], error: null });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { rpc } as any;
}

/** A storage double whose `remove` reports back only the names it names. */
function adminWith(removedNames: (paths: string[]) => string[]) {
  const remove = vi.fn(async (paths: string[]) => ({
    data: removedNames(paths).map((name) => ({ name })),
    error: null,
  }));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { admin: { storage: { from: () => ({ remove }) } } as any, remove };
}

const claimed = (rows: Array<[string, string]>): RpcResponse => ({
  data: rows.map(([media_id, storage_path]) => ({
    media_id,
    bucket_id: 'story-media',
    storage_path,
  })),
  error: null,
});

const orphanPaths = (paths: string[]): RpcResponse => ({
  data: paths.map((storage_path) => ({ bucket_id: 'story-media', storage_path })),
  error: null,
});

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
      release_media_claim: { data: true, error: null },
    });
    // Storage reports a refusal by OMITTING the object, with error null.
    const { admin } = adminWith(() => []);

    await expect(claimAndRemove(caller, admin, 'm1')).resolves.toEqual({
      reclaimed: [],
      orphaned: ['u1/a.jpg'],
    });
    expect(caller.rpc).toHaveBeenCalledWith('release_media_claim', { p_media_id: 'm1' });
  });

  it('releases only the claims that failed, never the ones that landed', async () => {
    const caller = callerWith({
      claim_media_for_removal: claimed([['m1', 'u1/a.jpg'], ['m2', 'u1/b.jpg']]),
      release_media_claim: { data: true, error: null },
    });
    const { admin } = adminWith((paths) => paths.filter((p) => p === 'u1/a.jpg'));

    const result = await claimAndRemove(caller, admin, null);
    expect(result).toEqual({ reclaimed: ['u1/a.jpg'], orphaned: ['u1/b.jpg'] });

    const released = caller.rpc.mock.calls
      .filter(([name]: [string]) => name === 'release_media_claim')
      .map(([, args]: [string, { p_media_id: string }]) => args.p_media_id);
    expect(released).toEqual(['m2']);
  });
});

describe('sweepReclaimable — the tick that actually runs', () => {
  it('reclaims registered claims AND unregistered orphan paths in one pass', async () => {
    const caller = callerWith({
      claim_media_for_removal: claimed([['m1', 'u1/registered.jpg']]),
      unreferenced_orphan_paths: orphanPaths(['u1/legacy.jpg']),
    });
    const { admin, remove } = adminWith((paths) => paths);

    await expect(sweepReclaimable(caller, admin)).resolves.toEqual({
      reclaimed: ['u1/registered.jpg', 'u1/legacy.jpg'],
      orphaned: [],
    });
    // Two separate removals, because the two populations are decided
    // differently: one by a claim, one by absence from the registry.
    expect(remove).toHaveBeenCalledTimes(2);
  });

  // Pre-boundary media is EVERY story photo in the product today, so a sweep
  // that only ever looked at the registry would reclaim nothing that exists.
  it('reclaims unregistered bytes even when there is nothing to claim', async () => {
    const caller = callerWith({
      claim_media_for_removal: { data: [], error: null },
      unreferenced_orphan_paths: orphanPaths(['u1/legacy.jpg']),
    });
    const { admin } = adminWith((paths) => paths);

    await expect(sweepReclaimable(caller, admin)).resolves.toEqual({
      reclaimed: ['u1/legacy.jpg'],
      orphaned: [],
    });
  });

  it('reports an orphan path that survived, and reclaims nothing', async () => {
    const caller = callerWith({
      claim_media_for_removal: { data: [], error: null },
      unreferenced_orphan_paths: orphanPaths(['u1/legacy.jpg']),
    });
    const { admin } = adminWith(() => []);

    await expect(sweepReclaimable(caller, admin)).resolves.toEqual({
      reclaimed: [],
      orphaned: ['u1/legacy.jpg'],
    });
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
});
