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
const readUploadForm = vi.fn();

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

/**
 * The multipart parse is mocked because it CANNOT run here, and the reason is
 * worth recording rather than rediscovering.
 *
 * undici's `formData()` builds each part with the GLOBAL `File` constructor and
 * then validates it with its own `webidl.is.File`. Under vitest's jsdom
 * environment the global `File` is jsdom's, so undici rejects the very object it
 * just created — every multipart body fails to parse, whatever it contains.
 * Verified by probe: "assert(typeof value === 'string' && webidl.is.USVString
 * (value) || webidl.is.File(value))".
 *
 * So the seam is a real module boundary, not a test-only hook:
 * `src/lib/media/uploadBody.ts` owns the bounded read AND the parse, its
 * bounding logic is unit-tested against real streams in uploadBody.test.ts, and
 * these route tests supply an already-parsed form.
 */
vi.mock('@/lib/media/uploadBody', () => ({
  readUploadForm: (request: Request, limit: number) => readUploadForm(request, limit),
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
  for (const method of ['select', 'eq', 'is', 'in', 'order', 'update', 'insert', 'delete']) {
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
  /**
   * A caller client for the delete path.
   *
   * The route makes TWO RPCs on it: the deletion verb, then
   * media_path_has_live_reference as the last-moment re-check. They are
   * dispatched by name so a test can answer each one independently — which is
   * the whole point, since the re-check is what decides whether the bytes go.
   */
  function deleteCaller(removal: unknown, stillReferenced = false) {
    const caller = db({}).client;
    caller.rpc = vi.fn(async (name: string) => (
      name === 'media_path_has_live_reference'
        ? { data: stillReferenced, error: null }
        : { data: removal, error: null }
    ));
    return caller;
  }

  const REMOVED = (path: string) => ({
    data: [{ name: path }],
    error: null,
  });

  it('stamps the media the RPC removed, never the id in the URL', async () => {
    signedIn();
    const admin = db(
      { media_objects: { data: null, error: null } },
      { remove: vi.fn(async () => REMOVED('owner-1/really-mine')) },
    );
    adminClient.mockReturnValue(admin.client);
    callerClient.mockReturnValue(deleteCaller([{
      media_id: 'really-mine',
      bucket_id: 'story-media',
      storage_path: 'owner-1/really-mine',
      reclaimable: true,
    }]));

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

  // 0066 revokes every story-media SELECT policy and Storage must SEE an object
  // to delete it, so a caller-scoped remove matches nothing — and reports that
  // by returning an empty list with NO error. The removal therefore runs with
  // service role, and the race is caught by the explicit re-check instead.
  it('removes the bytes with the service-role client', async () => {
    signedIn();
    const adminRemove = vi.fn(async () => REMOVED('owner-1/m1'));
    const admin = db({ media_objects: { data: null, error: null } }, { remove: adminRemove });
    adminClient.mockReturnValue(admin.client);
    callerClient.mockReturnValue(deleteCaller([{
      media_id: 'm1',
      bucket_id: 'story-media',
      storage_path: 'owner-1/m1',
      reclaimable: true,
    }]));

    await DELETE(
      new Request('https://app.test/api/media/m1?destination=d1', { method: 'DELETE' }),
      { params: { mediaId: 'm1' } },
    );

    expect(adminRemove).toHaveBeenCalledWith(['owner-1/m1']);
  });

  // THE RACE. The RPC answered "reclaimable" under a row lock it has since
  // released. If a reference reappeared in that window the bytes must stay, and
  // nothing may be stamped as removed.
  it('keeps the bytes when a reference reappears before the removal', async () => {
    signedIn();
    const adminRemove = vi.fn(async () => REMOVED('owner-1/m1'));
    const admin = db({ media_objects: { data: null, error: null } }, { remove: adminRemove });
    adminClient.mockReturnValue(admin.client);
    callerClient.mockReturnValue(deleteCaller([{
      media_id: 'm1',
      bucket_id: 'story-media',
      storage_path: 'owner-1/m1',
      reclaimable: true,
    }], true));

    const response = await DELETE(
      new Request('https://app.test/api/media/m1?destination=d1', { method: 'DELETE' }),
      { params: { mediaId: 'm1' } },
    );

    const body = await response.json();
    expect(adminRemove).not.toHaveBeenCalled();
    expect(body.bytesReclaimed).toBe(false);
    expect(body.orphanedPaths).toEqual(['owner-1/m1']);
    expect(admin.builders.media_objects.update).not.toHaveBeenCalled();
  });

  // Storage reports a skipped object by leaving it out of the removed list,
  // with error null. Reading that as success would stamp bytes_removed_at on
  // bytes still in the bucket.
  it('reports an orphan and does not stamp when Storage silently skips the object', async () => {
    signedIn();
    const admin = db(
      { media_objects: { data: null, error: null } },
      { remove: vi.fn(async () => ({ data: [], error: null })) },
    );
    adminClient.mockReturnValue(admin.client);
    callerClient.mockReturnValue(deleteCaller([{
      media_id: 'm1',
      bucket_id: 'story-media',
      storage_path: 'owner-1/m1',
      reclaimable: true,
    }]));

    const response = await DELETE(
      new Request('https://app.test/api/media/m1?destination=d1', { method: 'DELETE' }),
      { params: { mediaId: 'm1' } },
    );

    const body = await response.json();
    expect(body.bytesReclaimed).toBe(false);
    expect(body.orphanedPaths).toEqual(['owner-1/m1']);
    expect(admin.builders.media_objects.update).not.toHaveBeenCalled();
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
  function urlAdmin(removedAt: string | null = null) {
    return db({
      media_objects: {
        data: { storage_path: 'owner-1/m1', bytes_removed_at: removedAt },
        error: null,
      },
    });
  }

  /** `media_read_window` is set-returning, so it comes back as an array. */
  function readerCaller(window: unknown) {
    const caller = db({}).client;
    caller.rpc = vi.fn(async () => ({ data: window, error: null }));
    return caller;
  }

  const READABLE = [{
    readable: true,
    expires_at: new Date(Date.now() + 3_600_000).toISOString(),
  }];

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
    adminClient.mockReturnValue(urlAdmin('2026-08-24T00:00:00.000Z').client);
    callerClient.mockReturnValue(readerCaller(READABLE));

    const response = await GET(
      new Request('https://app.test/api/media/m1/url'),
      { params: { mediaId: 'm1' } },
    );

    expect(response.status).toBe(404);
  });

  // V8-R-FEED-009. The block, the audience and the expiry all live behind
  // media_read_window; a refusal must stop the mint entirely, and it is
  // reported as not_found because "this id exists" is itself audience
  // information.
  it('mints nothing when the database says this caller may not read it', async () => {
    signedIn('viewer-9');
    const admin = urlAdmin();
    const createSignedUrl = vi.fn(async () => ({
      data: { signedUrl: 'https://signed.test/x' },
      error: null,
    }));
    admin.client.storage.from = vi.fn(() => ({ createSignedUrl }));
    adminClient.mockReturnValue(admin.client);
    callerClient.mockReturnValue(readerCaller([{ readable: false, expires_at: null }]));

    const response = await GET(
      new Request('https://app.test/api/media/m1/url'),
      { params: { mediaId: 'm1' } },
    );

    expect(response.status).toBe(404);
    expect(createSignedUrl).not.toHaveBeenCalled();
  });

  it('FAILS CLOSED when the read check itself errors', async () => {
    signedIn('viewer-9');
    const admin = urlAdmin();
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

  it('FAILS CLOSED when the window function answers with no row at all', async () => {
    signedIn('viewer-9');
    const admin = urlAdmin();
    const createSignedUrl = vi.fn();
    admin.client.storage.from = vi.fn(() => ({ createSignedUrl }));
    adminClient.mockReturnValue(admin.client);
    callerClient.mockReturnValue(readerCaller([]));

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
    const admin = urlAdmin();
    // Named parameters, so the TTL assertion below reads a typed argument
    // rather than indexing an empty tuple.
    const createSignedUrl = vi.fn(async (_path: string, _ttlSeconds: number) => ({
      data: { signedUrl: 'https://signed.test/x' },
      error: null,
    }));
    admin.client.storage.from = vi.fn(() => ({ createSignedUrl }));
    adminClient.mockReturnValue(admin.client);

    const caller = readerCaller(READABLE);
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
    expect(createSignedUrl).toHaveBeenCalledWith('owner-1/m1', 300);
    // 300s ceiling, and never the ~3600s the story itself has left.
    expect(createSignedUrl.mock.calls[0][1]).toBe(300);
  });

  // The lifetime is the CALLER's, not the longest one anybody holds. When the
  // window that authorised this caller ends sooner than the ceiling, the URL
  // ends with it.
  it('cuts the lifetime to the caller own window when it is shorter than the ceiling', async () => {
    signedIn('viewer-9');
    const admin = urlAdmin();
    const createSignedUrl = vi.fn(async (_path: string, _ttlSeconds: number) => ({
      data: { signedUrl: 'https://signed.test/x' },
      error: null,
    }));
    admin.client.storage.from = vi.fn(() => ({ createSignedUrl }));
    adminClient.mockReturnValue(admin.client);
    callerClient.mockReturnValue(readerCaller([{
      readable: true,
      expires_at: new Date(Date.now() + 42_000).toISOString(),
    }]));

    const response = await GET(
      new Request('https://app.test/api/media/m1/url'),
      { params: { mediaId: 'm1' } },
    );

    expect(response.status).toBe(200);
    expect(createSignedUrl.mock.calls[0][1]).toBeLessThanOrEqual(42);
    expect(createSignedUrl.mock.calls[0][1]).toBeGreaterThan(0);
  });

  // The route asks the caller's own client, so the definer function sees the
  // real auth.uid(). Asking on the service-role client would make the answer
  // "yes" for everybody.
  it('asks the window function as the caller, not as the service role', async () => {
    signedIn('viewer-9');
    const admin = urlAdmin();
    admin.client.storage.from = vi.fn(() => ({
      createSignedUrl: vi.fn(async () => ({
        data: { signedUrl: 'https://signed.test/x' },
        error: null,
      })),
    }));
    adminClient.mockReturnValue(admin.client);

    const caller = readerCaller(READABLE);
    callerClient.mockReturnValue(caller);

    await GET(
      new Request('https://app.test/api/media/m1/url'),
      { params: { mediaId: 'm1' } },
    );

    expect(caller.rpc).toHaveBeenCalledWith('media_read_window', {
      p_name: 'owner-1/m1',
    });
    expect(admin.client.rpc).not.toHaveBeenCalled();
  });
});

describe('POST /api/media/upload', () => {
  /**
   * A request stub plus the form the (mocked) parser will hand back.
   *
   * `readUploadForm` is armed here rather than in each test so the default is a
   * well-formed upload; tests about refusal override the mock or the headers.
   */
  function uploadRequest(
    fields: Record<string, string> = {},
    // A declared length is REQUIRED by the route, so the default here is a
    // well-formed request. Tests about the length itself override it.
    headers: HeadersInit = { 'content-length': '1024' },
  ) {
    const form = new FormData();
    form.set('file', new File([new Uint8Array([1, 2, 3])], 'p.jpg', { type: 'image/jpeg' }));
    for (const [key, value] of Object.entries(fields)) form.set(key, value);
    readUploadForm.mockResolvedValue(form);

    return {
      request: {
        headers: new Headers({
          'content-type': 'multipart/form-data; boundary=testboundary',
          ...Object.fromEntries(new Headers(headers).entries()),
        }),
      } as unknown as Request,
      form,
    };
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

    const response = await POST(uploadRequest().request);

    expect(response.status).toBe(401);
    expect(reEncodeImage).not.toHaveBeenCalled();
  });

  // The declared length is a cheap early refusal: an honest oversized upload is
  // turned away without the body ever being read.
  it('refuses an oversized body on its declared length, before reading it', async () => {
    signedIn();
    adminClient.mockReturnValue(uploadAdmin(null).client);

    const { request } = uploadRequest(
      {},
      { 'content-length': String(MAX_UPLOAD_BYTES + 1) },
    );

    const response = await POST(request);

    expect(response.status).toBe(413);
    expect(readUploadForm).not.toHaveBeenCalled();
  });

  // AND THE DECLARED LENGTH IS NOT TRUSTED. A request may say 1 KiB and send a
  // gigabyte, so the cap is also applied to the bytes as they arrive — that is
  // readUploadForm's 'too_large', and the route has to honour it rather than
  // treating a non-FormData answer as a parse failure.
  it('refuses a body that outruns its own declared length', async () => {
    signedIn();
    adminClient.mockReturnValue(uploadAdmin(null).client);

    const { request } = uploadRequest({}, { 'content-length': '32' });
    readUploadForm.mockResolvedValue('too_large');

    const response = await POST(request);

    expect(response.status).toBe(413);
    expect(reEncodeImage).not.toHaveBeenCalled();
  });

  it('refuses a body it could not parse', async () => {
    signedIn();
    adminClient.mockReturnValue(uploadAdmin(null).client);

    const { request } = uploadRequest();
    readUploadForm.mockResolvedValue('bad_request');

    const response = await POST(request);

    expect(response.status).toBe(400);
    expect(reEncodeImage).not.toHaveBeenCalled();
  });

  // Without this the pre-check was defeated by simply not declaring a length:
  // Number(null) is NaN, the branch fell through, and a chunked body of any
  // size was buffered in full before file.size was ever consulted.
  it('refuses a body that declares no length at all, before reading it', async () => {
    signedIn();
    adminClient.mockReturnValue(uploadAdmin(null).client);

    const { request } = uploadRequest({}, {});

    const response = await POST(request);

    expect(response.status).toBe(411);
    expect(readUploadForm).not.toHaveBeenCalled();
  });

  it('refuses an unparseable declared length rather than reading past it', async () => {
    signedIn();
    adminClient.mockReturnValue(uploadAdmin(null).client);

    const { request } = uploadRequest({}, { 'content-length': 'not-a-number' });

    const response = await POST(request);

    expect(response.status).toBe(411);
    expect(readUploadForm).not.toHaveBeenCalled();
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
      uploadRequest({ destinationKind: 'archive', destinationRef: 'night-1' }).request,
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
      uploadRequest({ destinationKind: 'story', destinationRef: 'victims-story' }).request,
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
      uploadRequest({ destinationKind: 'story', destinationRef: 's1' }).request,
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

    const response = await POST(uploadRequest().request);

    expect(response.status).toBe(400);
    expect(upload).not.toHaveBeenCalled();
  });

  // A half-done upload is unreachable: there is no client write grant on
  // media_destinations, no attachment endpoint, and the 500 does not carry the
  // generated id. Leaving the row and the bytes behind creates an orphan the
  // reference count reports as unreferenced and nothing ever collects.
  it('unwinds the registry row and the bytes when the destination insert fails', async () => {
    signedIn('owner-1');
    const admin = db({
      stories: { data: { id: 's1' }, error: null },
      media_objects: { data: { id: 'new-media' }, error: null },
      media_destinations: { error: { message: 'constraint' } },
    });
    const remove = vi.fn(async () => ({ data: [], error: null }));
    admin.client.storage.from = vi.fn(() => ({
      upload: vi.fn(async () => ({ error: null })),
      remove,
    }));
    adminClient.mockReturnValue(admin.client);
    reEncodeImage.mockResolvedValue({
      ok: true,
      value: { bytes: new Uint8Array([9]), contentType: 'image/jpeg', width: 10, height: 10 },
    });

    const response = await POST(
      uploadRequest({ destinationKind: 'story', destinationRef: 's1' }).request,
    );

    expect(response.status).toBe(500);
    expect(admin.builders.media_objects.delete).toHaveBeenCalled();
    expect(remove).toHaveBeenCalledTimes(1);
  });
});
