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

function makeRequest(body: unknown, opts: { ip?: string; raw?: string } = {}): Request {
  // Distinct IP per request by default: the limiter is module-scoped and
  // would otherwise couple unrelated tests.
  const headers = new Headers({
    'content-type': 'application/json',
    'x-forwarded-for': opts.ip ?? `10.1.0.${++ipCounter}`,
  });
  return new Request('http://localhost/api/waitlist', {
    method: 'POST',
    headers,
    body: opts.raw ?? JSON.stringify(body),
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

  it('CURRENT BEHAVIOUR: a padded email is rejected, not trimmed-then-accepted', async () => {
    // Documented, not endorsed. isValidWaitlistEmail tests the RAW string
    // and the shape regex forbids whitespace, while normalizeEmail trims —
    // so the two disagree, and a mobile keyboard's trailing space reads as
    // "invalid_email". Left as-is here on purpose: this is a signup-funnel
    // change, not a security remediation. Flip the assertion when it is
    // fixed deliberately.
    const res = await POST(makeRequest({ email: ' user@example.com ' }));
    expect(res.status).toBe(400);
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
});
