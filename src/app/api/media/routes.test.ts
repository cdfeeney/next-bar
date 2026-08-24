import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The three media routes, exercised as routes.
 *
 * Everything under `src/lib/media` was already covered, and every one of those
 * helpers passed while the delete route stamped the WRONG ROW: the defect lived
 * in the handler's own wiring — which id it hands to which client — and a suite
 * that only tests pure helpers cannot see wiring. So the boundary mocked here is
 * `serverClients`, the one seam that reaches Supabase, and the handler logic
 * above it is real.
 *
 * What each block pins is the half of a requirement that lives in the route:
 *
 *   V8-R-STO-014  bytes are refused before they are buffered, and a destination
 *                 the caller does not own is never attached.
 *   V8-R-STO-015  the URL is minted with SERVICE ROLE and only after the
 *                 database has said this caller may read the object.
 *   V8-R-FEED-009 a viewer the block check refuses gets no URL.
 *   V8-R-CMP-015  the removal's OWN media id is stamped, never the path segment.
 */

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

const readMediaEnv = vi.fn();
const bearerToken = vi.fn();
const adminClient = vi.fn();
const callerClient = vi.fn();
const verifiedUserId = vi.fn();
const reEncodeImage = vi.fn();

vi.mock('@/lib/media/serverClients', () => ({
  readMediaEnv: () => readMediaEnv(),
  bearerToken: (request: Request) => bearerToken(request),
  adminClient: () => adminClient(),
  callerClient: () => callerClient(),
  verifiedUserId: (...args: unknown[]) => verifiedUserId(...args),
}));

vi.mock('@/lib/media/reEncode', () => ({
  MAX_UPLOAD_BYTES,
  reEncodeImage: (bytes: Uint8Array) => reEncodeImage(bytes),
}));

const { DELETE } = await import('./[mediaId]/route');
const { GET } = await import('./[mediaId]/url/route');
const { POST } = await import('./upload/route');

const ENV = { url: 'https://example.test', anonKey: 'anon', serviceKey: 'service' };

