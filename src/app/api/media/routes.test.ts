import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
const { POST: RECLAIM, GET: RECLAIM_CRON } = await import('./reclaim/route');

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

/**
 * A storage double whose removal silently skips the object AND whose presence probe
 * succeeds, returning the name.
 *
 * Both halves are required. `removeClaims` releases a claim only on positive proof
 * the bytes survived, and that proof is a successful `list` that returns the name. A
 * double with `remove` but no `list` makes the probe throw, which is now recorded as
 * UNKNOWN and correctly releases nothing — so a test asserting a release has to
 * supply the listing that earns it.
 */
function skippingStorage() {
  return {
    remove: vi.fn(async () => ({ data: [], error: null })),
    list: vi.fn(async (_folder: string, opts: { search?: string }) => ({
      data: [{ name: opts?.search ?? '' }],
      error: null,
    })),
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

  /**
   * A caller client for the delete path, dispatched by RPC NAME.
   *
   * The route makes up to four calls on it: the deletion verb, then
   * `claim_media_for_removal` for the object that verb freed, then the sweep's
   * own claim and `claim_orphan_paths`. Answering by name is what lets a
   * test decide each one independently — and the claim is the one that decides
   * whether any bytes go at all, so it has to be separately answerable.
   *
   * `claims` defaults to null meaning "the database claims the object the verb
   * named", which is the ordinary path. Passing `[]` is the DECLINED claim: a
   * reference reappeared, or somebody else got there first.
   */
  function deleteCaller(
    removal: unknown,
    claims: unknown[] | null = null,
    sweep: { claims?: unknown[]; orphans?: unknown[] } = {},
  ) {
    const caller = db({}).client;
    caller.rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
      if (name === 'claim_media_for_removal') {
        // A null media id is the SWEEP's claim, which must never speak for the
        // targeted one the deletion verb triggered.
        if (args?.p_media_id === null) return { data: sweep.claims ?? [], error: null };
        if (claims !== null) return { data: claims, error: null };
        const row = (Array.isArray(removal) ? removal[0] : null) as Record<string, unknown> | null;
        return {
          data: row === null ? [] : [{
            media_id: row.media_id ?? args?.p_media_id,
            bucket_id: 'story-media',
            storage_path: row.storage_path,
            // The database always returns the claim's stamp; without it the claim is
            // unreleasable and every release assertion here would silently pass.
            claimed_at: row.claimed_at ?? CLAIM_STAMP,
          }],
          error: null,
        };
      }
      if (name === 'claim_orphan_paths') {
        return { data: sweep.orphans ?? [], error: null };
      }
      if (name === 'release_media_claim') return { data: true, error: null };
      return { data: removal, error: null };
    });
    return caller;
  }

  const REMOVED = (path: string) => ({
    data: [{ name: path }],
    error: null,
  });

  // `claimed_at` is the claim's identity and the release quotes it back, so a fixture
  // without it yields a claim that cannot be released at all.
  const CLAIM_STAMP = '2026-08-24T18:00:00.000Z';
  const removal = (mediaId: string, path: string) => [{
    media_id: mediaId,
    bucket_id: 'story-media',
    storage_path: path,
    reclaimable: true,
    claimed_at: CLAIM_STAMP,
  }];

  // THE REGRESSION THIS FILE EXISTS FOR. `:mediaId` is an unvalidated path
  // segment; the destination the RPC actually removed need not belong to it.
  // Claiming the path's id would commit somebody else's live object to removal
  // with service-role authority, while the object actually freed stayed behind.
  it('claims the media the RPC removed, never the id in the URL', async () => {
    signedIn();
    const admin = db({}, { remove: vi.fn(async () => REMOVED('owner-1/really-mine')) });
    adminClient.mockReturnValue(admin.client);
    const caller = deleteCaller(removal('really-mine', 'owner-1/really-mine'));
    callerClient.mockReturnValue(caller);

    const response = await DELETE(
      new Request('https://app.test/api/media/someone-elses?destination=d1', {
        method: 'DELETE',
      }),
      { params: { mediaId: 'someone-elses' } },
    );

    expect(response.status).toBe(200);
    expect(caller.rpc).toHaveBeenCalledWith(
      'claim_media_for_removal',
      expect.objectContaining({ p_media_id: 'really-mine' }),
    );
    expect(caller.rpc).not.toHaveBeenCalledWith(
      'claim_media_for_removal',
      expect.objectContaining({ p_media_id: 'someone-elses' }),
    );
  });

  // 0066's storage DELETE policy REFUSES by omitting the object from the returned
  // list with `error` null, which is indistinguishable from success unless the
  // list itself is read. A caller-scoped remove would therefore stamp bytes as
  // gone while they remain. The removal runs with service role, against an object
  // the database has already claimed. (Under EC-01 the story-media SELECT policies
  // still stand until WP2's 0071; after it lands a caller could not see the object
  // at all, so service role is required both before and after.)
  it('removes the bytes with the service-role client', async () => {
    signedIn();
    const adminRemove = vi.fn(async () => REMOVED('owner-1/m1'));
    const admin = db({}, { remove: adminRemove });
    adminClient.mockReturnValue(admin.client);
    callerClient.mockReturnValue(deleteCaller(removal('m1', 'owner-1/m1')));

    const response = await DELETE(
      new Request('https://app.test/api/media/m1?destination=d1', { method: 'DELETE' }),
      { params: { mediaId: 'm1' } },
    );

    expect(adminRemove).toHaveBeenCalledWith(['owner-1/m1']);
    await expect(response.json()).resolves.toMatchObject({ bytesReclaimed: true });
  });

  // THE RACE, and the reason the shape changed. The verb answered "reclaimable"
  // under a row lock it has since released. The claim re-decides under the lock
  // `publish_story` also takes; a claim that comes back EMPTY means a reference
  // won, and Storage must not be touched at all.
  it('does not touch Storage when the database declines the claim', async () => {
    signedIn();
    const adminRemove = vi.fn(async () => REMOVED('owner-1/m1'));
    const admin = db({}, { remove: adminRemove });
    adminClient.mockReturnValue(admin.client);
    callerClient.mockReturnValue(deleteCaller(removal('m1', 'owner-1/m1'), []));

    const response = await DELETE(
      new Request('https://app.test/api/media/m1?destination=d1', { method: 'DELETE' }),
      { params: { mediaId: 'm1' } },
    );

    const body = await response.json();
    expect(adminRemove).not.toHaveBeenCalled();
    expect(body.bytesReclaimed).toBe(false);
    expect(body.orphanedPaths).toEqual([]);
  });

  // Storage reports a skipped object by leaving it out of the removed list,
  // with error null. Reading that as success would leave the claim standing over
  // bytes still in the bucket, which every future sweep would then skip.
  it('reports an orphan and releases the claim when Storage silently skips', async () => {
    signedIn();
    const admin = db({}, skippingStorage());
    adminClient.mockReturnValue(admin.client);
    const caller = deleteCaller(removal('m1', 'owner-1/m1'));
    callerClient.mockReturnValue(caller);

    const response = await DELETE(
      new Request('https://app.test/api/media/m1?destination=d1', { method: 'DELETE' }),
      { params: { mediaId: 'm1' } },
    );

    const body = await response.json();
    expect(body.bytesReclaimed).toBe(false);
    expect(body.orphanedPaths).toEqual(['owner-1/m1']);
    // THE RELEASE IS THE ADMIN'S, and asserting it on the caller was asserting a
    // call production would refuse: 0066 revokes release_media_claim from
    // `authenticated` as well as public/anon, because an owner able to un-stamp
    // an object mid-removal could publish a story into the gap and lose its
    // photo to a delete already in flight.
    expect(admin.client.rpc).toHaveBeenCalledWith('release_media_claim', expect.objectContaining({ p_media_id: 'm1' }));
    expect(caller.rpc).not.toHaveBeenCalledWith('release_media_claim', expect.anything());
  });

  it('claims nothing when the removal left the bytes referenced', async () => {
    signedIn();
    const adminRemove = vi.fn(async () => REMOVED('owner-1/m1'));
    adminClient.mockReturnValue(db({}, { remove: adminRemove }).client);

    const caller = deleteCaller([{
      media_id: 'm1',
      bucket_id: 'story-media',
      storage_path: 'owner-1/m1',
      reclaimable: false,
    }]);
    callerClient.mockReturnValue(caller);

    const response = await DELETE(
      new Request('https://app.test/api/media/m1?destination=d1', { method: 'DELETE' }),
      { params: { mediaId: 'm1' } },
    );

    expect(response.status).toBe(200);
    expect(caller.rpc).not.toHaveBeenCalledWith(
      'claim_media_for_removal',
      expect.objectContaining({ p_media_id: 'm1' }),
    );
    expect(adminRemove).not.toHaveBeenCalled();
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
    const adminRemove = vi.fn(async () => REMOVED('owner-1/m1'));
    adminClient.mockReturnValue(db({}, { remove: adminRemove }).client);

    callerClient.mockReturnValue(deleteCaller([{
      bucket_id: 'story-media',
      storage_path: 'owner-1/m1',
      reclaimable: false,
      remaining_references: 1,
    }]));

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
    expect(adminRemove).not.toHaveBeenCalled();
  });

  // RECLAMATION HAS A CALLER, and this is one of them. Expired stories and
  // abandoned uploads never get a deletion verb of their own, so without a tick
  // like this they stay eligible forever and reclaimed never.
  it('sweeps the caller\'s other reclaimable media on the way out', async () => {
    signedIn();
    const adminRemove = vi.fn(async (paths: string[]) => ({
      data: paths.map((name) => ({ name })),
      error: null,
    }));
    adminClient.mockReturnValue(db({}, { remove: adminRemove }).client);

    callerClient.mockReturnValue(deleteCaller(
      removal('m1', 'owner-1/m1'),
      null,
      {
        claims: [{ media_id: 'expired', bucket_id: 'story-media', storage_path: 'owner-1/expired.jpg' }],
        orphans: [{
          media_id: 'legacy',
          bucket_id: 'story-media',
          storage_path: 'owner-1/legacy.jpg',
        }],
      },
    ));

    const response = await DELETE(
      new Request('https://app.test/api/media/m1?destination=d1', { method: 'DELETE' }),
      { params: { mediaId: 'm1' } },
    );

    // Two more objects than the one the caller asked about, and pre-boundary
    // media (no registry row at all) is one of them.
    await expect(response.json()).resolves.toMatchObject({ alsoReclaimed: 2 });
    expect(adminRemove).toHaveBeenCalledWith(['owner-1/expired.jpg']);
    expect(adminRemove).toHaveBeenCalledWith(['owner-1/legacy.jpg']);
  });

  // The sweep is a courtesy. If it throws, the deletion the caller actually
  // asked for still has to be reported honestly.
  it('still reports the caller\'s own deletion when the sweep fails', async () => {
    signedIn();
    let call = 0;
    const adminRemove = vi.fn(async (paths: string[]) => {
      call += 1;
      if (call > 1) throw new Error('storage down');
      return { data: paths.map((name) => ({ name })), error: null };
    });
    adminClient.mockReturnValue(db({}, { remove: adminRemove }).client);

    callerClient.mockReturnValue(deleteCaller(
      removal('m1', 'owner-1/m1'),
      null,
      { claims: [{ media_id: 'x', bucket_id: 'story-media', storage_path: 'owner-1/x.jpg' }] },
    ));

    const response = await DELETE(
      new Request('https://app.test/api/media/m1?destination=d1', { method: 'DELETE' }),
      { params: { mediaId: 'm1' } },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      bytesReclaimed: true,
      alsoReclaimed: 0,
    });
  });
});

