import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearQueuedRsvp,
  ensureRsvpKey,
  fetchAnonRsvp,
  fetchBearerAttendees,
  fetchBearerDetail,
  fetchBearerShortlist,
  queueRsvp,
  readQueuedRsvp,
  readRsvpKey,
  submitAnonRsvp,
} from './bearer';

/**
 * The BEARER half of the invitation (V8-R-INV-001 … V8-R-INV-004, D-C-23).
 *
 * What these pin down is the set of claims this module is allowed to make on
 * the server's behalf. Every one of them was a real defect shape somewhere in
 * this codebase already: reporting a write the server refused as done, reporting
 * a failed read as an empty answer, and coercing a value the server did not send.
 */

const TOKEN = '11111111-1111-1111-1111-111111111111';
const KEY = '22222222-2222-2222-2222-222222222222';

/**
 * `status` is part of the shape the real client returns, and round 4 learned
 * the hard way that leaving it out of a fixture models a client that does not
 * exist: postgrest-js resolves a FETCH FAILURE as `{ error, status: 0 }` and a
 * PostgREST refusal with a real HTTP status, and `submitAnonRsvp` has to tell
 * those apart. A fixture with no status is a different case, tested on its own.
 */
type RpcResult = { data: unknown; error: unknown; status?: number };

function rpcClient(result: RpcResult) {
  const rpc = vi
    .fn()
    .mockResolvedValue({ status: result.error ? 400 : 200, ...result });
  return { client: { rpc } as never, rpc };
}

function throwingClient() {
  const rpc = vi.fn().mockRejectedValue(new Error('offline'));
  return { rpc } as never;
}

describe('fetchBearerDetail (V8-R-INV-002 — "time and area")', () => {
  it('carries the SERVER\'s scheduled start through unchanged', async () => {
    const { client, rpc } = rpcClient({
      data: [
        {
          starts_at: '2026-08-21T01:00:00.000Z',
          area: null,
          decided_bar_id: null,
          voting_closes_at: null,
        },
      ],
      error: null,
    });
    await expect(fetchBearerDetail(client, TOKEN)).resolves.toEqual({
      startsAt: '2026-08-21T01:00:00.000Z',
      area: null,
      decidedBarId: null,
      votingClosesAt: null,
    });
    expect(rpc).toHaveBeenCalledWith('preview_night_out_detail', {
      p_token: TOKEN,
    });
  });

  /**
   * AREA IS ITS OWN FACT (round-4 panel, Codex). Round 4 answered "area" with
   * the decided bar, which is null for exactly as long as the plan is still
   * choosing — the window in which a recipient most needs to know roughly
   * where. A plan can carry both, and they are different columns.
   */
  it('reports the plan\'s own area, decided bar and deadline separately', async () => {
    const { client } = rpcClient({
      data: [
        {
          starts_at: '2026-08-21T01:00:00.000Z',
          area: 'Lower East Side',
          decided_bar_id: 'attaboy',
          voting_closes_at: '2026-08-20T23:00:00.000Z',
        },
      ],
      error: null,
    });
    await expect(fetchBearerDetail(client, TOKEN)).resolves.toEqual({
      startsAt: '2026-08-21T01:00:00.000Z',
      area: 'Lower East Side',
      decidedBarId: 'attaboy',
      votingClosesAt: '2026-08-20T23:00:00.000Z',
    });
  });

  it('carries an area while the plan is still choosing a bar', async () => {
    const { client } = rpcClient({
      data: [
        {
          starts_at: '2026-08-21T01:00:00.000Z',
          area: 'Lower East Side',
          decided_bar_id: null,
          voting_closes_at: null,
        },
      ],
      error: null,
    });
    await expect(fetchBearerDetail(client, TOKEN)).resolves.toMatchObject({
      area: 'Lower East Side',
      decidedBarId: null,
    });
  });

  it('is null for a dead token, and never throws when the call rejects', async () => {
    const { client } = rpcClient({ data: [], error: null });
    await expect(fetchBearerDetail(client, TOKEN)).resolves.toBeNull();
    await expect(
      fetchBearerDetail(throwingClient(), TOKEN),
    ).resolves.toBeNull();
  });
});

describe('fetchBearerAttendees (V8-R-INV-002 — "who is going")', () => {
  it('returns display identities, and asks for nothing else', async () => {
    const { client, rpc } = rpcClient({
      data: [{ display_name: 'Sam', handle: 'sam' }],
      error: null,
    });
    await expect(fetchBearerAttendees(client, TOKEN)).resolves.toEqual([
      { displayName: 'Sam', handle: 'sam' },
    ]);
    expect(rpc).toHaveBeenCalledWith('preview_night_out_attendees', {
      p_token: TOKEN,
    });
  });

  it('keeps "nobody has accepted" and "the read failed" apart', async () => {
    // [] is a claim about the plan; null is the absence of one.
    const empty = rpcClient({ data: [], error: null });
    await expect(fetchBearerAttendees(empty.client, TOKEN)).resolves.toEqual([]);
    const failed = rpcClient({ data: null, error: { message: 'boom' } });
    await expect(fetchBearerAttendees(failed.client, TOKEN)).resolves.toBeNull();
  });
});

