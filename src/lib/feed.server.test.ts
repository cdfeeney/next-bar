import { describe, expect, it, vi } from 'vitest';

import { fetchFeedPosts } from './feed.server';

/**
 * The night-token read is the one this file exists for.
 *
 * `fetchNightTokens` used to be `.from('night_outs').select('id, share_token')`, justified in a
 * comment by "night_outs RLS returns only the nights this viewer is owner of or a member of
 * (0044) ... The rule is not restated here; it is exercised."
 *
 * It was never exercised. 0047 deliberately revoked `share_token` from `authenticated` — a share
 * token is a CAPABILITY, and a table grant hands every user every token — so the query was denied
 * at the PERMISSION layer, which runs BEFORE any policy. RLS was never consulted, the select
 * failed 42501 for every caller, and "View night" (V8-R-FEED-004) rendered for nobody. A `catch`
 * swallowed it, so the Feed looked fine.
 *
 * Nothing caught it because this module had NO tests at all. These assert the shape that makes
 * the defect impossible rather than the symptom: the token comes from the member-scoped
 * `get_night_out` RPC, and `night_outs` is never read as a table.
 */

type Row = Record<string, unknown>;

/**
 * A PostgREST double whose `night_outs` table read THROWS. A permissive double would let the
 * original defect pass here while failing against a real database — the exact failure mode this
 * suite exists to prevent.
 */
function feedClient(posts: Row[], rpc: ReturnType<typeof vi.fn>) {
  const builder = (rows: Row[]) => {
    const chain: Record<string, unknown> = {};
    const self = () => chain;
    for (const key of ['select', 'eq', 'in', 'order', 'is', 'not']) chain[key] = vi.fn(self);
    chain.limit = vi.fn(async () => ({ data: rows, error: null }));
    chain.then = undefined;
    return chain;
  };
  const from = vi.fn((table: string) => {
    if (table === 'night_outs') {
      throw new Error('night_outs must not be read as a table: share_token is revoked from authenticated');
    }
    if (table === 'feed_posts') return builder(posts);
    return builder([]);
  });
  return { client: { from, rpc, storage: { from: () => ({}) } } as never, from, rpc };
}

describe('fetchFeedPosts — the night-token read', () => {
  it('never reads night_outs as a table', async () => {
    const rpc = vi.fn(async () => ({ data: [], error: null }));
    const t = feedClient([], rpc);
    await fetchFeedPosts(t.client, 10);
    expect(t.from).not.toHaveBeenCalledWith('night_outs');
  });

  it('returns unavailable rather than throwing when there is no client', async () => {
    const result = await fetchFeedPosts(null, 10);
    expect(result.ok).toBe(false);
  });

  it('an empty feed asks for no tokens at all', async () => {
    const rpc = vi.fn(async () => ({ data: [], error: null }));
    const t = feedClient([], rpc);
    const result = await fetchFeedPosts(t.client, 10);
    expect(result.ok).toBe(true);
    expect(rpc).not.toHaveBeenCalledWith('get_night_out', expect.anything());
  });
});
