import { describe, expect, it, vi } from 'vitest';
import {
  PRESENCE_LABELS,
  describePresence,
  isBarId,
  isPresenceAudience,
  isPresenceStatus,
  isValidPin,
} from '@/lib/presence';
import {
  clearPresence,
  fetchCirclePresence,
  fetchMyPresence,
  setPresence,
} from '@/lib/presence/server';

/**
 * The two rules worth a test here are the ones that describe a PERSON wrongly
 * if they break: "a pin means Going out" and "never invent a venue". Everything
 * else in this module is a type guard.
 */

type RpcResult = { data: unknown; error: unknown };

/** Minimal Supabase double: records the call, answers with a fixed result. */
function rpcClient(result: RpcResult) {
  const rpc = vi.fn().mockResolvedValue(result);
  return {
    client: { rpc } as unknown as Parameters<typeof setPresence>[0],
    rpc,
  };
}

describe('presence type guards', () => {
  it('admits exactly the three manual statuses (V8-R-PRE-004)', () => {
    expect(isPresenceStatus('going')).toBe(true);
    expect(isPresenceStatus('maybe')).toBe(true);
    expect(isPresenceStatus('not-going')).toBe(true);
    // 'here' is the LEGACY intent vocabulary, not the V8 presence model.
    expect(isPresenceStatus('here')).toBe(false);
    expect(isPresenceStatus('')).toBe(false);
    expect(isPresenceStatus(null)).toBe(false);
  });

  it('admits exactly the three stored audiences (V8-R-PRE-002)', () => {
    expect(isPresenceAudience('friends')).toBe(true);
    expect(isPresenceAudience('close')).toBe(true);
    expect(isPresenceAudience('people')).toBe(true);
    expect(isPresenceAudience('public')).toBe(false);
    // No groups model exists on this branch, so nothing can resolve a named
    // group to a recipient set. Admitting the value would let a pin claim an
    // audience the server cannot enforce.
    expect(isPresenceAudience('group')).toBe(false);
  });

  it('accepts catalog bar ids and rejects anything else', () => {
    expect(isBarId('death-and-co')).toBe(true);
    expect(isBarId('Death-And-Co')).toBe(false); // uppercase
    expect(isBarId('')).toBe(false);
    expect(isBarId('a'.repeat(61))).toBe(false);
    expect(isBarId("'; drop table night_presence; --")).toBe(false);
  });
});

describe('isValidPin (a pin sets Going out)', () => {
  it('allows a bar only with going', () => {
    expect(isValidPin('going', 'attaboy')).toBe(true);
    expect(isValidPin('maybe', 'attaboy')).toBe(false);
    expect(isValidPin('not-going', 'attaboy')).toBe(false);
  });

  it('allows every status with no bar at all', () => {
    expect(isValidPin('going', null)).toBe(true);
    expect(isValidPin('maybe', null)).toBe(true);
    expect(isValidPin('not-going', null)).toBe(true);
  });

  it('rejects a malformed bar id even alongside going', () => {
    expect(isValidPin('going', 'NOT A BAR')).toBe(false);
  });
});

describe('describePresence (never invent a venue — V8-R-SOC-001)', () => {
  it('leads with the bar and says Pinned when one was claimed', () => {
    expect(describePresence({ status: 'going', barId: 'attaboy' })).toEqual({
      barId: 'attaboy',
      note: 'Pinned',
    });
  });

  it('carries the state in words when there is no bar', () => {
    expect(describePresence({ status: 'maybe', barId: null })).toEqual({
      barId: null,
      note: PRESENCE_LABELS.maybe,
    });
    expect(describePresence({ status: 'going', barId: null }).note).toBe(
      'Going out',
    );
  });

  it('drops a bar that contradicts the status rather than showing it', () => {
    // The person said Maybe. Describing them as AT a bar would attribute a
    // venue they never claimed — the exact thing V8-R-SOC-001 forbids.
    expect(describePresence({ status: 'maybe', barId: 'attaboy' })).toEqual({
      barId: null,
      note: PRESENCE_LABELS.maybe,
    });
  });
});

