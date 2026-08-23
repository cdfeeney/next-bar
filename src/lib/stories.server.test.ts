import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  SIGNED_URL_MAX_SECONDS,
  STORY_BUCKET,
  deleteStory,
  fetchVisibleStories,
  publishStory,
  removeMyStoryTag,
  reportOrphans,
  signedUrlTtlSeconds,
  storyObjectKey,
} from './stories.server';

/**
 * Unit coverage for the rules migration 0065's client half is responsible for.
 *
 * What this file can and cannot prove, stated so nobody reads more into a green
 * run than it earns: the AUTHORIZATION rules — who may read a story, expiry as a
 * query gate, custom-audience enforcement, tag removal — live in RLS and in
 * SECURITY DEFINER functions, and can only be proven against a real database
 * with two real identities. That is `storiesRls.live.test.ts`, which does not
 * run here. These tests cover the signed-URL lifetime rule, the object-key
 * convention, and the failure/cleanup behaviour of the client, all of which are
 * this module's own decisions.
 */

const NOW = Date.parse('2026-08-22T12:00:00.000Z');
const iso = (msFromNow: number): string => new Date(NOW + msFromNow).toISOString();

describe('signedUrlTtlSeconds', () => {
  it('never outlives the story it points at', () => {
    // 30 seconds left => 30 seconds of URL, not the 300-second ceiling.
    expect(signedUrlTtlSeconds(iso(30_000), NOW)).toBe(30);
  });

  it('caps a long-lived story at the ceiling', () => {
    expect(signedUrlTtlSeconds(iso(24 * 60 * 60 * 1000), NOW)).toBe(SIGNED_URL_MAX_SECONDS);
  });

  it('returns zero for an expired story so no URL is minted at all', () => {
    expect(signedUrlTtlSeconds(iso(-1), NOW)).toBe(0);
    expect(signedUrlTtlSeconds(iso(0), NOW)).toBe(0);
  });

  it('returns zero rather than NaN for an unparseable timestamp', () => {
    expect(signedUrlTtlSeconds('not a date', NOW)).toBe(0);
  });

  it('never rounds a sub-second remainder up to a live URL', () => {
    // This assertion used to read `toBe(1)` — the exact rounding-up its own
    // name forbids, and the defect a reviewer found by reading the code rather
    // than the test. A 900ms remainder is not a second of life: a one-second
    // URL for it is valid for ~100ms AFTER expires_at, which is a bearer link
    // to content the database has already stopped serving.
    expect(signedUrlTtlSeconds(iso(900), NOW)).toBe(0);
    expect(signedUrlTtlSeconds(iso(1), NOW)).toBe(0);
    expect(signedUrlTtlSeconds(iso(999), NOW)).toBe(0);
  });

  it('grants a whole second only once a whole second is left', () => {
    expect(signedUrlTtlSeconds(iso(1000), NOW)).toBe(1);
    // And never rounds a partial second UP either: 1.999s is one second.
    expect(signedUrlTtlSeconds(iso(1999), NOW)).toBe(1);
  });
});

describe('storyObjectKey', () => {
  it('puts the author first, which is what the bucket policy keys ownership on', () => {
    expect(storyObjectKey('author-1', 'draft-9', 'main')).toBe('author-1/draft-9/main');
    expect(storyObjectKey('author-1', 'draft-9', 'inset')).toBe('author-1/draft-9/inset');
  });
});

type StorageStub = {
  upload: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
  createSignedUrl: ReturnType<typeof vi.fn>;
};

function clientStub(overrides: {
  upload?: unknown;
  remove?: unknown;
  rpc?: unknown;
  from?: unknown;
  createSignedUrl?: unknown;
} = {}): { client: any; storage: StorageStub; rpc: ReturnType<typeof vi.fn> } {
  const storage: StorageStub = {
    upload: vi.fn().mockResolvedValue(overrides.upload ?? { error: null }),
    remove: vi.fn().mockResolvedValue(overrides.remove ?? { error: null }),
    createSignedUrl: vi.fn().mockResolvedValue(
      overrides.createSignedUrl ?? { data: { signedUrl: 'https://signed.example/x' }, error: null },
    ),
  };
  const rpc = vi.fn().mockResolvedValue(overrides.rpc ?? { data: null, error: null });
  const client = {
    storage: { from: vi.fn(() => storage) },
    rpc,
    from: vi.fn(() => overrides.from ?? {}),
  };
  return { client, storage, rpc };
}

