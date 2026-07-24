import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchCircleRsvps, rsvpBar, unrsvpBar } from '@/lib/rsvps.server';

/** Hand-rolled supabase fake (suggestions.server.test.ts pattern). */
function fakeSupabase(opts: {
  rpcData?: unknown;
  rpcError?: unknown;
  deleteError?: unknown;
}) {
  const calls = {
    rpc: [] as Array<{ fn: string; args: unknown }>,
    from: [] as string[],
    eq: [] as Array<{ column: string; value: unknown }>,
    deletes: 0,
  };
  const eqChain = () => {
    const chain: Record<string, unknown> = {
      eq(column: string, value: unknown) {
        calls.eq.push({ column, value });
        return chain;
      },
      then(resolve: (v: unknown) => unknown) {
        return Promise.resolve({ error: opts.deleteError ?? null }).then(resolve);
      },
    };
    return chain;
  };
  const client = {
    rpc(fn: string, args: unknown) {
      calls.rpc.push({ fn, args });
      return Promise.resolve({
        data: opts.rpcData ?? null,
        error: opts.rpcError ?? null,
      });
    },
    from(table: string) {
      calls.from.push(table);
      return {
        delete() {
          calls.deletes += 1;
          return eqChain();
        },
      };
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

describe('rsvpBar', () => {
  it('calls the rsvp_bar RPC with barId + night', async () => {
    const { client, calls } = fakeSupabase({ rpcData: true });
    expect(await rsvpBar(client, 'ace-bar', '2026-07-24')).toBe(true);
    expect(calls.rpc).toEqual([
      { fn: 'rsvp_bar', args: { bar: 'ace-bar', night: '2026-07-24' } },
    ]);
  });

  it('rejects malformed input client-side — the RPC is never hit', async () => {
    const { client, calls } = fakeSupabase({ rpcData: true });
    expect(await rsvpBar(client, 'Bad Id', '2026-07-24')).toBe(false);
    expect(await rsvpBar(client, 'ace-bar', 'not-a-date')).toBe(false);
    expect(calls.rpc).toEqual([]);
  });

  it('false on RPC decline or error', async () => {
    const declined = fakeSupabase({ rpcData: false });
    expect(await rsvpBar(declined.client, 'ace-bar', '2026-07-24')).toBe(false);
    const errored = fakeSupabase({ rpcError: { message: 'boom' } });
    expect(await rsvpBar(errored.client, 'ace-bar', '2026-07-24')).toBe(false);
  });
});

describe('unrsvpBar', () => {
  it('deletes the own row scoped by user, bar, and night', async () => {
    const { client, calls } = fakeSupabase({});
    expect(await unrsvpBar(client, 'uuid-me', 'ace-bar', '2026-07-24')).toBe(true);
    expect(calls.from).toEqual(['bar_rsvps']);
    expect(calls.deletes).toBe(1);
    expect(calls.eq).toEqual([
      { column: 'user_id', value: 'uuid-me' },
      { column: 'bar_id', value: 'ace-bar' },
      { column: 'night', value: '2026-07-24' },
    ]);
  });

  it('false on delete error', async () => {
    const { client } = fakeSupabase({ deleteError: { message: 'RLS' } });
    expect(await unrsvpBar(client, 'uuid-me', 'ace-bar', '2026-07-24')).toBe(false);
  });
});

describe('fetchCircleRsvps', () => {
  it('maps RPC rows to camelCase', async () => {
    const { client, calls } = fakeSupabase({
      rpcData: [
        { user_id: 'u1', handle: 'claire', display_name: 'Claire', bar_id: 'ace-bar' },
      ],
    });
    expect(await fetchCircleRsvps(client, '2026-07-24')).toEqual([
      { userId: 'u1', handle: 'claire', displayName: 'Claire', barId: 'ace-bar' },
    ]);
    expect(calls.rpc[0].fn).toBe('get_circle_rsvps');
  });

  it('[] when nobody is in yet, null on error (distinguishable)', async () => {
    const empty = fakeSupabase({ rpcData: [] });
    expect(await fetchCircleRsvps(empty.client, '2026-07-24')).toEqual([]);
    const errored = fakeSupabase({ rpcError: { message: 'boom' } });
    expect(await fetchCircleRsvps(errored.client, '2026-07-24')).toBe(null);
  });
});