/**
 * V8-R-CMP-012's other half: something has to actually delete the bytes.
 *
 * 0066 can only decide eligibility — Postgres cannot remove a Storage object —
 * so without an invoked caller "bytes die with the last reference" is a rule
 * with no executor. This route is that caller, and the two things it must get
 * right are WHOSE media a sweep touches and how a service key is compared.
 */
describe('POST /api/media/reclaim', () => {
  function sweepCaller(claims: unknown[] = [], orphans: unknown[] = []) {
    const client = db({}).client;
    client.rpc = vi.fn(async (name: string) => (
      name === 'claim_media_for_removal'
        ? { data: claims, error: null }
        : { data: name === 'claim_orphan_paths' ? orphans : true, error: null }
    ));
    return client;
  }

  const removeAll = () => vi.fn(async (paths: string[]) => ({
    data: paths.map((name) => ({ name })),
    error: null,
  }));

  it('refuses a request with no bearer token', async () => {
    readMediaEnv.mockReturnValue(ENV);
    bearerToken.mockReturnValue(null);

    const response = await RECLAIM(
      new Request('https://app.test/api/media/reclaim', { method: 'POST' }),
    );
    expect(response.status).toBe(401);
  });

  it('refuses a token that is neither a session nor the service key', async () => {
    readMediaEnv.mockReturnValue(ENV);
    bearerToken.mockReturnValue('not-a-real-token');
    verifiedUserId.mockResolvedValue(null);
    adminClient.mockReturnValue(db({}).client);

    const response = await RECLAIM(
      new Request('https://app.test/api/media/reclaim', { method: 'POST' }),
    );
    expect(response.status).toBe(401);
  });

  // A prefix of the service key is not the service key. The comparison is
  // length-checked and then constant-time, so a near-miss is rejected as an
  // ordinary unauthenticated token rather than escalating to a global sweep.
  it('does not treat a prefix of the service key as the service key', async () => {
    readMediaEnv.mockReturnValue(ENV);
    bearerToken.mockReturnValue('servic');
    verifiedUserId.mockResolvedValue(null);
    adminClient.mockReturnValue(db({}).client);

    const response = await RECLAIM(
      new Request('https://app.test/api/media/reclaim', { method: 'POST' }),
    );
    expect(response.status).toBe(401);
  });

  it('sweeps only the caller\'s own media for a user token', async () => {
    signedIn();
    const remove = removeAll();
    adminClient.mockReturnValue(db({}, { remove }).client);
    const caller = sweepCaller(
      [{ media_id: 'm1', bucket_id: 'story-media', storage_path: 'owner-1/m1' }],
    );
    callerClient.mockReturnValue(caller);

    const response = await RECLAIM(
      new Request('https://app.test/api/media/reclaim', { method: 'POST' }),
    );

    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      scope: 'own',
      reclaimed: 1,
    });
    // The scoping is 0066's, not this handler's: the RPCs run on the CALLER'S
    // client, which is what makes auth.uid() non-null and narrows them.
    expect(caller.rpc).toHaveBeenCalledWith(
      'claim_media_for_removal',
      expect.objectContaining({ p_media_id: null }),
    );
    expect(remove).toHaveBeenCalledWith(['owner-1/m1']);
  });

  // The scheduled path. Passing the ADMIN client as the caller is what widens
  // the sweep: 0066's functions drop their owner filter exactly when auth.uid()
  // is null, and a service-role client is the only one for which it is.
  it('sweeps everyone\'s media for the service key, and never builds a caller client', async () => {
    readMediaEnv.mockReturnValue(ENV);
    bearerToken.mockReturnValue(ENV.serviceKey);
    const remove = removeAll();
    const admin = db({}, { remove }).client;
    admin.rpc = vi.fn(async (name: string) => (
      name === 'claim_orphan_paths'
        ? {
          data: [{
            media_id: 'm-legacy',
            bucket_id: 'story-media',
            storage_path: 'someone/else.jpg',
          }],
          error: null,
        }
        : { data: [], error: null }
    ));
    adminClient.mockReturnValue(admin);

    const response = await RECLAIM(
      new Request('https://app.test/api/media/reclaim', { method: 'POST' }),
    );

    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      scope: 'all',
      reclaimed: 1,
    });
    expect(callerClient).not.toHaveBeenCalled();
    expect(verifiedUserId).not.toHaveBeenCalled();
    expect(remove).toHaveBeenCalledWith(['someone/else.jpg']);
  });

  it('is honest about an orphan instead of counting it as reclaimed', async () => {
    signedIn();
    adminClient.mockReturnValue(
      db({}, skippingStorage()).client,
    );
    callerClient.mockReturnValue(sweepCaller(
      [{ media_id: 'm1', bucket_id: 'story-media', storage_path: 'owner-1/m1' }],
    ));

    const response = await RECLAIM(
      new Request('https://app.test/api/media/reclaim', { method: 'POST' }),
    );

    await expect(response.json()).resolves.toMatchObject({
      reclaimed: 0,
      orphanedPaths: ['owner-1/m1'],
    });
  });

  it('is a 503 when this deployment has no media configuration', async () => {
    readMediaEnv.mockReturnValue(null);
    const response = await RECLAIM(
      new Request('https://app.test/api/media/reclaim', { method: 'POST' }),
    );
    expect(response.status).toBe(503);
  });
});

