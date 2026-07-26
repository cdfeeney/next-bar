import { describe, expect, it, vi } from 'vitest';
import {
  fetchSharedNight,
  isShareToken,
  shareNight,
} from '@/lib/nights.server';
import type { SupabaseClient } from '@supabase/supabase-js';

// The token gate is security-load-bearing: it stands between an arbitrary
// URL segment and the anon RPC (E4.4 review HIGH — never waived).
describe('isShareToken', () => {
  const VALID = '123e4567-e89b-42d3-a456-426614174000';

  it('accepts canonical uuids, either case', () => {
    expect(isShareToken(VALID)).toBe(true);
    expect(isShareToken(VALID.toUpperCase())).toBe(true);
  });

  it('rejects near-misses: wrong grouping, lengths, missing dashes', () => {
    expect(isShareToken('')).toBe(false);
    expect(isShareToken('not-a-token')).toBe(false);
    expect(isShareToken(VALID.replace(/-/g, ''))).toBe(false); // no dashes
    expect(isShareToken(`${VALID}0`)).toBe(false); // too long
    expect(isShareToken(VALID.slice(0, 35))).toBe(false); // too short
    expect(isShareToken('123e4567e89b-42d3-a456-4266141740000')).toBe(false); // regrouped
    expect(isShareToken('123e4567-e89b-42d3-a456-42661417400g')).toBe(false); // non-hex
  });

  it('rejects injection-shaped strings outright', () => {
    expect(isShareToken("' or 1=1 --")).toBe(false);
    expect(isShareToken('../../etc/passwd')).toBe(false);
  });
});

function rpcClient(result: { data: unknown; error: unknown }): SupabaseClient {
  return { rpc: vi.fn().mockResolvedValue(result) } as unknown as SupabaseClient;
}

describe('fetchSharedNight defensive row validation', () => {
  const TOKEN = '123e4567-e89b-42d3-a456-426614174000';
  const GOOD_ROW = {
    handle: 'conor_f',
    display_name: 'Conor F',
    night: '2026-07-25',
    bar_ids: ['attaboy'],
    loved_bar_id: null,
    shared_at: '2026-07-26T15:00:00Z',
  };

  it('maps a well-formed row', async () => {
    const night = await fetchSharedNight(rpcClient({ data: [GOOD_ROW], error: null }), TOKEN);
    expect(night).toEqual({
      handle: 'conor_f',
      displayName: 'Conor F',
      night: '2026-07-25',
      barIds: ['attaboy'],
      lovedBarId: null,
      sharedAt: '2026-07-26T15:00:00Z',
    });
  });

  it('never calls the RPC for a garbage token', async () => {
    const client = rpcClient({ data: [GOOD_ROW], error: null });
    expect(await fetchSharedNight(client, 'not-a-token')).toBeNull();
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it('nulls on error, empty, non-array, and malformed rows', async () => {
    expect(
      await fetchSharedNight(rpcClient({ data: null, error: { message: 'x' } }), TOKEN),
    ).toBeNull();
    expect(await fetchSharedNight(rpcClient({ data: [], error: null }), TOKEN)).toBeNull();
    expect(
      await fetchSharedNight(rpcClient({ data: { rows: [] }, error: null }), TOKEN),
    ).toBeNull();
    expect(
      await fetchSharedNight(
        rpcClient({ data: [{ ...GOOD_ROW, handle: 42 }], error: null }),
        TOKEN,
      ),
    ).toBeNull();
    expect(
      await fetchSharedNight(
        rpcClient({ data: [{ ...GOOD_ROW, bar_ids: 'attaboy' }], error: null }),
        TOKEN,
      ),
    ).toBeNull();
  });

  it('filters non-string members out of bar_ids', async () => {
    const night = await fetchSharedNight(
      rpcClient({
        data: [{ ...GOOD_ROW, bar_ids: ['attaboy', 42, null, 'sisters'] }],
        error: null,
      }),
      TOKEN,
    );
    expect(night?.barIds).toEqual(['attaboy', 'sisters']);
  });
});

describe('shareNight', () => {
  it('returns the token string, null otherwise', async () => {
    const token = '123e4567-e89b-42d3-a456-426614174000';
    expect(
      await shareNight(rpcClient({ data: token, error: null }), {
        nightKey: '2026-07-25',
        barIds: ['attaboy'],
        lovedBarId: null,
      }),
    ).toBe(token);
    expect(
      await shareNight(rpcClient({ data: null, error: { message: 'x' } }), {
        nightKey: '2026-07-25',
        barIds: ['attaboy'],
        lovedBarId: null,
      }),
    ).toBeNull();
  });
});
