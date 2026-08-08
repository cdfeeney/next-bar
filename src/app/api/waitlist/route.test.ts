import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * POST /api/waitlist — the only unauthenticated WRITE surface in the app,
 * and until now it had no test of any kind (C2 audit F6).
 *
 * What matters here is not the happy path but the hardening the route
 * claims: junk never reaches the DB, a duplicate email is NOT an existence
 * oracle, Postgres detail never reaches the caller, and the 10/hour bound
 * actually bounds.
 */

const insertMock = vi.fn();
const fromMock = vi.fn(() => ({ insert: insertMock }));

// Mutable through a hoisted holder so one test can exercise the
// not-configured branch (`supabase === null`) without a second module.
const holder = vi.hoisted(() => ({ client: null as unknown }));
vi.mock('@/lib/supabase', () => ({
  get supabase() {
    return holder.client;
  },
}));

import { POST } from './route';

let ipCounter = 0;

function makeRequest(
  body: unknown,
  opts: {
    ip?: string;
    raw?: string;
    origin?: string;
    host?: string;
    contentLength?: string;
    noOrigin?: boolean;
  } = {},
): Request {
  // Distinct IP per request by default: the limiter is module-scoped and
  // would otherwise couple unrelated tests.
  const host = opts.host ?? 'nextbar.app';
  const headers = new Headers({
    'content-type': 'application/json',
    'x-forwarded-for': opts.ip ?? `10.1.0.${++ipCounter}`,
    host,
  });
  // A real browser ALWAYS sends Origin on a POST, so same-origin is the
  // realistic default; the absent case gets its own explicit test.
  if (!opts.noOrigin) headers.set('origin', opts.origin ?? `https://${host}`);
  if (opts.contentLength) headers.set('content-length', opts.contentLength);
  return new Request('http://localhost/api/waitlist', {
    method: 'POST',
    headers,
    body: opts.raw ?? JSON.stringify(body),
  });
}

/**
 * A request whose body arrives as a STREAM, so no honest Content-Length is
 * available — the only thing that can stop it is the incremental bounded
 * read. `duplex: 'half'` is required by undici for a stream body.
 */
function makeStreamingRequest(totalBytes: number, ip: string): Request {
  const chunk = new TextEncoder().encode('x'.repeat(1024));
  let sent = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent >= totalBytes) {
        controller.close();
        return;
      }
      controller.enqueue(chunk);
      sent += chunk.byteLength;
    },
  });
  return new Request('http://localhost/api/waitlist', {
    method: 'POST',
    headers: new Headers({
      'content-type': 'application/json',
      'x-forwarded-for': ip,
      host: 'nextbar.app',
      origin: 'https://nextbar.app',
    }),
    body,
    // @ts-expect-error - undici-only option, not in the DOM RequestInit type
    duplex: 'half',
  });
}

