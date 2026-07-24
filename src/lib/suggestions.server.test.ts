import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  fetchCircleSuggestions,
  suggestBar,
  unsuggestBar,
} from '@/lib/suggestions.server';
import { nycNightKey } from '@/lib/nightKey';

/** Hand-rolled supabase fake (profile.server.test.ts pattern). */
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

describe('nycNightKey', () => {
  it('is the NYC calendar date for an evening time', () => {
    // 2026-07-24 23:00 EDT = 2026-07-25 03:00 UTC
    expect(nycNightKey(new Date('2026-07-25T03:00:00Z'))).toBe('2026-07-24');
  });

  it('1am still belongs to the previous night (6am rollover)', () => {
    // 2026-07-25 01:30 EDT = 05:30 UTC
    expect(nycNightKey(new Date('2026-07-25T05:30:00Z'))).toBe('2026-07-24');
  });

  it('7am starts the new night-day', () => {
    // 2026-07-25 07:00 EDT = 11:00 UTC
    expect(nycNightKey(new Date('2026-07-25T11:00:00Z'))).toBe('2026-07-25');
  });

  it('rollover works across a month boundary', () => {
    // 2026-08-01 02:00 EDT = 06:00 UTC
    expect(nycNightKey(new Date('2026-08-01T06:00:00Z'))).toBe('2026-07-31');
  });

  it('handles EST (winter) too', () => {
    // 2026-01-10 01:00 EST = 06:00 UTC
    expect(nycNightKey(new Date('2026-01-10T06:00:00Z'))).toBe('2026-01-09');
  });
});

describe('suggestBar', () => {
  it('calls the suggest_bar RPC with barId + night', async () => {
    const { client, calls } = fakeSupabase({ rpcData: true });
    expect(await suggestBar(client, 'ace-bar', '2026-07-24')).toBe(true);
    expect(calls.rpc).toEqual([
      { fn: 'suggest_bar', args: { bar: 'ace-bar', night: '2026-07-24' } },
    ]);
  });

  it('rejects malformed bar ids and nights client-side — the RPC is never hit', async () => {
    const { client, calls } = fakeSupabase({ rpcData: true });
    expect(await suggestBar(client, "bad'id", '2026-07-24')).toBe(false);
    expect(await suggestBar(client, 'ace-bar', 'tonight')).toBe(false);
    expect(calls.rpc).toEqual([]);
  });

  it('false when the RPC declines (cap hit) or errors', async () => {
    const declined = fakeSupabase({ rpcData: false });
    expect(await suggestBar(declined.client, 'ace-bar', '2026-07-24')).toBe(false);
    const errored = fakeSupabase({ rpcError: { message: 'boom' } });
    expect(await suggestBar(errored.client, 'ace-bar', '2026-07-24')).toBe(false);
  });
});

describe('unsuggestBar', () => {
  it('deletes the own row scoped by user, bar, and night', async () => {
    const { client, calls } = fakeSupabase({});
    expect(await unsuggestBar(client, 'uuid-me', 'ace-bar', '2026-07-24')).toBe(true);
    expect(calls.from).toEqual(['bar_suggestions']);
    expect(calls.deletes).toBe(1);
    expect(calls.eq).toEqual([
      { column: 'user_id', value: 'uuid-me' },
      { column: 'bar_id', value: 'ace-bar' },
      { column: 'night', value: '2026-07-24' },
    ]);
  });

  it('false on delete error', async () => {
    const { client } = fakeSupabase({ deleteError: { message: 'RLS' } });
    expect(await unsuggestBar(client, 'uuid-me', 'ace-bar', '2026-07-24')).toBe(false);
  });
});

describe('fetchCircleSuggestions', () => {
  it('maps RPC rows to camelCase', async () => {
    const { client, calls } = fakeSupabase({
      rpcData: [
        { user_id: 'u1', handle: 'claire', display_name: 'Claire', bar_id: 'ace-bar' },
        { user_id: 'u2', handle: null, display_name: null, bar_id: 'attaboy' },
      ],
    });
    expect(await fetchCircleSuggestions(client, '2026-07-24')).toEqual([
      { userId: 'u1', handle: 'claire', displayName: 'Claire', barId: 'ace-bar' },
      { userId: 'u2', handle: null, displayName: null, barId: 'attaboy' },
    ]);
    expect(calls.rpc[0].fn).toBe('get_circle_suggestions');
  });

  it('[] for an empty night, null on error (distinguishable)', async () => {
    const empty = fakeSupabase({ rpcData: [] });
    expect(await fetchCircleSuggestions(empty.client, '2026-07-24')).toEqual([]);
    const errored = fakeSupabase({ rpcError: { message: 'boom' } });
    expect(await fetchCircleSuggestions(errored.client, '2026-07-24')).toBe(null);
  });
});
