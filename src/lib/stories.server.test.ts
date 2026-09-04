import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
    // The boundary routes authenticate with the caller's bearer token, so the
    // module has to be able to ask the client for one.
    auth: {
      getSession: vi.fn().mockResolvedValue({
        data: { session: { access_token: 'test-token' } }, error: null,
      }),
    },
    storage: { from: vi.fn(() => storage) },
    rpc,
    from: vi.fn(() => overrides.from ?? {}),
  };
  return { client, storage, rpc };
}

/**
 * The media boundary, stubbed at `fetch`.
 *
 * Every byte now travels `POST /api/media/upload` -> `{ mediaId, storagePath }`,
 * signed URLs come from `GET /api/media/:id/url`, and removal is
 * `DELETE /api/media/:id`. Stubbing fetch rather than the Supabase storage
 * client is the point of the change: a test that can still reach
 * `client.storage` cannot tell a converted module from an unconverted one.
 */
let fetchMock: ReturnType<typeof vi.fn>;
let mediaSeq = 0;

function installBoundary(opts: {
  upload?: (n: number) => { status?: number; body?: unknown } | undefined;
  url?: { status?: number; body?: unknown };
  del?: { status?: number; body?: unknown };
} = {}): void {
  mediaSeq = 0;
  fetchMock = vi.fn(async (input: any, init?: any) => {
    const href = String(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    const reply = (status: number, body: unknown) =>
      ({ ok: status >= 200 && status < 300, status, json: async () => body }) as any;

    if (href.includes('/api/media/upload')) {
      mediaSeq += 1;
      const o = opts.upload?.(mediaSeq);
      if (o) return reply(o.status ?? 200, o.body ?? { ok: false, error: 'server_error' });
      const id = `media-${mediaSeq}`;
      return reply(200, { ok: true, mediaId: id, storagePath: `a/${id}` });
    }
    if (href.includes('/url')) {
      const o = opts.url;
      return reply(o?.status ?? 200, o?.body ?? { ok: true, url: 'https://signed.example/x' });
    }
    if (method === 'DELETE') {
      // The real route refuses a DELETE carrying neither `?scope=everywhere`
      // nor `?destination=`. Answering 200 to the bare form is how this suite
      // stayed green over a client that malformed every cleanup call
      // (Codex independent review, 2026-09-02, CRITICAL) — so the stub now
      // enforces the contract rather than excusing it.
      const q = new URL(href, 'http://t').searchParams;
      const scoped = q.get('scope') === 'everywhere';
      const destination = q.get('destination');
      if ((!scoped && destination === null) || (scoped && destination !== null)) {
        return reply(400, { ok: false, error: 'bad_request' });
      }
      const o = opts.del;
      return reply(o?.status ?? 200, o?.body ?? { ok: true });
    }
    return reply(404, { ok: false, error: 'not_found' });
  });
  vi.stubGlobal('fetch', fetchMock);
}

/** The `/api/media/upload` calls recorded this test. */
const uploadCalls = (): unknown[][] =>
  (fetchMock?.mock.calls ?? []).filter((c) => String(c[0]).includes('/api/media/upload'));

/** The `GET /api/media/:id/url` mints recorded this test, as media ids. */
const urlCalls = (): string[] =>
  (fetchMock?.mock.calls ?? [])
    .filter((c) => String(c[0]).endsWith('/url'))
    .map((c) => String(c[0]).split('/').slice(-2)[0]);

/** The `DELETE /api/media/:id` calls recorded this test, as media ids. */
const deleteIds = (): string[] =>
  (fetchMock?.mock.calls ?? [])
    .filter((c) => ((c[1] as any)?.method ?? '').toUpperCase() === 'DELETE')
    // Strip the query — the id is the last PATH segment, and the call now
    // carries the `?scope=everywhere` the route requires.
    .map((c) => new URL(String(c[0]), 'http://t').pathname.split('/').pop() as string);

const blob = (): Blob => new Blob(['x'], { type: 'image/jpeg' });

/** A row shaped like what `publish_story` returns, for tests about the CALL. */
const storyRow = () => ({
  id: 's1', author_id: 'a', bar_id: null, caption: null,
  media_path: 'a/media-1', inset_path: null, media_kind: 'single',
  audience: 'custom', created_at: iso(0), expires_at: iso(86_400_000),
});

// Every test gets a working boundary unless it asks for a broken one.
beforeEach(() => installBoundary());
afterEach(() => vi.unstubAllGlobals());

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
    // THE BOUNDARY, NOT STORAGE. 0071 revoked the `story-media` INSERT policy, so
    // a direct client upload cannot succeed against a 0071 database at all — it
    // returns "new row violates row-level security policy" and the user is told
    // the photo could not be uploaded. Bytes reach the bucket only through
    // `POST /api/media/upload`, which re-encodes them server-side (V8-R-STO-014).
    // This assertion used to require `storage.upload`, which is why a green suite
    // coexisted with a feature that has never once worked in production.
    expect(storage.upload).not.toHaveBeenCalled();
    expect(uploadCalls()).toHaveLength(1);
    // The path is the one the SERVER minted and handed back, never one this
    // module composed: `publish_story` refuses any path without a registered,
    // non-reclaimed `media_objects` row behind it.
    expect(rpc).toHaveBeenCalledWith('publish_story', expect.objectContaining({
      p_media_path: 'a/media-1', p_media_kind: 'single', p_audience: 'friends',
    }));
    expect(result).toMatchObject({ ok: true, value: { id: 's1', authorId: 'a' } });
  });

  it('removes the uploaded bytes when publication fails — no orphan, no receipt', async () => {
    const { client } = clientStub({
      rpc: { data: null, error: { message: 'boom', code: 'XX000' } },
    });
    const result = await publishStory(client, {
      authorId: 'a', draftId: 'd', main: blob(), audience: 'friends',
    });
    expect(result.ok).toBe(false);
    // Deleted by MEDIA ID through the boundary, not by object key off Storage.
    expect(deleteIds()).toEqual(['media-1']);
    if (!result.ok) {
      expect(result.orphans).toEqual([]);
      expect(result.message).toMatch(/nothing was shared/i);
    }
  });

  it('reports the leftover keys when cleanup itself fails, rather than hiding them', async () => {
    installBoundary({ del: { status: 500, body: { ok: false } } });
    const { client } = clientStub({
      rpc: { data: null, error: { message: 'boom', code: 'XX000' } },
    });
    const result = await publishStory(client, {
      authorId: 'a', draftId: 'd', main: blob(), audience: 'friends',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.orphans).toEqual(['a/media-1']);
  });

  it('asks the boundary to remove the media EVERYWHERE, the only form it accepts', async () => {
    // A bare `DELETE /api/media/:id` is a 400 at the real route. This asserts
    // the scope is actually on the wire, because the previous version of this
    // suite proved only that "a DELETE happened" — which a 400 also satisfies.
    const { client } = clientStub({
      rpc: { data: null, error: { message: 'boom', code: 'XX000' } },
    });
    const result = await publishStory(client, {
      authorId: 'a', draftId: 'd', main: blob(), audience: 'friends',
    });
    expect(result.ok).toBe(false);
    const del = (fetchMock.mock.calls as any[]).find(
      (c) => (c[1]?.method ?? '').toUpperCase() === 'DELETE',
    );
    expect(String(del[0])).toContain('scope=everywhere');
    if (!result.ok) expect(result.orphans).toEqual([]);
  });

  it('reports an orphan when the boundary refuses the removal, never a silent clean', async () => {
    // 404 used to be read as "already gone". The route emits no semantic 404
    // for absent bytes, so that rule could only ever have turned a misrouted or
    // undeployed route into a false clean.
    installBoundary({ del: { status: 404, body: { ok: false, error: 'not_found' } } });
    const { client } = clientStub({
      rpc: { data: null, error: { message: 'boom', code: 'XX000' } },
    });
    const result = await publishStory(client, {
      authorId: 'a', draftId: 'd', main: blob(), audience: 'friends',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.orphans).toEqual(['a/media-1']);
  });

  it('cleans up the first photo when the second of a pair fails to upload', async () => {
    installBoundary({ upload: (n) => (n === 2 ? { status: 500, body: { ok: false } } : undefined) });
    const { client } = clientStub();
    const result = await publishStory(client, {
      authorId: 'a', draftId: 'd', main: blob(), inset: blob(), audience: 'friends',
    });
    expect(result.ok).toBe(false);
    expect(deleteIds()).toEqual(['media-1']);
  });

  it('refuses without a session rather than uploading bytes it cannot attach', async () => {
    const { client } = clientStub();
    client.auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
    const result = await publishStory(client, {
      authorId: 'a', draftId: 'd', main: blob(), audience: 'friends',
    });
    expect(result.ok).toBe(false);
    expect(uploadCalls()).toHaveLength(0);
  });

  it('surfaces a non-mutual custom recipient as a denial the user can act on', async () => {
    // The message is the RPC's ACTUAL raise, not a placeholder. A stub that
    // invents 'not mutual' proves only that a 42501 produced some denial — and
    // the code now reads the text, so a fake one tests the wrong thing.
    const { client } = clientStub({
      rpc: {
        data: null,
        error: {
          message: 'publish_story: every custom recipient must be a mutual friend',
          code: '42501',
        },
      },
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

  it('adds tagged people to a custom audience, so a tag cannot refuse the post', async () => {
    // `publish_story` refuses a custom story that tags anyone outside its
    // audience (0066). The composer could build exactly that, and the author
    // was told only that publication failed. A tag is an invitation now.
    const { client, rpc } = clientStub({ rpc: { data: storyRow(), error: null } });
    const result = await publishStory(client, {
      authorId: 'a', draftId: 'd', main: blob(), audience: 'custom',
      audienceIds: ['b'], tagIds: ['c', 'b', 'a'],
    });
    expect(result.ok).toBe(true);
    const sent = rpc.mock.calls[0][1] as { p_audience_ids: string[] };
    // 'b' is not duplicated, and the AUTHOR is not added — they are not their
    // own mutual friend, so folding 'a' in would refuse the post it is fixing.
    expect([...sent.p_audience_ids].sort()).toEqual(['b', 'c']);
  });

  it('leaves the audience alone for a friends story, where the ids are not read', async () => {
    const { client, rpc } = clientStub({ rpc: { data: storyRow(), error: null } });
    await publishStory(client, {
      authorId: 'a', draftId: 'd', main: blob(), audience: 'friends', tagIds: ['c'],
    });
    const sent = rpc.mock.calls[0][1] as { p_audience_ids: string[] };
    expect(sent.p_audience_ids).toEqual([]);
  });

  it('tells the author WHICH rule the server refused, not "could not be published"', async () => {
    const { client } = clientStub({
      rpc: {
        data: null,
        error: {
          message: "publish_story: everyone you tag must be in a custom story's audience",
          code: '42501',
        },
      },
    });
    const result = await publishStory(client, {
      authorId: 'a', draftId: 'd', main: blob(), audience: 'custom', audienceIds: ['b'],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/in the story audience too/i);
      expect(result.message).not.toMatch(/could not be published/i);
    }
  });
});

describe('fetchVisibleStories', () => {
  it('signs each story for no longer than that story has left', async () => {
    const rows = [
      { id: 'long', author_id: 'a', bar_id: null, caption: null, media_path: 'a/m1',
        inset_path: null, media_kind: 'single', audience: 'friends',
        created_at: iso(0), expires_at: iso(86_400_000) },
      { id: 'short', author_id: 'a', bar_id: null, caption: null, media_path: 'a/m2',
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
    // THE LIFETIME IS NO LONGER OURS TO ASK FOR — that is V8-R-STO-015, and it
    // is the point of routing through the boundary. Storage honoured whatever
    // `expiresIn` the caller passed, so the 300-second ceiling this file used to
    // assert was only ever a suggestion a modified client could ignore.
    // `/api/media/:id/url` accepts no TTL and caps at what the media has left,
    // so what is provable here is that each unexpired story was signed through
    // the route. The ceiling arithmetic itself stays covered, as a pure
    // function, by the `signedUrlTtlSeconds` block at the top of this file.
    expect(urlCalls()).toHaveLength(2);
    expect(urlCalls()).toEqual(['m1', 'm2']);
  });

  it('mints no URL at all for a story that has already expired', async () => {
    const rows = [
      { id: 'gone', author_id: 'a', bar_id: null, caption: null, media_path: 'a/m3',
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
    expect(urlCalls()).toHaveLength(0);
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
      { id: 's1', author_id: 'a', bar_id: null, caption: null, media_path: 'a/m1',
        inset_path: null, media_kind: 'single', audience: 'friends',
        created_at: iso(0), expires_at: iso(60_000) },
      { id: 's2', author_id: 'a', bar_id: null, caption: null, media_path: 'a/m2',
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
      { id: 's1', author_id: 'a', bar_id: null, caption: null, media_path: 'a/m1',
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
    media_path: 'a/m1', inset_path: null, media_kind: 'single',
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
    installBoundary({ url: { status: 500, body: { ok: false, error: 'server_error' } } });
    const { client } = clientStub();
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
    reportOrphans('publish', ['a/m1', 'a/m1i']);
    expect(error).toHaveBeenCalledTimes(1);
    const line = String(error.mock.calls[0][0]);
    expect(line).toContain(STORY_BUCKET);
    expect(line).toContain('a/m1');
    expect(line).toContain('a/m1i');
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
      [{ media_path: 'a/m1', inset_path: 'a/m1i' }],
      { rpc: { data: [{ media_path: 'a/m1', inset_path: 'a/m1i' }], error: null } },
    );
    const result = await deleteStory(client, 's1');
    expect(result.ok).toBe(true);
    expect(deleteIds()).toEqual(['m1', 'm1i']);
    // Ordering is the whole point: removal must precede delete_story.
    expect(fetchMock.mock.invocationCallOrder[0])
      .toBeLessThan(rpc.mock.invocationCallOrder[0]);
  });

  it('tells the author honestly when the bytes went but the delete did not', async () => {
    const { client } = withPreRead(
      [{ media_path: 'a/m1', inset_path: null }],
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
    expect(deleteIds()).toEqual([]);
  });

  it('still succeeds but reports orphans when the byte removal fails', async () => {
    installBoundary({ del: { status: 500, body: { ok: false } } });
    const { client } = withPreRead(
      [{ media_path: 'a/m1', inset_path: null }],
      { rpc: { data: [{ media_path: 'a/m1', inset_path: null }], error: null } },
    );
    const result = await deleteStory(client, 's1');
    expect(result).toMatchObject({ ok: true, value: { orphans: ['a/m1'] } });
  });

  it('retries a failed removal once before reporting an orphan', async () => {
    const { client, storage } = withPreRead(
      [{ media_path: 'a/m1', inset_path: null }],
      { rpc: { data: [{ media_path: 'a/m1', inset_path: null }], error: null } },
    );
    let call = 0;
    installBoundary({ del: undefined });
    // First DELETE fails transiently, the retry succeeds.
    const inner = fetchMock as unknown as (i: any, n?: any) => Promise<any>;
    vi.stubGlobal('fetch', vi.fn(async (input: any, init?: any) => {
      if ((init?.method ?? '').toUpperCase() === 'DELETE') {
        call += 1;
        if (call === 1) throw new Error('transient');
      }
      return inner(input, init);
    }));
    const result = await deleteStory(client, 's1');
    expect(call).toBe(2);
    // The retry succeeded, so there is nothing to report.
    expect(result).toMatchObject({ ok: true, value: { orphans: [] } });
  });

  // The soft-delete has already committed by the time the bytes are touched. A
  // THROW from storage (not a returned error) used to escape to the outer catch
  // and surface as "unavailable", telling the author their delete failed while
  // the row was already gone for every reader.
  it('reports success, not failure, when byte removal THROWS after the row is deleted', async () => {
    const { client, storage } = withPreRead(
      [{ media_path: 'a/m1', inset_path: null }],
      { rpc: { data: [{ media_path: 'a/m1', inset_path: null }], error: null } },
    );
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network died'); }));
    const result = await deleteStory(client, 's1');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.orphans).toEqual(['a/m1']);
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

describe('publishStory — a refusal that is OURS is not blamed on the author', () => {
  it('does not tell an author to fix their friend list when the path was rejected', async () => {
    // `media_path is not owned by the caller` is a 42501 too, and it is OUR bug.
    // Branching the MESSAGE off the errcode told that author "everyone you pick
    // has to be a friend who follows you back" — a problem they do not have and
    // cannot act on. The code still reads as a denial; the wording does not.
    const { client } = clientStub({
      rpc: {
        data: null,
        error: {
          message: 'publish_story: media_path is not owned by the caller',
          code: '42501',
        },
      },
    });
    const result = await publishStory(client, {
      authorId: 'a', draftId: 'd', main: blob(), audience: 'friends',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('denied');
      expect(result.message).not.toMatch(/follows you back/i);
      expect(result.message).toMatch(/could not be published/i);
    }
  });
});