const blob = (): Blob => new Blob(['x'], { type: 'image/jpeg' });

describe('publishStory', () => {
  it('reports unavailable, never success, when Supabase is not configured', async () => {
    const result = await publishStory(null, {
      authorId: 'a', draftId: 'd', main: blob(), audience: 'friends',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('unavailable');
      expect(result.message).toMatch(/nothing was shared/i);
    }
  });

  it('publishes only after the upload succeeds, and returns the stored row', async () => {
    const row = {
      id: 's1', author_id: 'a', bar_id: null, caption: null,
      media_path: 'a/d/main', inset_path: null, media_kind: 'single',
      audience: 'friends', created_at: iso(0), expires_at: iso(86_400_000),
    };
    const { client, storage, rpc } = clientStub({ rpc: { data: row, error: null } });
    const result = await publishStory(client, {
      authorId: 'a', draftId: 'd', main: blob(), audience: 'friends',
    });
    expect(storage.upload).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('publish_story', expect.objectContaining({
      p_media_path: 'a/d/main', p_media_kind: 'single', p_audience: 'friends',
    }));
    expect(result).toMatchObject({ ok: true, value: { id: 's1', authorId: 'a' } });
  });

  it('removes the uploaded bytes when publication fails — no orphan, no receipt', async () => {
    const { client, storage } = clientStub({
      rpc: { data: null, error: { message: 'boom', code: 'XX000' } },
    });
    const result = await publishStory(client, {
      authorId: 'a', draftId: 'd', main: blob(), audience: 'friends',
    });
    expect(result.ok).toBe(false);
    expect(storage.remove).toHaveBeenCalledWith(['a/d/main']);
    if (!result.ok) {
      expect(result.orphans).toEqual([]);
      expect(result.message).toMatch(/nothing was shared/i);
    }
  });

  it('reports the leftover keys when cleanup itself fails, rather than hiding them', async () => {
    const { client } = clientStub({
      rpc: { data: null, error: { message: 'boom', code: 'XX000' } },
      remove: { error: { message: 'cleanup failed' } },
    });
    const result = await publishStory(client, {
      authorId: 'a', draftId: 'd', main: blob(), audience: 'friends',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.orphans).toEqual(['a/d/main']);
  });

  it('cleans up the first photo when the second of a pair fails to upload', async () => {
    const { client, storage } = clientStub();
    storage.upload
      .mockResolvedValueOnce({ error: null })
      .mockResolvedValueOnce({ error: { message: 'no' } });
    const result = await publishStory(client, {
      authorId: 'a', draftId: 'd', main: blob(), inset: blob(), audience: 'friends',
    });
    expect(result.ok).toBe(false);
    expect(storage.remove).toHaveBeenCalledWith(['a/d/main']);
  });

  it('surfaces a non-mutual custom recipient as a denial the user can act on', async () => {
    const { client } = clientStub({
      rpc: { data: null, error: { message: 'not mutual', code: '42501' } },
    });
    const result = await publishStory(client, {
      authorId: 'a', draftId: 'd', main: blob(), audience: 'custom', audienceIds: ['b'],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('denied');
      expect(result.message).toMatch(/follows you back/i);
    }
  });
});

describe('fetchVisibleStories', () => {
  it('signs each story for no longer than that story has left', async () => {
    const rows = [
      { id: 'long', author_id: 'a', bar_id: null, caption: null, media_path: 'a/1/main',
        inset_path: null, media_kind: 'single', audience: 'friends',
        created_at: iso(0), expires_at: iso(86_400_000) },
      { id: 'short', author_id: 'a', bar_id: null, caption: null, media_path: 'a/2/main',
        inset_path: null, media_kind: 'single', audience: 'friends',
        created_at: iso(0), expires_at: iso(10_000) },
    ];
    const { client, storage } = clientStub();
    client.from = vi.fn(() => ({
      select: vi.fn(() => ({
        order: vi.fn().mockResolvedValue({ data: rows, error: null }),
      })),
    }));
    const result = await fetchVisibleStories(client, NOW);
    expect(result.ok).toBe(true);
    const ttls = storage.createSignedUrl.mock.calls.map((c) => c[1]);
    expect(ttls).toContain(SIGNED_URL_MAX_SECONDS);
    expect(ttls).toContain(10);
  });

  it('mints no URL at all for a story that has already expired', async () => {
    const rows = [
      { id: 'gone', author_id: 'a', bar_id: null, caption: null, media_path: 'a/3/main',
        inset_path: null, media_kind: 'single', audience: 'friends',
        created_at: iso(-2000), expires_at: iso(-1000) },
    ];
    const { client, storage } = clientStub();
    client.from = vi.fn(() => ({
      select: vi.fn(() => ({
        order: vi.fn().mockResolvedValue({ data: rows, error: null }),
      })),
    }));
    const result = await fetchVisibleStories(client, NOW);
    expect(storage.createSignedUrl).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value[0].mediaUrl).toBeNull();
  });

  it('reports unavailable rather than an empty feed when Supabase is absent', async () => {
    const result = await fetchVisibleStories(null, NOW);
    expect(result).toMatchObject({ ok: false, reason: 'unavailable' });
  });

  /**
   * The tag read is what makes the whole consent surface reachable. Without
   * it, publication wrote story_tags rows that NOTHING ever read back: the
   * people chip, the tagged-people sheet and its "Remove me" control could
   * never render, so a tagged person could not learn they were tagged.
   */
  it('carries each story its own live tags', async () => {
    const rows = [
      { id: 's1', author_id: 'a', bar_id: null, caption: null, media_path: 'a/1/main',
        inset_path: null, media_kind: 'single', audience: 'friends',
        created_at: iso(0), expires_at: iso(60_000) },
      { id: 's2', author_id: 'a', bar_id: null, caption: null, media_path: 'a/2/main',
        inset_path: null, media_kind: 'single', audience: 'friends',
        created_at: iso(0), expires_at: iso(60_000) },
    ];
    const tagRows = [
      { story_id: 's1', profile_id: 'p-claire' },
      { story_id: 's1', profile_id: 'p-dev' },
      { story_id: 's2', profile_id: 'p-you' },
    ];
    const removedFilter = vi.fn().mockResolvedValue({ data: tagRows, error: null });
    const { client } = clientStub();
    client.from = vi.fn((table: string) => {
      if (table === 'story_tags') {
        return { select: vi.fn(() => ({ in: vi.fn(() => ({ is: removedFilter })) })) };
      }
      return {
        select: vi.fn(() => ({
          order: vi.fn().mockResolvedValue({ data: rows, error: null }),
        })),
      };
    });

    const result = await fetchVisibleStories(client, NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value[0].tagIds).toEqual(['p-claire', 'p-dev']);
    expect(result.value[1].tagIds).toEqual(['p-you']);
    // Withdrawn tags are excluded by the QUERY, not by the caller: removed_at
    // null is the consent gate and it belongs next to the read.
    expect(removedFilter).toHaveBeenCalledWith('removed_at', null);
  });

  it('still renders the stories when the tag read fails', async () => {
    const rows = [
      { id: 's1', author_id: 'a', bar_id: null, caption: null, media_path: 'a/1/main',
        inset_path: null, media_kind: 'single', audience: 'friends',
        created_at: iso(0), expires_at: iso(60_000) },
    ];
    const { client } = clientStub();
    client.from = vi.fn((table: string) => {
      if (table === 'story_tags') {
        return {
          select: vi.fn(() => ({
            in: vi.fn(() => ({
              is: vi.fn().mockResolvedValue({ data: null, error: { message: 'nope' } }),
            })),
          })),
        };
      }
      return {
        select: vi.fn(() => ({
          order: vi.fn().mockResolvedValue({ data: rows, error: null }),
        })),
      };
    });

    const result = await fetchVisibleStories(client, NOW);
    // A missing chip, never a missing story.
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value[0].tagIds).toEqual([]);
  });
});

/**
 * Orphan reports were RETURNED honestly by this module and then dropped by
 * every caller, which made the honest return value indistinguishable from a
 * silent one: private objects left in the bucket by a failed cleanup, with
 * nothing said anywhere.
 */
describe('fetchVisibleStories — media honesty and clock authority', () => {
  const liveRow = () => ({
    id: 's1', author_id: 'a', bar_id: null, caption: null,
    media_path: 'a/1/main', inset_path: null, media_kind: 'single',
    audience: 'friends', created_at: iso(0), expires_at: iso(10_000),
  });

  // Server time is authoritative. The read gate is 0065's RLS, evaluated against
  // the DATABASE's now(); this process's clock must not act as a second gate, or
  // a fast clock hides stories the database is still serving.
  it('applies no client-clock expiry filter — it trusts the rows the gate returned', async () => {
    const order = vi.fn().mockResolvedValue({ data: [liveRow()], error: null });
    const gt = vi.fn();
    const { client } = clientStub();
    client.from = vi.fn(() => ({ select: vi.fn(() => ({ order, gt })) }));
    const result = await fetchVisibleStories(client, NOW);
    expect(result.ok).toBe(true);
    expect(order).toHaveBeenCalled();
    expect(gt).not.toHaveBeenCalled();
  });

  it('marks a story unsigned — not photo-less — when signing fails', async () => {
    const { client } = clientStub({
      createSignedUrl: { data: null, error: { message: 'signer down' } },
    });
    client.from = vi.fn(() => ({
      select: vi.fn(() => ({ order: vi.fn().mockResolvedValue({ data: [liveRow()], error: null }) })),
    }));
    const result = await fetchVisibleStories(client, NOW);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value[0].mediaUrl).toBeNull();
      // The distinction the viewer needs: an outage, not a story without a photo.
      expect(result.value[0].mediaState).toBe('unsigned');
    }
  });

  it('marks an expired story expired, which is not the same as an outage', async () => {
    const { client } = clientStub();
    const expired = { ...liveRow(), expires_at: iso(-1) };
    client.from = vi.fn(() => ({
      select: vi.fn(() => ({ order: vi.fn().mockResolvedValue({ data: [expired], error: null }) })),
    }));
    const result = await fetchVisibleStories(client, NOW);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value[0].mediaState).toBe('expired');
  });

  it('marks a fully signed story ok', async () => {
    const { client } = clientStub();
    client.from = vi.fn(() => ({
      select: vi.fn(() => ({ order: vi.fn().mockResolvedValue({ data: [liveRow()], error: null }) })),
    }));
    const result = await fetchVisibleStories(client, NOW);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value[0].mediaState).toBe('ok');
  });
});

