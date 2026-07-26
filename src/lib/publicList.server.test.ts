import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchPublicRatings } from '@/lib/publicList.server';

/**
 * Hand-rolled supabase-js fake, same pattern as follows.server.test.ts: every
 * call is recorded so tests assert WHAT was sent — especially that an invalid
 * handle never reaches the RPC, and that nothing in this path ever asks for
 * `score`.
 *
 * Migration 0015 is authored but NOT APPLIED, so these are the only tests this
 * path can have. They pin the contract the SQL must satisfy when someone does
 * apply it, and they cover the shape of failure that matters most: a missing
 * RPC must degrade to "no list", never to an error on a link a stranger was
 * just texted.
 */
type RpcResult = { data?: unknown; error?: unknown };

function fakeSupabase(result: RpcResult) {
  const calls: Array<{ fn: string; args: unknown }> = [];
  const client = {
    rpc(fn: string, args: unknown) {
      calls.push({ fn, args });
      return Promise.resolve({
        data: result.data ?? null,
        error: result.error ?? null,
      });
    },
  };
  return { client: client as unknown as SupabaseClient, calls };
}

const ROWS = [
  { bar_id: 'attaboy', tier: 'liked', rated_at: '2026-07-20T00:00:00.000Z' },
  { bar_id: 'death-and-co', tier: 'loved', rated_at: '2026-07-01T00:00:00.000Z' },
  { bar_id: 'dead-rabbit', tier: 'loved', rated_at: '2026-07-22T00:00:00.000Z' },
  { bar_id: 'some-dive', tier: 'pass', rated_at: '2026-07-25T00:00:00.000Z' },
];

describe('fetchPublicRatings', () => {
  it('calls get_public_ratings with the normalized handle', async () => {
    const { client, calls } = fakeSupabase({ data: ROWS });
    await fetchPublicRatings(client, '  Connor  ');

    expect(calls).toHaveLength(1);
    expect(calls[0].fn).toBe('get_public_ratings');
    expect(calls[0].args).toEqual({ handle_query: 'connor' });
  });

  it('ranks loved before liked before pass, newest first within a tier', async () => {
    const { client } = fakeSupabase({ data: ROWS });
    const list = await fetchPublicRatings(client, 'connor');

    expect(list?.map((entry) => entry.barId)).toEqual([
      'dead-rabbit', // loved, newer
      'death-and-co', // loved, older
      'attaboy', // liked
      'some-dive', // pass
    ]);
  });

  it.each([
    ['an empty handle', ''],
    ['whitespace', '   '],
    ['a LIKE wildcard', 'con%'],
    ['a path traversal attempt', '../admin'],
    ['a handle over 20 chars', 'c'.repeat(21)],
    ['sql-ish punctuation', "connor'; drop table ratings; --"],
  ])('never reaches the RPC with %s', async (_label, handle) => {
    const { client, calls } = fakeSupabase({ data: ROWS });
    const list = await fetchPublicRatings(client, handle);

    expect(calls).toHaveLength(0);
    expect(list).toBeNull();
  });

  // The shape of failure that matters: 0015 is not applied, so the RPC does
  // not exist. A link a stranger was just texted must degrade to "no list".
  it('returns null when the RPC does not exist yet', async () => {
    const { client } = fakeSupabase({
      error: { code: '42883', message: 'function public.get_public_ratings(text) does not exist' },
    });

    expect(await fetchPublicRatings(client, 'connor')).toBeNull();
  });

  it('returns null when the profile has not opted in', async () => {
    // The RPC returns zero rows for opted-out, unknown, and private profiles
    // alike — the caller cannot tell them apart, which is the point.
    const { client } = fakeSupabase({ data: [] });

    expect(await fetchPublicRatings(client, 'connor')).toBeNull();
  });

  it('returns null on a non-array payload', async () => {
    const { client } = fakeSupabase({ data: { rows: ROWS } });

    expect(await fetchPublicRatings(client, 'connor')).toBeNull();
  });

  it('drops malformed rows rather than trusting the payload', async () => {
    const { client } = fakeSupabase({
      data: [
        ROWS[1],
        { bar_id: 'x', tier: 'adored', rated_at: '2026-07-20T00:00:00.000Z' },
        { bar_id: 42, tier: 'loved', rated_at: '2026-07-20T00:00:00.000Z' },
        { tier: 'loved', rated_at: '2026-07-20T00:00:00.000Z' },
        null,
      ],
    });
    const list = await fetchPublicRatings(client, 'connor');

    expect(list).toHaveLength(1);
    expect(list?.[0].barId).toBe('death-and-co');
  });

  it('returns null when every row is malformed', async () => {
    const { client } = fakeSupabase({ data: [{ nope: true }] });

    expect(await fetchPublicRatings(client, 'connor')).toBeNull();
  });

  // Scores are owner-only. This path has the widest audience any rating data
  // in the product has ever had, so the invariant gets a test, not a comment.
  it('never surfaces a score even if the RPC returns one', async () => {
    const { client } = fakeSupabase({
      data: [{ ...ROWS[1], score: 9.4 }],
    });
    const list = await fetchPublicRatings(client, 'connor');

    expect(list?.[0]).toEqual({
      barId: 'death-and-co',
      rating: 'loved',
      ratedAt: '2026-07-01T00:00:00.000Z',
    });
    expect(Object.keys(list?.[0] ?? {})).not.toContain('score');
  });
});