describe('setPresence', () => {
  it('sends status, bar and audience, and reports the server verdict', async () => {
    const { client, rpc } = rpcClient({ data: true, error: null });
    await expect(
      setPresence(client, {
        status: 'going',
        barId: 'attaboy',
        audience: 'close',
      }),
    ).resolves.toBe(true);
    expect(rpc).toHaveBeenCalledWith('set_night_presence', {
      p_status: 'going',
      p_bar_id: 'attaboy',
      p_audience: 'close',
      p_recipient_ids: null,
    });
  });

  it('defaults to the friends audience and no bar', async () => {
    const { client, rpc } = rpcClient({ data: true, error: null });
    await setPresence(client, { status: 'maybe' });
    expect(rpc).toHaveBeenCalledWith('set_night_presence', {
      p_status: 'maybe',
      p_bar_id: null,
      p_audience: 'friends',
      p_recipient_ids: null,
    });
  });

  it('sends the recipient list only for the people audience', async () => {
    const { client, rpc } = rpcClient({ data: true, error: null });
    await setPresence(client, {
      status: 'going',
      audience: 'people',
      recipientIds: ['11111111-1111-1111-1111-111111111111'],
    });
    expect(rpc).toHaveBeenCalledWith('set_night_presence', {
      p_status: 'going',
      p_bar_id: null,
      p_audience: 'people',
      p_recipient_ids: ['11111111-1111-1111-1111-111111111111'],
    });
  });

  it('drops a recipient list attached to a wider audience', async () => {
    // Sending it would be harmless server-side (the RPC ignores it unless the
    // audience is 'people') but it would read as though the list were doing
    // something. A parameter that does nothing is a parameter a later caller
    // will believe.
    const { client, rpc } = rpcClient({ data: true, error: null });
    await setPresence(client, {
      status: 'going',
      audience: 'friends',
      recipientIds: ['11111111-1111-1111-1111-111111111111'],
    });
    const [, args] = rpc.mock.calls[0] as [string, Record<string, unknown>];
    expect(args.p_recipient_ids).toBeNull();
  });

  it('refuses an empty people audience without a round trip (fails closed)', async () => {
    // 'people' with nobody in it is not "show it to nobody" and must never fall
    // back to 'friends' — V8-R-PRE-002: a failed audience write fails the pin
    // rather than silently widening it.
    const { client, rpc } = rpcClient({ data: true, error: null });
    await expect(
      setPresence(client, { status: 'going', audience: 'people' }),
    ).resolves.toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('never sends the night — the server resolves it', async () => {
    const { client, rpc } = rpcClient({ data: true, error: null });
    await setPresence(client, { status: 'going' });
    const [, args] = rpc.mock.calls[0] as [string, Record<string, unknown>];
    expect(Object.keys(args)).not.toContain('p_night');
  });

  it('refuses an invalid pin without a round trip', async () => {
    const { client, rpc } = rpcClient({ data: true, error: null });
    await expect(
      setPresence(client, { status: 'maybe', barId: 'attaboy' }),
    ).resolves.toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('is false on an RPC error and on a non-true payload', async () => {
    const bad = rpcClient({ data: null, error: { message: 'nope' } });
    await expect(setPresence(bad.client, { status: 'going' })).resolves.toBe(
      false,
    );
    const odd = rpcClient({ data: 'ok', error: null });
    await expect(setPresence(odd.client, { status: 'going' })).resolves.toBe(
      false,
    );
  });
});

describe('never throws (the module contract)', () => {
  // Same rule, same shape, same test as nightOutMedia/server.ts: an RPC that
  // throws is a FAILED read, never an empty one, and never an escaped
  // rejection. The header above has claimed "never throw" since this module was
  // written; this is what holds it to it.
  const throwing = {
    rpc: () => {
      throw new TypeError('supabase.rpc is not a function');
    },
  } as unknown as Parameters<typeof setPresence>[0];

  it('reports a thrown call as a failure, on every entry point', async () => {
    await expect(setPresence(throwing, { status: 'going' })).resolves.toBe(false);
    await expect(clearPresence(throwing)).resolves.toBe(false);
    await expect(fetchCirclePresence(throwing)).resolves.toBeNull();
    await expect(fetchMyPresence(throwing)).resolves.toEqual({ kind: 'failed' });
  });

  it('never reports a thrown circle read as an empty circle', async () => {
    // Rendering "no friends out yet tonight" for a read that never reached the
    // server is the V8-R-OPS-005 lie this module exists to prevent.
    await expect(fetchCirclePresence(throwing)).resolves.not.toEqual([]);
  });
});

describe('clearPresence', () => {
  it('calls the RPC and reports the verdict', async () => {
    const { client, rpc } = rpcClient({ data: true, error: null });
    await expect(clearPresence(client)).resolves.toBe(true);
    expect(rpc).toHaveBeenCalledWith('clear_night_presence');
  });

  it('is false on error', async () => {
    const { client } = rpcClient({ data: null, error: { message: 'x' } });
    await expect(clearPresence(client)).resolves.toBe(false);
  });
});

describe('fetchCirclePresence', () => {
  const row = {
    // get_circle_presence projects the profile id so the Stories rail, whose cells are
    // keyed on it, can match a pin. A row without it is malformed and is dropped.
    user_id: '11111111-1111-1111-1111-111111111111',
    handle: 'ana',
    display_name: 'Ana',
    status: 'going',
    bar_id: 'attaboy',
    updated_at: '2026-07-25T02:00:00Z',
  };

  it('maps a well-formed row', async () => {
    const { client } = rpcClient({ data: [row], error: null });
    await expect(fetchCirclePresence(client)).resolves.toEqual([
      {
        userId: '11111111-1111-1111-1111-111111111111',
        handle: 'ana',
        displayName: 'Ana',
        status: 'going',
        barId: 'attaboy',
        updatedAt: '2026-07-25T02:00:00Z',
      },
    ]);
  });

  it('distinguishes "nobody out" from "could not load"', async () => {
    const empty = rpcClient({ data: [], error: null });
    await expect(fetchCirclePresence(empty.client)).resolves.toEqual([]);
    const failed = rpcClient({ data: null, error: { message: 'x' } });
    await expect(fetchCirclePresence(failed.client)).resolves.toBeNull();
    const nonsense = rpcClient({ data: { rows: [] }, error: null });
    await expect(fetchCirclePresence(nonsense.client)).resolves.toBeNull();
  });

  it('drops a malformed bar id but keeps the person and their status', async () => {
    const { client } = rpcClient({
      data: [{ ...row, bar_id: 'NOT A BAR' }],
      error: null,
    });
    const rows = await fetchCirclePresence(client);
    expect(rows).toHaveLength(1);
    expect(rows?.[0].barId).toBeNull();
    expect(rows?.[0].status).toBe('going');
  });

  it('drops rows that are not describable at all', async () => {
    const { client } = rpcClient({
      data: [
        { ...row, status: 'raving' }, // unknown status
        { ...row, handle: '' }, // nobody to attribute it to
        { ...row, updated_at: null }, // no timestamp line
      ],
      error: null,
    });
    await expect(fetchCirclePresence(client)).resolves.toEqual([]);
  });
});

describe('fetchMyPresence', () => {
  /**
   * RPC double. The own-row read goes through `get_my_presence()`, NOT a table select:
   * 0068 revokes every table privilege on night_presence, so a direct read is denied at
   * the permission layer before RLS is consulted. A builder double would let a
   * table-reading regression pass here while failing against a real database.
   */
  function rpcOwnPresence(result: RpcResult) {
    const rpc = vi.fn().mockResolvedValue(result);
    const from = vi.fn(() => { throw new Error('night_presence must not be read as a table'); });
    return {
      client: { rpc, from } as unknown as Parameters<typeof fetchMyPresence>[0],
      rpc,
      from,
    };
  }

  it('reads the own row through the RPC, never the table', async () => {
    const t = rpcOwnPresence({
      data: [{
        status: 'going',
        bar_id: 'attaboy',
        audience: 'close',
        updated_at: '2026-07-25T02:00:00Z',
      }],
      error: null,
    });
    await expect(fetchMyPresence(t.client)).resolves.toEqual({
      kind: 'ok',
      presence: {
        status: 'going',
        barId: 'attaboy',
        audience: 'close',
        recipientIds: [],
        updatedAt: '2026-07-25T02:00:00Z',
      },
    });
    // No arguments: identity is auth.uid() and the night is the server-side boundary, so
    // this cannot be asked about another account or pointed at another night.
    expect(t.rpc).toHaveBeenCalledWith('get_my_presence');
    expect(t.from).not.toHaveBeenCalled();
  });

  /**
   * THE ONE THAT WIDENS AN AUDIENCE IF IT IS GOT WRONG. 'unset' is the only
   * outcome a caller may choose a default audience for; a failed read that
   * looked like 'unset' let the next status tap rewrite a live 'close' or
   * 'people' pin as 'friends' and wipe its recipient list.
   */
  it('keeps "no pin tonight" apart from "the read failed"', async () => {
    const none = rpcOwnPresence({ data: [], error: null });
    await expect(fetchMyPresence(none.client)).resolves.toEqual({
      kind: 'unset',
    });
    const failed = rpcOwnPresence({ data: null, error: { message: 'x' } });
    await expect(fetchMyPresence(failed.client)).resolves.toEqual({
      kind: 'failed',
    });
    const nonsense = rpcOwnPresence({ data: { rows: [] }, error: null });
    await expect(fetchMyPresence(nonsense.client)).resolves.toEqual({
      kind: 'failed',
    });
  });

  it('treats a row it cannot describe as a failed read, never as no pin', async () => {
    // The server said there IS a pin. Calling that 'unset' would hand the next
    // write a default audience for a row that already has one.
    const t = rpcOwnPresence({
      data: [{
        status: 'raving',
        bar_id: null,
        audience: 'close',
        updated_at: '2026-07-25T02:00:00Z',
      }],
      error: null,
    });
    await expect(fetchMyPresence(t.client)).resolves.toEqual({ kind: 'failed' });
  });

  it('falls back to the narrower reading of an unknown audience', async () => {
    // An unrecognised audience must never be REPORTED as a wider one. This
    // value drives which audience control the owner sees lit and what the next
    // status write sends back, so reading an unparseable row as 'friends' would
    // show the owner a wider audience than the server is enforcing — and could
    // then write it. 'close' is the narrowest value that always exists.
    const t = rpcOwnPresence({
      data: [{
        status: 'going',
        bar_id: null,
        audience: 'everyone',
        updated_at: '2026-07-25T02:00:00Z',
      }],
      error: null,
    });
    const read = await fetchMyPresence(t.client);
    expect(read.kind === 'ok' && read.presence.audience).toBe('close');
  });

  it('carries the people selection the SERVER kept', async () => {
    const kept = '22222222-2222-2222-2222-222222222222';
    const t = rpcOwnPresence({
      data: [{
        status: 'going',
        bar_id: 'attaboy',
        audience: 'people',
        updated_at: '2026-07-25T02:00:00Z',
        recipient_ids: [kept, '', null, 7],
      }],
      error: null,
    });
    const read = await fetchMyPresence(t.client);
    expect(read.kind === 'ok' && read.presence.audience).toBe('people');
    // Non-string entries are dropped rather than coerced: a recipient we cannot
    // name is not a recipient to show.
    expect(read.kind === 'ok' && read.presence.recipientIds).toEqual([kept]);
  });

  it('reports an absent recipient list as empty, never undefined', async () => {
    const t = rpcOwnPresence({
      data: [{
        status: 'maybe',
        bar_id: null,
        audience: 'friends',
        updated_at: '2026-07-25T02:00:00Z',
      }],
      error: null,
    });
    await expect(fetchMyPresence(t.client)).resolves.toMatchObject({
      kind: 'ok',
      presence: { recipientIds: [] },
    });
  });
});