describe('reportOrphans', () => {
  afterEach(() => vi.restoreAllMocks());

  it('says which objects were left behind, and in which bucket', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    reportOrphans('publish', ['a/1/main', 'a/1/inset']);
    expect(error).toHaveBeenCalledTimes(1);
    const line = String(error.mock.calls[0][0]);
    expect(line).toContain(STORY_BUCKET);
    expect(line).toContain('a/1/main');
    expect(line).toContain('a/1/inset');
    expect(line).toContain('publish');
  });

  it('says nothing when cleanup actually worked', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    reportOrphans('delete', []);
    reportOrphans('delete', undefined);
    expect(error).not.toHaveBeenCalled();
  });
});

describe('deleteStory', () => {
  /**
   * The pre-read deleteStory now performs BEFORE the RPC: it reads the object
   * keys while the story is still live, because story_media_is_dead closes the
   * owner-read storage policy the instant the row is soft-deleted, and Storage
   * remove() needs SELECT as well as DELETE. Without this stub the pre-read
   * throws and every case falls to `unavailable`.
   */
  const withPreRead = (
    rows: { media_path: string; inset_path: string | null }[],
    overrides: Parameters<typeof clientStub>[0] = {},
  ) => {
    const stub = clientStub(overrides);
    stub.client.from = vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({ limit: vi.fn().mockResolvedValue({ data: rows, error: null }) })),
      })),
    }));
    return stub;
  };

  it('removes the bytes while the story is still live, BEFORE the soft delete', async () => {
    const { client, storage, rpc } = withPreRead(
      [{ media_path: 'a/1/main', inset_path: 'a/1/inset' }],
      { rpc: { data: [{ media_path: 'a/1/main', inset_path: 'a/1/inset' }], error: null } },
    );
    const result = await deleteStory(client, 's1');
    expect(result.ok).toBe(true);
    expect(storage.remove).toHaveBeenCalledWith(['a/1/main', 'a/1/inset']);
    // Ordering is the whole point: removal must precede delete_story.
    expect(storage.remove.mock.invocationCallOrder[0])
      .toBeLessThan(rpc.mock.invocationCallOrder[0]);
  });

  it('tells the author honestly when the bytes went but the delete did not', async () => {
    const { client } = withPreRead(
      [{ media_path: 'a/1/main', inset_path: null }],
      { rpc: { data: null, error: { message: 'boom' } } },
    );
    const result = await deleteStory(client, 's1');
    expect(result).toMatchObject({ ok: false, reason: 'failed' });
    if (!result.ok) expect(result.message).toContain('photo was removed');
  });

  it('is a denial, not a success, when no row was the caller\'s to delete', async () => {
    const { client, storage } = withPreRead([], { rpc: { data: [], error: null } });
    const result = await deleteStory(client, 's1');
    expect(result).toMatchObject({ ok: false, reason: 'denied' });
    // Nothing to remove: the pre-read found no row this caller may see, so no
    // byte removal was attempted against someone else's prefix.
    expect(storage.remove).not.toHaveBeenCalled();
  });

  it('still succeeds but reports orphans when the byte removal fails', async () => {
    const { client } = withPreRead(
      [{ media_path: 'a/1/main', inset_path: null }],
      {
        rpc: { data: [{ media_path: 'a/1/main', inset_path: null }], error: null },
        remove: { error: { message: 'nope' } },
      },
    );
    const result = await deleteStory(client, 's1');
    expect(result).toMatchObject({ ok: true, value: { orphans: ['a/1/main'] } });
  });

  it('retries a failed removal once before reporting an orphan', async () => {
    const { client, storage } = withPreRead(
      [{ media_path: 'a/1/main', inset_path: null }],
      { rpc: { data: [{ media_path: 'a/1/main', inset_path: null }], error: null } },
    );
    storage.remove
      .mockResolvedValueOnce({ error: { message: 'transient' } })
      .mockResolvedValueOnce({ error: null });
    const result = await deleteStory(client, 's1');
    expect(storage.remove).toHaveBeenCalledTimes(2);
    // The retry succeeded, so there is nothing to report.
    expect(result).toMatchObject({ ok: true, value: { orphans: [] } });
  });

  // The soft-delete has already committed by the time the bytes are touched. A
  // THROW from storage (not a returned error) used to escape to the outer catch
  // and surface as "unavailable", telling the author their delete failed while
  // the row was already gone for every reader.
  it('reports success, not failure, when byte removal THROWS after the row is deleted', async () => {
    const { client, storage } = withPreRead(
      [{ media_path: 'a/1/main', inset_path: null }],
      { rpc: { data: [{ media_path: 'a/1/main', inset_path: null }], error: null } },
    );
    storage.remove.mockRejectedValue(new Error('network died'));
    const result = await deleteStory(client, 's1');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.orphans).toEqual(['a/1/main']);
  });
});

describe('removeMyStoryTag', () => {
  it('reports whether a tag was actually withdrawn', async () => {
    const { client } = clientStub({ rpc: { data: true, error: null } });
    await expect(removeMyStoryTag(client, 's1')).resolves.toMatchObject({ ok: true, value: true });
  });

  it('does not claim success when the RPC errors', async () => {
    const { client } = clientStub({ rpc: { data: null, error: { message: 'no' } } });
    await expect(removeMyStoryTag(client, 's1')).resolves.toMatchObject({ ok: false, reason: 'failed' });
  });
});