describe('POST /api/waitlist', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    holder.client = { from: fromMock };
    insertMock.mockResolvedValue({ error: null });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('accepts a valid signup and writes the NORMALIZED row', async () => {
    const res = await POST(
      makeRequest({ email: 'U.Ser+Tag@Gmail.com', neighborhood: ' Bushwick ' }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(fromMock).toHaveBeenCalledWith('waitlist');
    expect(insertMock).toHaveBeenCalledWith({
      // lowercased, trimmed, gmail dots collapsed, +tag preserved
      email: 'user+tag@gmail.com',
      neighborhood: 'Bushwick',
      vibe_profile: null,
    });
  });

  it('INTENDED: a padded email is rejected, not trimmed into validity', async () => {
    // Now a deliberate rule rather than a side effect of the shape regex —
    // isValidWaitlistEmail rejects `email !== email.trim()` explicitly, and
    // says why. The address stored is the address given; repairing input at
    // the boundary would hide malformed callers. If a trailing space ever
    // costs real signups, the fix is a client-side trim before submit.
    const res = await POST(makeRequest({ email: ' user@example.com ' }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: 'invalid_email' });
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('rejects a malformed email BEFORE touching the database', async () => {
    const res = await POST(makeRequest({ email: 'not-an-email' }));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: 'invalid_email' });
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('rejects a non-string email without throwing', async () => {
    const res = await POST(makeRequest({ email: { toString: 'nope' } }));
    expect(res.status).toBe(400);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('400s on unparseable JSON', async () => {
    const res = await POST(makeRequest(null, { raw: '{not json' }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: 'invalid_json' });
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('drops an oversize neighborhood to null rather than erroring', async () => {
    await POST(
      makeRequest({ email: 'a@b.co', neighborhood: 'x'.repeat(41) }),
    );
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({ neighborhood: null }),
    );
  });

  it('drops an oversize vibe_profile so the column cannot be used as a dump', async () => {
    await POST(
      makeRequest({
        email: 'a@b.co',
        vibe_profile: { blob: 'x'.repeat(3000) },
      }),
    );
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({ vibe_profile: null }),
    );
  });

  it('is NOT an email-existence oracle: a duplicate reads as plain success', async () => {
    // 23505 = unique_violation. If this ever answered differently from a
    // fresh signup, the endpoint would confirm whether an address is on the
    // list to any anonymous caller.
    insertMock.mockResolvedValue({
      error: { code: '23505', message: 'duplicate key value violates ...' },
    });
    const res = await POST(makeRequest({ email: 'already@there.com' }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('returns a GENERIC 500 on a real DB error — no Postgres detail leaks', async () => {
    insertMock.mockResolvedValue({
      error: { code: '42501', message: 'new row violates row-level security policy' },
    });
    const res = await POST(makeRequest({ email: 'a@b.co' }));

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ ok: false, error: 'server_error' });
  });

  it('succeeds without a database configured (local/preview)', async () => {
    holder.client = null;
    const res = await POST(makeRequest({ email: 'a@b.co' }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('C2 F6: rate-limits at 10/hour per IP — the 11th is 429 and never inserts', async () => {
    const ip = '192.0.2.55';
    for (let i = 0; i < 10; i++) {
      const res = await POST(makeRequest({ email: `a${i}@b.co` }, { ip }));
      expect(res.status).toBe(200);
    }
    expect(insertMock).toHaveBeenCalledTimes(10);

    const throttled = await POST(makeRequest({ email: 'a11@b.co' }, { ip }));
    expect(throttled.status).toBe(429);
    expect(await throttled.json()).toEqual({ ok: false, error: 'rate_limited' });
    // The whole point of the bound: no further writes.
    expect(insertMock).toHaveBeenCalledTimes(10);
  });

  it('limits per IP, so one flooder does not throttle everyone else', async () => {
    const flooder = '192.0.2.77';
    for (let i = 0; i < 11; i++) {
      await POST(makeRequest({ email: `f${i}@b.co` }, { ip: flooder }));
    }
    const bystander = await POST(
      makeRequest({ email: 'innocent@b.co' }, { ip: '192.0.2.78' }),
    );
    expect(bystander.status).toBe(200);
  });

  // ---------------------------------------------------------------------
  // Item 9 — request-boundary hardening
  // ---------------------------------------------------------------------

  it('rejects an honestly oversized body on Content-Length alone, before the DB', async () => {
    const res = await POST(
      makeRequest({ email: 'a@b.co' }, { contentLength: '999999' }),
    );

    expect(res.status).toBe(413);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('rejects an oversized STREAMED body that carries no honest Content-Length', async () => {
    // 64 KB with no Content-Length header: only the incremental bounded read
    // can stop this. Before the fix, request.json() buffered the whole thing.
    const res = await POST(makeStreamingRequest(64 * 1024, '198.51.100.9'));

    expect(res.status).toBe(413);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('rejects a cross-origin POST and does NOT charge the victim IP any quota', async () => {
    // The attack this closes: an attacker-controlled page makes a victim's
    // browser POST here repeatedly. Origin is checked BEFORE the limiter, so
    // the victim's 10/hour budget is untouched and their real signup works.
    const victim = '203.0.113.10';
    for (let i = 0; i < 15; i++) {
      const res = await POST(
        makeRequest(
          { email: `x${i}@b.co` },
          { ip: victim, origin: 'https://evil.example' },
        ),
      );
      expect(res.status).toBe(403);
    }
    expect(insertMock).not.toHaveBeenCalled();

    const real = await POST(
      makeRequest(
        { email: 'victim@b.co' },
        { ip: victim, origin: 'https://nextbar.app' },
      ),
    );
    expect(real.status).toBe(200);
  });

  it('rejects an origin-less POST: every real caller of this form is a browser', async () => {
    const res = await POST(makeRequest({ email: 'curl@b.co' }, { noOrigin: true }));

    expect(res.status).toBe(403);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('accepts the native shell origin, which the open web cannot forge', async () => {
    const res = await POST(
      makeRequest({ email: 'ios@b.co' }, { origin: 'capacitor://localhost' }),
    );
    expect(res.status).toBe(200);
  });

  it('prefers x-forwarded-host over Host when matching the origin', async () => {
    const headers = new Headers({
      'content-type': 'application/json',
      'x-forwarded-for': '198.51.100.77',
      'x-forwarded-host': 'next-bar.com, internal-lb',
      host: 'internal-routing.vercel',
      origin: 'https://next-bar.com',
    });
    const res = await POST(
      new Request('http://localhost/api/waitlist', {
        method: 'POST',
        headers,
        body: JSON.stringify({ email: 'fwd@b.co' }),
      }),
    );
    expect(res.status).toBe(200);
  });

  it('accepts a same-origin POST whose Origin matches the public host', async () => {
    const res = await POST(
      makeRequest(
        { email: 'same@b.co' },
        { origin: 'https://nextbar.app', host: 'nextbar.app' },
      ),
    );
    expect(res.status).toBe(200);
  });

  it('stores a fully valid vibe_profile, rebuilt from validated fields', async () => {
    await POST(
      makeRequest({
        email: 'good@b.co',
        vibe_profile: {
          tags: ['dive', 'cheap'],
          archetype: 'Dive Regular',
          preferredNeighborhoods: ['Bushwick'],
        },
      }),
    );

    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        vibe_profile: {
          tags: ['dive', 'cheap'],
          archetype: 'Dive Regular',
          preferredNeighborhoods: ['Bushwick'],
        },
      }),
    );
  });

  it('stores a StoredProfile (with savedAt) by stripping the transport key', async () => {
    // The shape loadProfile() returns. Rejecting it would silently null out
    // every quiz-taker's profile the moment the form is wired to the quiz.
    await POST(
      makeRequest({
        email: 'stored@b.co',
        vibe_profile: {
          tags: ['dive'],
          archetype: 'Dive Regular',
          preferredNeighborhoods: ['Bushwick'],
          savedAt: '2026-08-08T00:00:00.000Z',
        },
      }),
    );

    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        vibe_profile: {
          tags: ['dive'],
          archetype: 'Dive Regular',
          preferredNeighborhoods: ['Bushwick'],
        },
      }),
    );
  });

  it('drops a vibe_profile carrying UNKNOWN keys, even when small', async () => {
    // The old cap only measured serialized SIZE, so a compact object with
    // arbitrary keys reached the jsonb column verbatim.
    await POST(
      makeRequest({
        email: 'sneaky@b.co',
        vibe_profile: {
          tags: ['dive'],
          archetype: 'ok',
          preferredNeighborhoods: [],
          injected: { deep: { deeper: 'payload' } },
        },
      }),
    );

    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({ vibe_profile: null }),
    );
  });

  it('drops a vibe_profile whose tag is not in the allowlist', async () => {
    await POST(
      makeRequest({
        email: 'badtag@b.co',
        vibe_profile: {
          tags: ['dive', 'not-a-real-tag'],
          archetype: 'ok',
          preferredNeighborhoods: [],
        },
      }),
    );

    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({ vibe_profile: null }),
    );
  });

  it('drops a vibe_profile whose field types are wrong (type confusion)', async () => {
    await POST(
      makeRequest({
        email: 'confused@b.co',
        vibe_profile: {
          tags: 'dive',
          archetype: 42,
          preferredNeighborhoods: {},
        },
      }),
    );

    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({ vibe_profile: null }),
    );
  });
});
