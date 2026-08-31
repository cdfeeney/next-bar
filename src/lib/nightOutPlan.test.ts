import { describe, expect, test, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  setNightOutArea,
  setNightOutStart,
  setNightOutVotingDeadline,
} from './nightOutPlan';

/**
 * The client half of 0068's three owner edits (V8-R-NO-002, NO-003, NO-005).
 *
 * The RPC NAMES and the ARGUMENT names are the contract with the migration and
 * are exactly what nothing checked for five rounds — the functions existed in
 * SQL and were called from nowhere. A typo in either is a silent refusal.
 */

const PLAN = '11111111-1111-4111-8111-111111111111';

function clientReturning(result: { data?: unknown; error?: unknown }) {
  const rpc = vi.fn().mockResolvedValue({ data: null, error: null, ...result });
  return { client: { rpc } as unknown as SupabaseClient, rpc };
}

describe('the three owner edits', () => {
  test('set_night_out_start carries the instant, or null for the default', async () => {
    const { client, rpc } = clientReturning({ data: true });
    await expect(setNightOutStart(client, PLAN, '2026-08-21T01:00:00.000Z')).resolves.toBe(true);
    expect(rpc).toHaveBeenCalledWith('set_night_out_start', {
      p_night_out: PLAN,
      p_starts_at: '2026-08-21T01:00:00.000Z',
    });

    await setNightOutStart(client, PLAN, null);
    expect(rpc).toHaveBeenLastCalledWith('set_night_out_start', {
      p_night_out: PLAN,
      p_starts_at: null,
    });
  });

  test('set_night_out_area carries the text', async () => {
    const { client, rpc } = clientReturning({ data: true });
    await expect(setNightOutArea(client, PLAN, 'East Village')).resolves.toBe(true);
    expect(rpc).toHaveBeenCalledWith('set_night_out_area', {
      p_night_out: PLAN,
      p_area: 'East Village',
    });
  });

  test('set_night_out_voting_deadline carries the instant', async () => {
    const { client, rpc } = clientReturning({ data: true });
    await expect(
      setNightOutVotingDeadline(client, PLAN, '2026-08-21T02:00:00.000Z'),
    ).resolves.toBe(true);
    expect(rpc).toHaveBeenCalledWith('set_night_out_voting_deadline', {
      p_night_out: PLAN,
      p_closes_at: '2026-08-21T02:00:00.000Z',
    });
  });
});

describe('a refusal is never a success', () => {
  test('an error is false', async () => {
    const { client } = clientReturning({ data: true, error: { message: 'nope' } });
    await expect(setNightOutArea(client, PLAN, 'x')).resolves.toBe(false);
  });

  test('anything but true is false — the RPCs answer boolean', async () => {
    const { client } = clientReturning({ data: null });
    await expect(setNightOutArea(client, PLAN, 'x')).resolves.toBe(false);
  });

  test('a throw is a refusal we could not read, not a success', async () => {
    const rpc = vi.fn().mockRejectedValue(new Error('offline'));
    const client = { rpc } as unknown as SupabaseClient;
    await expect(setNightOutStart(client, PLAN, null)).resolves.toBe(false);
  });

  test('a plan id that is not a uuid never reaches the database', async () => {
    const { client, rpc } = clientReturning({ data: true });
    await expect(setNightOutArea(client, 'not-a-uuid', 'x')).resolves.toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
});
