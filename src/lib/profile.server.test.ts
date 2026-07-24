import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  checkHandleAvailability,
  claimHandle,
  DISPLAY_NAME_MAX,
  fetchOwnProfile,
  isValidDisplayName,
  isValidHandle,
  searchHandles,
  setOwnDisplayName,
  setOwnPrivacy,
} from '@/lib/profile.server';

/**
 * Hand-rolled fake of the supabase-js client (same pattern as
 * ratings.server.test.ts): every method records the call so tests assert
 * WHAT was sent — especially that invalid input never reaches the RPC.
 */
function fakeSupabase(opts: {
  rpcData?: unknown;
  rpcError?: unknown;
  selectData?: unknown;
  selectError?: unknown;
  updateError?: unknown;
}) {
  const calls = {
    rpc: [] as Array<{ fn: string; args: unknown }>,
    from: [] as string[],
    select: [] as string[],
    limit: [] as number[],
    update: [] as unknown[],
    eq: [] as Array<{ column: string; value: unknown }>,
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
        select(columns: string) {
          calls.select.push(columns);
          return {
            limit(n: number) {
              calls.limit.push(n);
              return Promise.resolve({
                data: opts.selectData ?? null,
                error: opts.selectError ?? null,
              });
            },
          };
        },
        update(values: unknown) {
          calls.update.push(values);
          return {
            eq(column: string, value: unknown) {
              calls.eq.push({ column, value });
              return Promise.resolve({
                data: null,
                error: opts.updateError ?? null,
              });
            },
          };
        },
      };
    },
  } as unknown as SupabaseClient;

  return { client, calls };
}

describe('isValidHandle', () => {
  it('accepts 3–20 chars of lowercase letters, digits, underscores', () => {
    expect(isValidHandle('abc')).toBe(true);
    expect(isValidHandle('connor_f')).toBe(true);
    expect(isValidHandle('a'.repeat(20))).toBe(true);
  });

  it('accepts mixed case (validation runs on the normalized form)', () => {
    expect(isValidHandle('ConnorF')).toBe(true);
  });

  it('rejects too-short, too-long, and out-of-charset input', () => {
    expect(isValidHandle('ab')).toBe(false);
    expect(isValidHandle('a'.repeat(21))).toBe(false);
    expect(isValidHandle('has space')).toBe(false);
    expect(isValidHandle('dash-name')).toBe(false);
    expect(isValidHandle('émile')).toBe(false);
    expect(isValidHandle('')).toBe(false);
  });
});

describe('claimHandle', () => {
  it('calls the claim_handle RPC with the typed (trimmed) casing preserved', async () => {
    const { client, calls } = fakeSupabase({ rpcData: 'ConnorF' });

    const claimed = await claimHandle(client, '  ConnorF ');

    expect(claimed).toBe('ConnorF');
    expect(calls.rpc).toEqual([{ fn: 'claim_handle', args: { desired: 'ConnorF' } }]);
  });

  it('rejects invalid charset client-side — the RPC is never hit', async () => {
    const { client, calls } = fakeSupabase({ rpcData: 'nope' });

    expect(await claimHandle(client, 'ab')).toBeNull();
    expect(await claimHandle(client, 'has space')).toBeNull();
    expect(await claimHandle(client, 'dash-name')).toBeNull();
    expect(calls.rpc).toHaveLength(0);
  });

  it('returns null when the RPC errors', async () => {
    const { client } = fakeSupabase({ rpcError: { message: 'boom' } });
    expect(await claimHandle(client, 'connor_f')).toBeNull();
  });

  it('returns null when the RPC returns null (taken / lost race / rate-capped)', async () => {
    const { client } = fakeSupabase({ rpcData: null });
    expect(await claimHandle(client, 'connor_f')).toBeNull();
  });
});

describe('searchHandles', () => {
  it('maps RPC rows into camelCase results', async () => {
    const { client, calls } = fakeSupabase({
      rpcData: [
        { handle: 'ConnorF', display_name: 'Connor' },
        { handle: 'connie', display_name: null },
      ],
    });

    const results = await searchHandles(client, 'conn');

    expect(results).toEqual([
      { handle: 'ConnorF', displayName: 'Connor' },
      { handle: 'connie', displayName: null },
    ]);
    expect(calls.rpc).toEqual([{ fn: 'search_handles', args: { query: 'conn' } }]);
  });

  it('lowercases and trims the query before sending', async () => {
    const { client, calls } = fakeSupabase({ rpcData: [] });
    await searchHandles(client, ' Conn ');
    expect(calls.rpc).toEqual([{ fn: 'search_handles', args: { query: 'conn' } }]);
  });

  it('returns [] without an RPC call for an out-of-charset query', async () => {
    const { client, calls } = fakeSupabase({ rpcData: [] });
    expect(await searchHandles(client, 'no way!')).toEqual([]);
    expect(await searchHandles(client, '')).toEqual([]);
    expect(calls.rpc).toHaveLength(0);
  });

  it('returns [] for an empty result set', async () => {
    const { client } = fakeSupabase({ rpcData: [] });
    expect(await searchHandles(client, 'zzz')).toEqual([]);
  });

  it('returns null when the RPC errors (distinguishable from "no matches")', async () => {
    const { client } = fakeSupabase({ rpcError: { message: 'boom' } });
    expect(await searchHandles(client, 'conn')).toBeNull();
  });
});