describe('fetchBearerShortlist (V8-R-INV-002 — "the shortlist so far")', () => {
  it('carries the bars and their vote counts', async () => {
    const { client } = rpcClient({
      data: [
        { bar_id: 'please-dont-tell', votes: 5 },
        { bar_id: 'attaboy', votes: 1 },
      ],
      error: null,
    });
    await expect(fetchBearerShortlist(client, TOKEN)).resolves.toEqual([
      { barId: 'please-dont-tell', votes: 5 },
      { barId: 'attaboy', votes: 1 },
    ]);
  });

  it('drops a row with no bar id rather than rendering a nameless entry', async () => {
    const { client } = rpcClient({
      data: [{ bar_id: null, votes: 3 }, { bar_id: 'attaboy', votes: 1 }],
      error: null,
    });
    await expect(fetchBearerShortlist(client, TOKEN)).resolves.toEqual([
      { barId: 'attaboy', votes: 1 },
    ]);
  });

  it('is null on a failed read, never an empty shortlist', async () => {
    const { client } = rpcClient({ data: null, error: { message: 'boom' } });
    await expect(fetchBearerShortlist(client, TOKEN)).resolves.toBeNull();
  });
});

describe('the anonymous RSVP (V8-R-INV-001 / V8-R-INV-003, D-C-23)', () => {
  it('sends the token, the recipient\'s key and the choice', async () => {
    const { client, rpc } = rpcClient({ data: true, error: null });
    await expect(submitAnonRsvp(client, TOKEN, KEY, 'maybe')).resolves.toBe(
      'sent',
    );
    expect(rpc).toHaveBeenCalledWith('rsvp_night_out_by_token', {
      p_token: TOKEN,
      p_key: KEY,
      p_response: 'maybe',
    });
  });

  /**
   * "A failed RSVP must be labelled as not yet sent." Anything other than an
   * explicit `true` is a response the server did not take, and reporting it as
   * sent would tell the recipient the host can see an answer that never landed.
   */
  it('is refused for every answer that is not an explicit true', async () => {
    for (const data of [false, null, undefined, 'true', 1]) {
      const { client } = rpcClient({ data, error: null });
      await expect(submitAnonRsvp(client, TOKEN, KEY, 'going')).resolves.toBe(
        'refused',
      );
    }
    const errored = rpcClient({ data: true, error: { message: 'boom' } });
    await expect(
      submitAnonRsvp(errored.client, TOKEN, KEY, 'going'),
    ).resolves.toBe('refused');
  });

  /**
   * REFUSED AND UNREACHABLE ARE DIFFERENT ANSWERS (round-3 panel, Codex).
   * V8-R-INV-003 queues an OFFLINE response; a response the server refused must
   * not be queued, because retrying cannot make it land.
   */
  it('reports a call that never reached the server as unreachable', async () => {
    await expect(
      submitAnonRsvp(throwingClient(), TOKEN, KEY, 'going'),
    ).resolves.toBe('unreachable');
  });

  /**
   * THE SHAPE THE REAL CLIENT ACTUALLY RETURNS OFFLINE (round-4 panel, Claude
   * gate, HIGH).
   *
   * supabase-js does not throw on a network failure unless `.throwOnError()`
   * was called, and nothing here calls it: postgrest-js catches its own fetch
   * rejection and RESOLVES with `{ error: { message: 'TypeError: Failed to
   * fetch', code: '' }, status: 0 }` (dist/index.mjs:291-331). Round 4 detected
   * "unreachable" by catching a throw, so the entire offline queue was dead
   * code in production while its unit test — which mocked a REJECTING client —
   * passed. This fixture is the resolved shape.
   */
  it('reports the resolved fetch-failure shape as unreachable, not refused', async () => {
    const offline = {
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: {
          message: 'TypeError: Failed to fetch',
          details: '',
          hint: '',
          code: '',
        },
        status: 0,
        statusText: '',
      }),
    } as never;
    await expect(submitAnonRsvp(offline, TOKEN, KEY, 'going')).resolves.toBe(
      'unreachable',
    );
  });

  it('still calls a PostgREST refusal refused, however it is worded', async () => {
    // A real refusal carries a real HTTP status, which is what separates it
    // from a request that never arrived.
    const refused = {
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: { message: 'permission denied', code: '42501' },
        status: 403,
        statusText: 'Forbidden',
      }),
    } as never;
    await expect(submitAnonRsvp(refused, TOKEN, KEY, 'going')).resolves.toBe(
      'refused',
    );
  });

  it('never sends a malformed token or key to the server', async () => {
    const { client, rpc } = rpcClient({ data: true, error: null });
    await expect(submitAnonRsvp(client, 'not-a-uuid', KEY, 'going')).resolves.toBe(
      'refused',
    );
    await expect(submitAnonRsvp(client, TOKEN, 'nope', 'going')).resolves.toBe(
      'refused',
    );
    expect(rpc).not.toHaveBeenCalled();
  });

  it('reads back the answer stored under this key', async () => {
    const { client, rpc } = rpcClient({ data: 'going', error: null });
    await expect(fetchAnonRsvp(client, TOKEN, KEY)).resolves.toEqual({
      kind: 'ok',
      choice: 'going',
    });
    expect(rpc).toHaveBeenCalledWith('get_anon_rsvp_by_token', {
      p_token: TOKEN,
      p_key: KEY,
    });
  });

  /**
   * Three outcomes, and collapsing any two loses the answer: an un-answered
   * recipient is asked to RSVP, a failed read must NOT be, and an unrecognised
   * value is not silently treated as one of the three choices.
   */
  it('keeps "no answer yet" and "could not ask" apart', async () => {
    const none = rpcClient({ data: null, error: null });
    await expect(fetchAnonRsvp(none.client, TOKEN, KEY)).resolves.toEqual({
      kind: 'none',
    });
    const failed = rpcClient({ data: null, error: { message: 'boom' } });
    await expect(fetchAnonRsvp(failed.client, TOKEN, KEY)).resolves.toEqual({
      kind: 'failed',
    });
    const junk = rpcClient({ data: 'attending', error: null });
    await expect(fetchAnonRsvp(junk.client, TOKEN, KEY)).resolves.toEqual({
      kind: 'failed',
    });
  });
});

