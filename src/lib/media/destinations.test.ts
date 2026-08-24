import { describe, expect, it, vi } from 'vitest';

import {
  deleteEverywhere,
  pathHasLiveReference,
  reclaimBytes,
  removeDestination,
} from './destinations';

/**
 * V8-R-CMP-012 / V8-R-CMP-015 / V8-R-CMP-016.
 *
 * "REMOVING ONE DESTINATION DOES NOT DESTROY the remaining destinations.
 * PHYSICAL MEDIA BYTES ARE DELETED ONLY WHEN NO DESTINATION AND NO SAVED
 * NIGHTS OUT ARCHIVE REFERENCES THEM."
 *
 * The reference count itself lives in 0066 under a row lock. What these
 * assertions pin is the client half of the contract: that this module acts on
 * the answer it was given, and that a zero-row RPC result is reported as a
 * failure rather than as a success with nothing removed.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rpcClient(response: { data: unknown; error: unknown }): any {
  return { rpc: vi.fn(async () => response) };
}

describe('removeDestination — V8-R-CMP-015', () => {
  it('reports the bytes as retained while another destination is live', async () => {
    const client = rpcClient({
      data: [{
        media_id: 'm1',
        bucket_id: 'story-media',
        storage_path: 'u1/m1',
        reclaimable: false,
      }],
      error: null,
    });

    const result = await removeDestination(client, 'd1');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The whole point of the verb: the media object survives its other
    // destinations losing one of their number.
    expect(result.value.reclaimable).toBe(false);
  });

  it('reports reclaimable only when that was the last reference', async () => {
    const client = rpcClient({
      data: [{
        media_id: 'm1',
        bucket_id: 'story-media',
        storage_path: 'u1/m1',
        reclaimable: true,
      }],
      error: null,
    });

    const result = await removeDestination(client, 'd1');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.reclaimable).toBe(true);
  });

  it('does NOT report success when the RPC removed nothing', async () => {
    // Zero rows: not the author, or already removed. "a failed removal must not
    // report success and must not orphan the bytes."
    const client = rpcClient({ data: [], error: null });

    const result = await removeDestination(client, 'd1');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('denied');
  });

  it('does not treat a missing reclaimable flag as permission to delete', async () => {
    const client = rpcClient({
      data: [{ media_id: 'm1', bucket_id: 'story-media', storage_path: 'u1/m1' }],
      error: null,
    });

    const result = await removeDestination(client, 'd1');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.reclaimable).toBe(false);
  });

  it('reports an RPC error as a failure', async () => {
    const client = rpcClient({ data: null, error: { message: 'boom' } });
    const result = await removeDestination(client, 'd1');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('failed');
  });

  it('is unavailable rather than successful with no client', async () => {
    const result = await removeDestination(null, 'd1');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('unavailable');
  });
});

describe('deleteEverywhere — V8-R-CMP-016', () => {
  it('keeps the bytes while a Saved Nights Out archive still references them', async () => {
    const client = rpcClient({
      data: [{
        bucket_id: 'story-media',
        storage_path: 'u1/m1',
        reclaimable: false,
        remaining_references: 1,
      }],
      error: null,
    });

    const result = await deleteEverywhere(client, 'm1');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.reclaimable).toBe(false);
    // Reported, so a partial delete is never presented as complete.
    expect(result.value.remainingReferences).toBe(1);
  });

  it('reclaims the bytes when the last reference is gone', async () => {
    const client = rpcClient({
      data: [{
        bucket_id: 'story-media',
        storage_path: 'u1/m1',
        reclaimable: true,
        remaining_references: 0,
      }],
      error: null,
    });

    const result = await deleteEverywhere(client, 'm1');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.reclaimable).toBe(true);
    expect(result.value.remainingReferences).toBe(0);
  });

  it('denies a delete the RPC refused', async () => {
    const client = rpcClient({ data: [], error: null });
    const result = await deleteEverywhere(client, 'm1');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('denied');
  });
});

describe('reclaimBytes — orphans are returned, never swallowed', () => {
  type RemoveResult = { data?: unknown; error: unknown };

  function storage(results: ReadonlyArray<RemoveResult>) {
    let call = 0;
    const remove = vi.fn(async () => results[Math.min(call++, results.length - 1)]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { admin: { storage: { from: () => ({ remove }) } } as any, remove };
  }

  /** What Storage returns for a path it actually deleted. */
  const deleted = (...names: string[]) => ({
    data: names.map((name) => ({ name })),
    error: null,
  });

  it('returns nothing when the removal succeeds', async () => {
    const { admin, remove } = storage([deleted('u1/m1')]);
    await expect(reclaimBytes(admin, 'story-media', ['u1/m1'])).resolves.toEqual([]);
    expect(remove).toHaveBeenCalledTimes(1);
  });

  // THE SILENT SKIP. Storage reports a refusal by leaving the object out of the
  // removed list, with error null — so a function that inspects only `error`
  // reads a refused delete as a complete success and the caller stamps
  // bytes_removed_at on bytes that are still in the bucket.
  it('reports a path Storage silently skipped, even though no error came back', async () => {
    const { admin } = storage([{ data: [], error: null }]);
    await expect(reclaimBytes(admin, 'story-media', ['u1/m1']))
      .resolves.toEqual(['u1/m1']);
  });

  it('does not retry a silent skip, because a refusal is a decision', async () => {
    const { admin, remove } = storage([{ data: [], error: null }]);
    await reclaimBytes(admin, 'story-media', ['u1/m1']);
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('reports only the paths that were skipped, not the whole batch', async () => {
    const { admin } = storage([deleted('u1/a')]);
    await expect(reclaimBytes(admin, 'story-media', ['u1/a', 'u1/b']))
      .resolves.toEqual(['u1/b']);
  });

  it('treats a missing removed list as nothing removed', async () => {
    const { admin } = storage([{ error: null }]);
    await expect(reclaimBytes(admin, 'story-media', ['u1/m1']))
      .resolves.toEqual(['u1/m1']);
  });

  it('retries once, then reports the surviving path', async () => {
    const { admin, remove } = storage([{ error: { message: 'transient' } }]);
    await expect(reclaimBytes(admin, 'story-media', ['u1/m1'])).resolves.toEqual(['u1/m1']);
    expect(remove).toHaveBeenCalledTimes(2);
  });

  it('succeeds on the retry without reporting an orphan', async () => {
    const { admin } = storage([{ error: { message: 'transient' } }, deleted('u1/m1')]);
    await expect(reclaimBytes(admin, 'story-media', ['u1/m1'])).resolves.toEqual([]);
  });

  it('does nothing at all for an empty path list', async () => {
    const { admin, remove } = storage([deleted()]);
    await expect(reclaimBytes(admin, 'story-media', [])).resolves.toEqual([]);
    expect(remove).not.toHaveBeenCalled();
  });
});

describe('pathHasLiveReference — the last-moment re-check', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = (response: { data: unknown; error: unknown }): any => ({
    rpc: vi.fn(async () => response),
  });

  it('is false only on an explicit negative answer', async () => {
    await expect(pathHasLiveReference(client({ data: false, error: null }), 'b', 'p'))
      .resolves.toBe(false);
  });

  it('is true when a reference reappeared', async () => {
    await expect(pathHasLiveReference(client({ data: true, error: null }), 'b', 'p'))
      .resolves.toBe(true);
  });

  // Deleting because a lookup broke is the one outcome that cannot be undone.
  it('FAILS CLOSED when the check errors', async () => {
    await expect(
      pathHasLiveReference(client({ data: null, error: { message: 'down' } }), 'b', 'p'),
    ).resolves.toBe(true);
  });

  it('FAILS CLOSED on an unexpected answer shape', async () => {
    await expect(pathHasLiveReference(client({ data: null, error: null }), 'b', 'p'))
      .resolves.toBe(true);
  });

  it('FAILS CLOSED with no client at all', async () => {
    await expect(pathHasLiveReference(null, 'b', 'p')).resolves.toBe(true);
  });
});