/**
 * The scheduled path. vercel.json runs this daily; Vercel authenticates its
 * own cron requests with `Authorization: Bearer ${CRON_SECRET}`. This is what
 * makes "bytes die with the last reference" true without anyone remembering
 * to call the sweep by hand.
 */
describe('GET /api/media/reclaim (cron)', () => {
  afterEach(() => vi.unstubAllEnvs());

  function cronRequest(bearer?: string) {
    return new Request('https://app.test/api/media/reclaim', {
      method: 'GET',
      headers: bearer === undefined ? {} : { authorization: `Bearer ${bearer}` },
    });
  }

  it('refuses everything when no CRON_SECRET is configured', async () => {
    vi.stubEnv('CRON_SECRET', '');
    bearerToken.mockReturnValue('anything');
    const response = await RECLAIM_CRON(cronRequest('anything'));
    expect(response.status).toBe(401);
  });

  it('refuses a wrong bearer', async () => {
    vi.stubEnv('CRON_SECRET', 'cron-secret');
    bearerToken.mockReturnValue('not-the-secret');
    const response = await RECLAIM_CRON(cronRequest('not-the-secret'));
    expect(response.status).toBe(401);
  });

  it('runs the GLOBAL sweep for the cron secret, on the admin client only', async () => {
    vi.stubEnv('CRON_SECRET', 'cron-secret');
    readMediaEnv.mockReturnValue(ENV);
    bearerToken.mockReturnValue('cron-secret');
    const remove = vi.fn(async (paths: string[]) => ({
      data: paths.map((name) => ({ name })),
      error: null,
    }));
    const admin = db({}, { remove }).client;
    admin.rpc = vi.fn(async (name: string) => (
      name === 'claim_orphan_paths'
        ? {
          data: [{
            media_id: 'm-old',
            bucket_id: 'story-media',
            storage_path: 'deleted-account/photo.jpg',
          }],
          error: null,
        }
        : { data: [], error: null }
    ));
    adminClient.mockReturnValue(admin);

    const response = await RECLAIM_CRON(cronRequest('cron-secret'));

    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      scope: 'all',
      reclaimed: 1,
    });
    expect(callerClient).not.toHaveBeenCalled();
    expect(verifiedUserId).not.toHaveBeenCalled();
    expect(remove).toHaveBeenCalledWith(['deleted-account/photo.jpg']);
  });

  /**
   * THE CRON MUST NOT REPORT A CLEAN SWEEP IT DID NOT PERFORM.
   *
   * Both claim helpers failed closed by returning an empty list, which the
   * sweep could not tell apart from 'nothing was eligible' — so a run whose
   * RPCs errored produced 200 ok:true, the platform recorded a green
   * invocation, and nothing was cleaned. Silent, scheduled, and self-reporting
   * as healthy is the worst combination available.
   */
  it('answers 500 when the sweep could not check, instead of a green 200', async () => {
    vi.stubEnv('CRON_SECRET', 'cron-secret');
    readMediaEnv.mockReturnValue(ENV);
    bearerToken.mockReturnValue('cron-secret');
    const remove = vi.fn(async (paths: string[]) => ({
      data: paths.map((name) => ({ name })),
      error: null,
    }));
    const admin = db({}, { remove }).client;
    admin.rpc = vi.fn(async () => ({ data: null, error: { message: 'down' } }));
    adminClient.mockReturnValue(admin);

    const response = await RECLAIM_CRON(cronRequest('cron-secret'));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: 'sweep_incomplete',
      unchecked: ['claim_media_for_removal', 'claim_orphan_paths'],
    });
    // Failing closed is unchanged — an unreadable claim still deletes nothing.
    expect(remove).not.toHaveBeenCalled();
  });

  it('still answers 200 for a sweep that ran and found nothing', async () => {
    // The distinction this change exists to make: an empty bucket is a success.
    vi.stubEnv('CRON_SECRET', 'cron-secret');
    readMediaEnv.mockReturnValue(ENV);
    bearerToken.mockReturnValue('cron-secret');
    const admin = db({}).client;
    admin.rpc = vi.fn(async () => ({ data: [], error: null }));
    adminClient.mockReturnValue(admin);

    const response = await RECLAIM_CRON(cronRequest('cron-secret'));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, reclaimed: 0 });
  });

  /**
   * THE PROBE FAILURE PATH, END TO END. Storage omits the object from its
   * removal report and the presence lookup that would settle whether the bytes
   * survived then fails. The claim helpers all succeeded, so this is NOT the
   * failure covered above — the sweep ran, and simply does not know what
   * happened. It used to answer 200 ok:true.
   */
  it('answers 500 when a presence probe failed, even though every claim succeeded', async () => {
    vi.stubEnv('CRON_SECRET', 'cron-secret');
    readMediaEnv.mockReturnValue(ENV);
    bearerToken.mockReturnValue('cron-secret');
    // Removal reports nothing removed; the follow-up listing errors.
    const remove = vi.fn(async () => ({ data: [], error: null }));
    const list = vi.fn(async () => ({ data: null, error: { message: 'list unavailable' } }));
    const admin = db({}, { remove }).client;
    admin.storage = { from: () => ({ remove, list }) };
    admin.rpc = vi.fn(async (name: string) => (
      name === 'claim_media_for_removal'
        ? {
          data: [{
            media_id: 'm1',
            bucket_id: 'story-media',
            storage_path: 'u1/a.jpg',
            claimed_at: '2026-09-04T00:00:00.000Z',
          }],
          error: null,
        }
        : { data: [], error: null }
    ));
    adminClient.mockReturnValue(admin);

    const response = await RECLAIM_CRON(cronRequest('cron-secret'));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: 'sweep_incomplete',
      unchecked: ['presence_unknown:u1/a.jpg'],
      reclaimed: 0,
    });
    // The claim is NOT handed back on an unknown outcome.
    const releases = admin.rpc.mock.calls.filter((c: unknown[]) => c[0] === 'release_media_claim');
    expect(releases).toHaveLength(0);
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

  // V8-R-STO-015. The signing client must be the service-role one and the TTL must
  // come from the media's own window. NOTE: under EC-01 the authenticated read
  // grant is NOT yet revoked — that is WP2's 0071, after its consumer transition —
  // so this route is currently the SAFE path, not the only one, and V8-R-STO-015
  // is not yet enforced end to end. This test pins the route's half of it.
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

  // A story that already exists cannot name a path minted after it, so a story
  // destination created at upload is a live spine reference to an object the story
  // does not reference — by construction, for ANY caller. The old test proved the
  // lookup was ownership-scoped, which was true and beside the point.
  it('refuses a story destination even from the story author', async () => {
    signedIn('owner-1');
    const admin = uploadAdmin({ id: 's1' }); // the story really is theirs
    adminClient.mockReturnValue(admin.client);
    reEncodeImage.mockResolvedValue({
      ok: true,
      value: { bytes: new Uint8Array([9]), contentType: 'image/jpeg', width: 10, height: 10 },
    });

    const response = await POST(
      uploadRequest({ destinationKind: 'story', destinationRef: 's1' }).request,
    );

    expect(response.status).toBe(400);
    expect(admin.builders.media_destinations.insert).not.toHaveBeenCalled();
  });

  it('refuses a story destination naming another account\'s story', async () => {
    signedIn('attacker');
    const admin = uploadAdmin(null);
    adminClient.mockReturnValue(admin.client);
    reEncodeImage.mockResolvedValue({
      ok: true,
      value: { bytes: new Uint8Array([9]), contentType: 'image/jpeg', width: 10, height: 10 },
    });

    const response = await POST(
      uploadRequest({ destinationKind: 'story', destinationRef: 'victims-story' }).request,
    );

    expect(response.status).toBe(400);
    expect(admin.builders.media_destinations.insert).not.toHaveBeenCalled();
  });

  // The property that replaces the ownership check: a successful upload writes the
  // object and NOTHING on the spine. publish_story owns attachment.
  // FIX 5. Reclamation had eligibility, a claim and a route, but no caller for the
  // ABANDONED-UPLOAD population: DELETE already swept, so an account that deletes
  // eventually cleans up after itself, while an account that only ever uploads and
  // abandons never triggered a tick. Event-driven rather than scheduled — this
  // repository has no cron, no vercel.json and no pg_cron, and the approved
  // contract states no wall-clock cleanup SLA.
  it('sweeps reclaimable media after a successful upload', async () => {
    signedIn('owner-1');
    const admin = uploadAdmin({ id: 's1' });
    adminClient.mockReturnValue(admin.client);
    // Inline rather than the DELETE block's helper, which is scoped to it.
    const caller = db({}).client;
    caller.rpc = vi.fn(async (name: string) => (
      name === 'claim_media_for_removal' || name === 'claim_orphan_paths'
        ? { data: [], error: null }
        : { data: null, error: null }
    ));
    callerClient.mockReturnValue(caller);
    reEncodeImage.mockResolvedValue({
      ok: true,
      value: { bytes: new Uint8Array([9]), contentType: 'image/jpeg', width: 10, height: 10 },
    });

    const response = await POST(uploadRequest().request);

    expect(response.status).toBe(200);
    // The sweep really ran on the caller's behalf, rather than the field being a
    // constant the route reports without doing anything.
    expect(caller.rpc).toHaveBeenCalledWith(
      'claim_media_for_removal',
      expect.objectContaining({ p_media_id: null }),
    );
  });

  // A sweep failure must NEVER fail an upload that already succeeded: the bytes are
  // stored and registered, and the caller is entitled to that answer.
  it('still returns 200 when the post-upload sweep throws', async () => {
    signedIn('owner-1');
    const admin = uploadAdmin({ id: 's1' });
    adminClient.mockReturnValue(admin.client);
    const caller = db({}).client;
    caller.rpc = vi.fn(async () => {
      throw new Error('sweep exploded');
    });
    callerClient.mockReturnValue(caller);
    reEncodeImage.mockResolvedValue({
      ok: true,
      value: { bytes: new Uint8Array([9]), contentType: 'image/jpeg', width: 10, height: 10 },
    });

    const response = await POST(uploadRequest().request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.alsoReclaimed).toBe(0);
  });

  it('writes no spine row on a successful upload', async () => {
    signedIn('owner-1');
    const admin = uploadAdmin({ id: 's1' });
    adminClient.mockReturnValue(admin.client);
    reEncodeImage.mockResolvedValue({
      ok: true,
      value: { bytes: new Uint8Array([9]), contentType: 'image/jpeg', width: 10, height: 10 },
    });

    const response = await POST(uploadRequest().request);

    expect(response.status).toBe(200);
    expect(admin.builders.media_destinations.insert).not.toHaveBeenCalled();
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

  // The destination-insert failure this once covered is unreachable now: no spine
  // row is written at upload at all, so there is no half-done attach to unwind.
  // The registry-insert failure path keeps its own cleanup and its own test above.
  it('removes the stored bytes when the registry insert fails', async () => {
    signedIn('owner-1');
    const admin = db({
      media_objects: { data: null, error: { message: 'constraint' } },
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

    const response = await POST(uploadRequest().request);

    expect(response.status).toBe(500);
    expect(remove).toHaveBeenCalledTimes(1);
  });
});