/**
 * A PostgREST query builder that is both chainable and awaitable.
 *
 * The routes end some chains on `.maybeSingle()`/`.single()` and others on the
 * builder itself (`await admin.from(t).select().eq()`), so the mock has to
 * answer to both shapes or the test would only be checking the shapes it
 * happened to guess.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function builder(result: unknown): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {};
  for (const method of ['select', 'eq', 'is', 'in', 'order', 'update', 'insert']) {
    chain[method] = vi.fn(() => chain);
  }
  chain.maybeSingle = vi.fn(async () => result);
  chain.single = vi.fn(async () => result);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  chain.then = (onOk: any, onErr: any) => Promise.resolve(result).then(onOk, onErr);
  return chain;
}

/**
 * A client whose `from(table)` returns one stable builder per table.
 *
 * `any` on the way out is deliberate: each test replaces `rpc` and
 * `storage.from` with a stub returning a DIFFERENT shape, and a structurally
 * inferred type would pin those members to whatever this default happened to
 * return and reject every one of them.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db(tables: Record<string, unknown>, storage?: Record<string, unknown>): any {
  const builders = Object.fromEntries(
    Object.entries(tables).map(([table, result]) => [table, builder(result)]),
  );
  return {
    builders,
    client: {
      from: vi.fn((table: string) => builders[table] ?? builder({ data: null, error: null })),
      storage: { from: vi.fn(() => storage ?? {}) },
      rpc: vi.fn(async () => ({ data: null, error: null })),
    },
  };
}

function signedIn(userId = 'owner-1') {
  readMediaEnv.mockReturnValue(ENV);
  bearerToken.mockReturnValue('token');
  verifiedUserId.mockResolvedValue(userId);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('DELETE /api/media/:mediaId', () => {
  it('refuses a request with no bearer token', async () => {
    readMediaEnv.mockReturnValue(ENV);
    bearerToken.mockReturnValue(null);

    const response = await DELETE(
      new Request('https://app.test/api/media/m1?scope=everywhere', { method: 'DELETE' }),
      { params: { mediaId: 'm1' } },
    );

    expect(response.status).toBe(401);
  });

  it('refuses a token that does not verify', async () => {
    readMediaEnv.mockReturnValue(ENV);
    bearerToken.mockReturnValue('token');
    verifiedUserId.mockResolvedValue(null);

    const response = await DELETE(
      new Request('https://app.test/api/media/m1?scope=everywhere', { method: 'DELETE' }),
      { params: { mediaId: 'm1' } },
    );

    expect(response.status).toBe(401);
  });

  it('refuses a call that names neither verb', async () => {
    signedIn();
    adminClient.mockReturnValue(db({}).client);

    const response = await DELETE(
      new Request('https://app.test/api/media/m1', { method: 'DELETE' }),
      { params: { mediaId: 'm1' } },
    );

    expect(response.status).toBe(400);
  });

  it('refuses an ambiguous scope rather than guessing the destructive one', async () => {
    signedIn();
    adminClient.mockReturnValue(db({}).client);

    const response = await DELETE(
      new Request('https://app.test/api/media/m1?destination=d1&scope=everywhere', {
        method: 'DELETE',
      }),
      { params: { mediaId: 'm1' } },
    );

    expect(response.status).toBe(400);
  });

  // THE REGRESSION THIS FILE EXISTS FOR. `:mediaId` is an unvalidated path
  // segment; the destination the RPC actually removed need not belong to it. If
  // the handler stamps the path's id, a service-role write marks somebody else's
  // live media byte-removed — a 404 for bytes that are still there.
  it('stamps the media the RPC removed, never the id in the URL', async () => {
    signedIn();
    const admin = db(
      { media_objects: { data: null, error: null } },
      { remove: vi.fn(async () => ({ error: null })) },
    );
    adminClient.mockReturnValue(admin.client);

    const caller = db({}).client;
    caller.rpc = vi.fn(async () => ({
      data: [{
        media_id: 'really-mine',
        bucket_id: 'story-media',
        storage_path: 'owner-1/really-mine',
        reclaimable: true,
      }],
      error: null,
    }));
    callerClient.mockReturnValue(caller);

    const response = await DELETE(
      new Request('https://app.test/api/media/someone-elses?destination=d1', {
        method: 'DELETE',
      }),
      { params: { mediaId: 'someone-elses' } },
    );

    expect(response.status).toBe(200);
    expect(admin.builders.media_objects.eq).toHaveBeenCalledWith('id', 'really-mine');
    expect(admin.builders.media_objects.eq)
      .not.toHaveBeenCalledWith('id', 'someone-elses');
  });

  it('does not stamp anything when the removal left the bytes referenced', async () => {
    signedIn();
    const admin = db({ media_objects: { data: null, error: null } });
    adminClient.mockReturnValue(admin.client);

    const caller = db({}).client;
    caller.rpc = vi.fn(async () => ({
      data: [{
        media_id: 'm1',
        bucket_id: 'story-media',
        storage_path: 'owner-1/m1',
        reclaimable: false,
      }],
      error: null,
    }));
    callerClient.mockReturnValue(caller);

    const response = await DELETE(
      new Request('https://app.test/api/media/m1?destination=d1', { method: 'DELETE' }),
      { params: { mediaId: 'm1' } },
    );

    expect(response.status).toBe(200);
    expect(admin.builders.media_objects.update).not.toHaveBeenCalled();
  });

  it('reports a refused removal as denied instead of as a success', async () => {
    signedIn();
    adminClient.mockReturnValue(db({}).client);

    const caller = db({}).client;
    // Zero rows: not the author, or already removed.
    caller.rpc = vi.fn(async () => ({ data: [], error: null }));
    callerClient.mockReturnValue(caller);

    const response = await DELETE(
      new Request('https://app.test/api/media/m1?destination=d1', { method: 'DELETE' }),
      { params: { mediaId: 'm1' } },
    );

    expect(response.status).toBe(403);
  });

  it('states the references an archive hold kept, rather than reporting a full delete', async () => {
    signedIn();
    const admin = db({ media_objects: { data: null, error: null } });
    adminClient.mockReturnValue(admin.client);

    const caller = db({}).client;
    caller.rpc = vi.fn(async () => ({
      data: [{
        bucket_id: 'story-media',
        storage_path: 'owner-1/m1',
        reclaimable: false,
        remaining_references: 1,
      }],
      error: null,
    }));
    callerClient.mockReturnValue(caller);

    const response = await DELETE(
      new Request('https://app.test/api/media/m1?scope=everywhere', { method: 'DELETE' }),
      { params: { mediaId: 'm1' } },
    );

    const body = await response.json();
    expect(body).toMatchObject({
      ok: true,
      scope: 'everywhere',
      bytesReclaimed: false,
      remainingReferences: 1,
    });
    expect(admin.builders.media_objects.update).not.toHaveBeenCalled();
  });
});

describe('GET /api/media/:mediaId/url', () => {
  function urlAdmin(destinations: unknown[], removedAt: string | null = null) {
    return db({
      media_objects: {
        data: { storage_path: 'owner-1/m1', bytes_removed_at: removedAt },
        error: null,
      },
      media_destinations: { data: destinations, error: null },
      stories: {
        data: [{ id: 's1', expires_at: new Date(Date.now() + 3_600_000).toISOString() }],
        error: null,
      },
    });
  }

  function readerCaller(permitted: unknown) {
    const caller = db({}).client;
    caller.rpc = vi.fn(async () => ({ data: permitted, error: null }));
    return caller;
  }

  it('refuses an unauthenticated caller', async () => {
    readMediaEnv.mockReturnValue(ENV);
    bearerToken.mockReturnValue(null);

    const response = await GET(
      new Request('https://app.test/api/media/m1/url'),
      { params: { mediaId: 'm1' } },
    );

    expect(response.status).toBe(401);
  });

  it('is not found once the bytes are stamped removed', async () => {
    signedIn();
    adminClient.mockReturnValue(urlAdmin([], '2026-08-24T00:00:00.000Z').client);
    callerClient.mockReturnValue(readerCaller(true));

    const response = await GET(
      new Request('https://app.test/api/media/m1/url'),
      { params: { mediaId: 'm1' } },
    );

    expect(response.status).toBe(404);
  });

  // V8-R-FEED-009. The block, the audience and the expiry all live behind
  // can_read_media_path; a false answer must stop the mint entirely, and it is
  // reported as not_found because "this id exists" is itself audience
  // information.
  it('mints nothing when the database says this caller may not read it', async () => {
    signedIn('viewer-9');
    const admin = urlAdmin([{ kind: 'story', ref_id: 's1' }]);
    const createSignedUrl = vi.fn(async () => ({
      data: { signedUrl: 'https://signed.test/x' },
      error: null,
    }));
    admin.client.storage.from = vi.fn(() => ({ createSignedUrl }));
    adminClient.mockReturnValue(admin.client);
    callerClient.mockReturnValue(readerCaller(false));

    const response = await GET(
      new Request('https://app.test/api/media/m1/url'),
      { params: { mediaId: 'm1' } },
    );

    expect(response.status).toBe(404);
    expect(createSignedUrl).not.toHaveBeenCalled();
  });

  it('FAILS CLOSED when the read check itself errors', async () => {
    signedIn('viewer-9');
    const admin = urlAdmin([{ kind: 'story', ref_id: 's1' }]);
    const createSignedUrl = vi.fn(async () => ({
      data: { signedUrl: 'https://signed.test/x' },
      error: null,
    }));
    admin.client.storage.from = vi.fn(() => ({ createSignedUrl }));
    adminClient.mockReturnValue(admin.client);

    const caller = db({}).client;
    caller.rpc = vi.fn(async () => ({ data: null, error: { message: 'down' } }));
    callerClient.mockReturnValue(caller);

    const response = await GET(
      new Request('https://app.test/api/media/m1/url'),
      { params: { mediaId: 'm1' } },
    );

    expect(response.status).toBe(404);
    expect(createSignedUrl).not.toHaveBeenCalled();
  });

  // V8-R-STO-015. 0066 revokes the authenticated read grant precisely so a
  // client cannot mint its own lifetime; the signing client must therefore be
  // the service-role one, and the TTL must come from the media's own window.
  it('signs with the service-role client and a server-decided lifetime', async () => {
    signedIn('viewer-9');
    const admin = urlAdmin([{ kind: 'story', ref_id: 's1' }]);
    // Named parameters, so the TTL assertion below reads a typed argument
    // rather than indexing an empty tuple.
    const createSignedUrl = vi.fn(async (_path: string, _ttlSeconds: number) => ({
      data: { signedUrl: 'https://signed.test/x' },
      error: null,
    }));
    admin.client.storage.from = vi.fn(() => ({ createSignedUrl }));
    adminClient.mockReturnValue(admin.client);

    const caller = readerCaller(true);
    // The caller's own client must not be the one that signs.
    caller.storage.from = vi.fn(() => ({
      createSignedUrl: vi.fn(async () => ({ data: null, error: { message: 'denied' } })),
    }));
    callerClient.mockReturnValue(caller);

    const response = await GET(
      new Request('https://app.test/api/media/m1/url'),
      { params: { mediaId: 'm1' } },
    );

    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.url).toBe('https://signed.test/x');
    expect(createSignedUrl).toHaveBeenCalledTimes(1);
    // 300s ceiling, and never the ~3600s the story itself has left.
    expect(createSignedUrl.mock.calls[0][1]).toBe(300);
  });

  // V8-R-CMP-016's end state is "audience: nobody". A retention hold keeps the
  // bytes; it does not make them readable, not even for their owner.
  it('is not found when only a Saved Nights Out archive hold survives', async () => {
    signedIn();
    const admin = urlAdmin([{ kind: 'archive', ref_id: 'night-1' }]);
    const createSignedUrl = vi.fn();
    admin.client.storage.from = vi.fn(() => ({ createSignedUrl }));
    adminClient.mockReturnValue(admin.client);
    callerClient.mockReturnValue(readerCaller(true));

    const response = await GET(
      new Request('https://app.test/api/media/m1/url'),
      { params: { mediaId: 'm1' } },
    );

    expect(response.status).toBe(404);
    expect(createSignedUrl).not.toHaveBeenCalled();
  });
});

describe('POST /api/media/upload', () => {
  /**
   * A request stub rather than a real `Request` with a FormData body.
   *
   * `Request.formData()` decodes the multipart body with undici's `File`, while
   * the route — and this test — resolve `File` from the jsdom global. The two
   * are different classes, so `candidate instanceof File` was false and EVERY
   * upload returned 400: four assertions here passed for the wrong reason
   * before the one that expects 200 exposed it. Handing the route the same
   * FormData object keeps both sides in one realm.
   */
  function uploadRequest(fields: Record<string, string> = {}, headers: HeadersInit = {}) {
    const form = new FormData();
    form.set('file', new File([new Uint8Array([1, 2, 3])], 'p.jpg', { type: 'image/jpeg' }));
    for (const [key, value] of Object.entries(fields)) form.set(key, value);
    return {
      headers: new Headers(headers),
      formData: async () => form,
    } as unknown as Request;
  }

  function uploadAdmin(story: unknown) {
    const admin = db({
      stories: { data: story, error: null },
      media_objects: { data: { id: 'new-media' }, error: null },
      media_destinations: { error: null },
    });
    admin.client.storage.from = vi.fn(() => ({
      upload: vi.fn(async () => ({ error: null })),
      remove: vi.fn(async () => ({ error: null })),
    }));
    return admin;
  }

  it('refuses an unauthenticated upload', async () => {
    readMediaEnv.mockReturnValue(ENV);
    bearerToken.mockReturnValue(null);

    const response = await POST(uploadRequest());

    expect(response.status).toBe(401);
    expect(reEncodeImage).not.toHaveBeenCalled();
  });

  // The size bound has to bite BEFORE formData() buffers the body, or an
  // oversized upload is refused only after the process has already held all of
  // it in memory.
  it('refuses an oversized body on its declared length, before reading it', async () => {
    signedIn();
    adminClient.mockReturnValue(uploadAdmin(null).client);

    const request = uploadRequest({}, { 'content-length': String(MAX_UPLOAD_BYTES + 1) });
    const formData = vi.spyOn(request, 'formData');

    const response = await POST(request);

    expect(response.status).toBe(413);
    expect(formData).not.toHaveBeenCalled();
  });

  // `archive` is a retention hold that delete_media_everywhere deliberately
  // never clears. A client that could mint one would hold its own bytes past
  // every deletion verb the product offers.
  it('refuses a client-named archive hold', async () => {
    signedIn();
    adminClient.mockReturnValue(uploadAdmin(null).client);
    reEncodeImage.mockResolvedValue({
      ok: true,
      value: { bytes: new Uint8Array([9]), contentType: 'image/jpeg', width: 10, height: 10 },
    });

    const response = await POST(
      uploadRequest({ destinationKind: 'archive', destinationRef: 'night-1' }),
    );

    expect(response.status).toBe(400);
  });

  // media_destinations.ref_id has no foreign key and the insert runs with
  // service role, so an unchecked ref attaches the caller's media to another
  // user's story for everything that reads the spine by (kind, ref_id).
  it('refuses a story destination the caller does not author', async () => {
    signedIn('attacker');
    const admin = uploadAdmin(null); // the ownership-scoped lookup finds nothing
    adminClient.mockReturnValue(admin.client);
    reEncodeImage.mockResolvedValue({
      ok: true,
      value: { bytes: new Uint8Array([9]), contentType: 'image/jpeg', width: 10, height: 10 },
    });

    const response = await POST(
      uploadRequest({ destinationKind: 'story', destinationRef: 'victims-story' }),
    );

    expect(response.status).toBe(400);
    // The lookup really ran and really was ownership-scoped — otherwise this
    // 400 could be any earlier refusal and would prove nothing.
    expect(admin.builders.stories.eq).toHaveBeenCalledWith('author_id', 'attacker');
    expect(admin.builders.media_destinations.insert).not.toHaveBeenCalled();
  });

  it('scopes the ownership lookup to the VERIFIED caller, not a request field', async () => {
    signedIn('owner-1');
    const admin = uploadAdmin({ id: 's1' });
    adminClient.mockReturnValue(admin.client);
    reEncodeImage.mockResolvedValue({
      ok: true,
      value: { bytes: new Uint8Array([9]), contentType: 'image/jpeg', width: 10, height: 10 },
    });

    const response = await POST(
      uploadRequest({ destinationKind: 'story', destinationRef: 's1' }),
    );

    expect(response.status).toBe(200);
    expect(admin.builders.stories.eq).toHaveBeenCalledWith('author_id', 'owner-1');
    expect(admin.builders.media_destinations.insert).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'story', ref_id: 's1' }),
    );
  });

  it('never stores the original bytes when the re-encode refuses them', async () => {
    signedIn();
    const admin = uploadAdmin(null);
    const upload = vi.fn(async () => ({ error: null }));
    admin.client.storage.from = vi.fn(() => ({ upload, remove: vi.fn() }));
    adminClient.mockReturnValue(admin.client);
    reEncodeImage.mockResolvedValue({ ok: false, reason: 'rejected', message: 'no' });

    const response = await POST(uploadRequest());

    expect(response.status).toBe(400);
    expect(upload).not.toHaveBeenCalled();
  });
});
