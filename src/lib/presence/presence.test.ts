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

  it('admits exactly the two audiences (V8-R-PRE-002)', () => {
    expect(isPresenceAudience('friends')).toBe(true);
    expect(isPresenceAudience('close')).toBe(true);
    expect(isPresenceAudience('public')).toBe(false);
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
    });
  });

  it('defaults to the friends audience and no bar', async () => {
    const { client, rpc } = rpcClient({ data: true, error: null });
    await setPresence(client, { status: 'maybe' });
    expect(rpc).toHaveBeenCalledWith('set_night_presence', {
      p_status: 'maybe',
      p_bar_id: null,
      p_audience: 'friends',
    });
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
  /** Minimal PostgREST builder double for the own-row select. */
  function tableClient(result: RpcResult) {
    const maybeSingle = vi.fn().mockResolvedValue(result);
    const eqNight = vi.fn().mockReturnValue({ maybeSingle });
    const eqUser = vi.fn().mockReturnValue({ eq: eqNight });
    const select = vi.fn().mockReturnValue({ eq: eqUser });
    const from = vi.fn().mockReturnValue({ select });
    return {
      client: { from } as unknown as Parameters<typeof fetchMyPresence>[0],
      from,
      eqUser,
      eqNight,
    };
  }

  it('scopes the read to the caller and to tonight', async () => {
    const t = tableClient({
      data: {
        status: 'going',
        bar_id: 'attaboy',
        audience: 'close',
        updated_at: '2026-07-25T02:00:00Z',
      },
      error: null,
    });
    await expect(
      fetchMyPresence(t.client, 'user-1', '2026-07-24'),
    ).resolves.toEqual({
      status: 'going',
      barId: 'attaboy',
      audience: 'close',
      updatedAt: '2026-07-25T02:00:00Z',
    });
    expect(t.from).toHaveBeenCalledWith('night_presence');
    expect(t.eqUser).toHaveBeenCalledWith('user_id', 'user-1');
    expect(t.eqNight).toHaveBeenCalledWith('night', '2026-07-24');
  });

  it('is null when nothing is set tonight, and on error', async () => {
    const none = tableClient({ data: null, error: null });
    await expect(
      fetchMyPresence(none.client, 'user-1', '2026-07-24'),
    ).resolves.toBeNull();
    const failed = tableClient({ data: null, error: { message: 'x' } });
    await expect(
      fetchMyPresence(failed.client, 'user-1', '2026-07-24'),
    ).resolves.toBeNull();
  });

  it('falls back to the narrower reading of an unknown audience', async () => {
    // An unrecognised audience must never widen who can see a pin. It is
    // reported as 'friends' only because that is what the UI shows the OWNER;
    // the actual gate is server-side and never consults this value.
    const t = tableClient({
      data: {
        status: 'going',
        bar_id: null,
        audience: 'everyone',
        updated_at: '2026-07-25T02:00:00Z',
      },
      error: null,
    });
    const mine = await fetchMyPresence(t.client, 'user-1', '2026-07-24');
    expect(mine?.audience).toBe('friends');
  });
});