describe('checkHandleAvailability', () => {
  it('is false for invalid input without any RPC call', async () => {
    const { client, calls } = fakeSupabase({ rpcData: [] });
    expect(await checkHandleAvailability(client, 'ab')).toBe(false);
    expect(calls.rpc).toHaveLength(0);
  });

  it('is true when the exact-match search comes back empty', async () => {
    const { client } = fakeSupabase({ rpcData: [] });
    expect(await checkHandleAvailability(client, 'connor_f')).toBe(true);
  });

  it('is true when only PREFIX matches exist (no exact match)', async () => {
    const { client } = fakeSupabase({
      rpcData: [{ handle: 'connor_f2', display_name: null }],
    });
    expect(await checkHandleAvailability(client, 'connor_f')).toBe(true);
  });

  it('is false on a case-insensitive exact match', async () => {
    const { client } = fakeSupabase({
      rpcData: [{ handle: 'ConnorF', display_name: 'Connor' }],
    });
    expect(await checkHandleAvailability(client, 'connorf')).toBe(false);
  });

  it('is false (not available) when the search errors — server claim stays authoritative', async () => {
    const { client } = fakeSupabase({ rpcError: { message: 'boom' } });
    expect(await checkHandleAvailability(client, 'connor_f')).toBe(false);
  });
});

describe('fetchOwnProfile', () => {
  it('selects the profile columns and maps them to camelCase', async () => {
    const { client, calls } = fakeSupabase({
      selectData: [{ handle: 'ConnorF', display_name: 'Connor', is_private: false }],
    });

    const profile = await fetchOwnProfile(client);

    expect(profile).toEqual({
      handle: 'ConnorF',
      displayName: 'Connor',
      isPrivate: false,
    });
    expect(calls.from).toEqual(['profiles']);
    expect(calls.select).toEqual(['handle, display_name, is_private']);
    expect(calls.limit).toEqual([1]);
  });

  it('preserves a null handle (the "not claimed yet" state)', async () => {
    const { client } = fakeSupabase({
      selectData: [{ handle: null, display_name: null, is_private: true }],
    });
    expect(await fetchOwnProfile(client)).toEqual({
      handle: null,
      displayName: null,
      isPrivate: true,
    });
  });

  it('returns null when the query errors', async () => {
    const { client } = fakeSupabase({ selectError: { message: 'RLS denied' } });
    expect(await fetchOwnProfile(client)).toBeNull();
  });

  it('returns null when no profile row exists', async () => {
    const { client } = fakeSupabase({ selectData: [] });
    expect(await fetchOwnProfile(client)).toBeNull();
  });
});

describe('setOwnPrivacy (B3b privacy toggle)', () => {
  it('updates only is_private, scoped to the caller row', async () => {
    const { client, calls } = fakeSupabase({});

    expect(await setOwnPrivacy(client, 'uuid-me', true)).toBe(true);

    expect(calls.from).toEqual(['profiles']);
    // ONLY is_private — a wider payload would be refused by the 0006 column
    // grant, but the client must not even try.
    expect(calls.update).toEqual([{ is_private: true }]);
    expect(calls.eq).toEqual([{ column: 'id', value: 'uuid-me' }]);
  });

  it('returns false on update error — the toggle UI reverts', async () => {
    const { client } = fakeSupabase({
      updateError: { message: 'RLS denied' },
    });
    expect(await setOwnPrivacy(client, 'uuid-me', false)).toBe(false);
  });
});

describe('isValidDisplayName', () => {
  it('accepts ordinary names up to the cap (validation runs on the trimmed form)', () => {
    expect(isValidDisplayName('Conor')).toBe(true);
    expect(isValidDisplayName('  Conor F  ')).toBe(true);
    expect(isValidDisplayName('a'.repeat(DISPLAY_NAME_MAX))).toBe(true);
  });

  it('accepts empty input (empty means "clear the name")', () => {
    expect(isValidDisplayName('')).toBe(true);
    expect(isValidDisplayName('   ')).toBe(true);
  });

  it('rejects names over the cap', () => {
    expect(isValidDisplayName('a'.repeat(DISPLAY_NAME_MAX + 1))).toBe(false);
  });
});

describe('setOwnDisplayName (identity: account name)', () => {
  it('writes the trimmed display_name, scoped to the caller row', async () => {
    const { client, calls } = fakeSupabase({});

    expect(await setOwnDisplayName(client, 'uuid-me', '  Conor F ')).toBe(true);

    expect(calls.from).toEqual(['profiles']);
    // ONLY display_name — a wider payload would be refused by the 0006
    // column grant, but the client must not even try.
    expect(calls.update).toEqual([{ display_name: 'Conor F' }]);
    expect(calls.eq).toEqual([{ column: 'id', value: 'uuid-me' }]);
  });

  it('writes null when the input is empty/whitespace (clears the name)', async () => {
    const { client, calls } = fakeSupabase({});

    expect(await setOwnDisplayName(client, 'uuid-me', '   ')).toBe(true);

    expect(calls.update).toEqual([{ display_name: null }]);
  });

  it('rejects over-cap input client-side — the server is never hit', async () => {
    const { client, calls } = fakeSupabase({});

    expect(
      await setOwnDisplayName(client, 'uuid-me', 'x'.repeat(DISPLAY_NAME_MAX + 1)),
    ).toBe(false);

    expect(calls.from).toEqual([]);
    expect(calls.update).toEqual([]);
  });

  it('returns false on update error — the editor UI keeps the old value', async () => {
    const { client } = fakeSupabase({
      updateError: { message: 'RLS denied' },
    });
    expect(await setOwnDisplayName(client, 'uuid-me', 'Conor')).toBe(false);
  });
});