describe('the recipient\'s own key', () => {
  let store: Record<string, string>;

  beforeEach(() => {
    store = {};
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => {
        store[k] = v;
      },
      removeItem: (k: string) => {
        delete store[k];
      },
    });
    vi.stubGlobal('window', { localStorage } as never);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('mints one key per plan and returns the same one afterwards', () => {
    const first = ensureRsvpKey(TOKEN);
    expect(first).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(ensureRsvpKey(TOKEN)).toBe(first);
    expect(readRsvpKey(TOKEN)).toBe(first);
    // Per PLAN, so forwarding one link never hands anyone another plan's key.
    expect(ensureRsvpKey('33333333-3333-3333-3333-333333333333')).not.toBe(
      first,
    );
  });

  it('reads nothing for a plan that has never been answered', () => {
    expect(readRsvpKey(TOKEN)).toBeNull();
  });

  /**
   * A key we could not PERSIST is worse than no key: the RSVP would go under an
   * identity the recipient can never present again, so they could not see or
   * change their own answer. `ensureRsvpKey` reports that rather than returning
   * a value the caller would send.
   */
  it('is null when the key cannot be stored, rather than a key that will be lost', () => {
    vi.stubGlobal('window', {
      localStorage: {
        getItem: () => null,
        setItem: () => {
          throw new Error('QuotaExceededError');
        },
      },
    } as never);
    expect(ensureRsvpKey(TOKEN)).toBeNull();
  });

  it('ignores a stored value that is not a key', () => {
    store[`next-bar:night-out-rsvp:${TOKEN}`] = 'tampered';
    expect(readRsvpKey(TOKEN)).toBeNull();
  });

  /**
   * The offline queue (V8-R-INV-003: "an offline response is queued and
   * explicitly labelled as not yet sent").
   */
  it('holds ONE answer per plan, overwritten rather than appended', () => {
    expect(readQueuedRsvp(TOKEN)).toBeNull();
    expect(queueRsvp(TOKEN, 'maybe')).toBe(true);
    expect(readQueuedRsvp(TOKEN)).toBe('maybe');
    // An RSVP is a current answer, not a log: tapping Going after Maybe while
    // offline must send Going once, not both in some order.
    expect(queueRsvp(TOKEN, 'going')).toBe(true);
    expect(readQueuedRsvp(TOKEN)).toBe('going');
    clearQueuedRsvp(TOKEN);
    expect(readQueuedRsvp(TOKEN)).toBeNull();
  });

  it('reports a queue it could not write, rather than claiming to hold it', () => {
    vi.stubGlobal('window', {
      localStorage: {
        getItem: () => null,
        setItem: () => {
          throw new Error('QuotaExceededError');
        },
      },
    } as never);
    expect(queueRsvp(TOKEN, 'going')).toBe(false);
  });

  it('ignores a queued value that is not one of the three choices', () => {
    store[`next-bar:night-out-rsvp-queued:${TOKEN}`] = 'attending';
    expect(readQueuedRsvp(TOKEN)).toBeNull();
  });
});
