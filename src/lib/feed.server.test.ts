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
 * THE FIXTURE MUST CONTAIN A POST WITH A night_out_id. A first version of this suite used an
 * empty posts fixture throughout — `fetchFeedPosts` returns early on zero rows, so
 * `fetchNightTokens` never ran and the OLD table-reading code passed every assertion unchanged.
 * A regression test that the regression passes is worse than no test: it is a false green with a
 * green tick next to it. Every case below drives at least one post that names a night.
 */

type Row = Record<string, unknown>;

const NIGHT = '11111111-1111-1111-1111-111111111111';
const post = (over: Row = {}): Row => ({
  id: 'post-1',
  author_id: 'author-1',
  media_id: 'media-1',
  bar_id: null,
  caption: null,
  night_out_id: NIGHT,
  audience: 'friends',
  audience_group_id: null,
  created_at: '2026-08-24T00:00:00Z',
  ...over,
});

/**
 * A PostgREST double whose `night_outs` TABLE read throws. A permissive double would let the
 * original defect pass here while failing against a real database — the exact failure mode this
 * suite exists to prevent.
 */
type RpcResult = { data: unknown; error: unknown };
type RpcMock = ReturnType<typeof vi.fn<(name: string, args?: Row) => Promise<RpcResult>>>;

function feedClient(posts: Row[], rpc?: RpcMock) {
  const rpcFn: RpcMock = rpc ?? vi.fn(async () => ({ data: [] as unknown, error: null }));
  const builder = (rows: Row[]) => {
    const chain: Record<string, unknown> = {};
    for (const key of ['select', 'eq', 'in', 'order', 'is', 'not']) chain[key] = vi.fn(() => chain);
    chain.limit = vi.fn(async () => ({ data: rows, error: null }));
    return chain;
  };
  const from = vi.fn((table: string) => {
    if (table === 'night_outs') {
      throw new Error('night_outs must not be read as a table: share_token is revoked from authenticated');
    }
    return builder(table === 'feed_posts' ? posts : []);
  });
  return {
    client: { from, rpc: rpcFn, storage: { from: () => ({ createSignedUrl: async () => ({ data: null, error: null }) }) } } as never,
    from,
    rpc: rpcFn,
  };
}

describe('fetchFeedPosts — the night-token read', () => {
  it('resolves a night token through the scoped RPC, never the table', async () => {
    const rpc = vi.fn(async () => ({ data: [{ id: NIGHT, share_token: 'tok-abc' }], error: null }));
    const t = feedClient([post()], rpc);

    const result = await fetchFeedPosts(t.client, 10);

    expect(result.ok).toBe(true);
    // The table read is what 0047 denies; the RPC is the entitlement-scoped path.
    expect(t.from).not.toHaveBeenCalledWith('night_outs');
    expect(t.rpc).toHaveBeenCalledWith('get_night_out', { p_night_out: NIGHT });
  });

  it('asks once per DISTINCT night, not once per post', async () => {
    const rpc = vi.fn(async () => ({ data: [{ id: NIGHT, share_token: 'tok-abc' }], error: null }));
    const t = feedClient([post({ id: 'a' }), post({ id: 'b' }), post({ id: 'c' })], rpc);

    await fetchFeedPosts(t.client, 10);

    const nightCalls = (t.rpc.mock.calls as unknown[][]).filter((c) => c[0] === 'get_night_out');
    expect(nightCalls).toHaveLength(1);
  });

  it('a night the viewer may not open yields no token, and does not throw', async () => {
    // `get_night_out` returns nothing to a non-member. The card then renders no "View night" —
    // the outcome the original comment described and never achieved.
    const rpc = vi.fn(async () => ({ data: [], error: null }));
    const t = feedClient([post()], rpc);

    const result = await fetchFeedPosts(t.client, 10);

    expect(result.ok).toBe(true);
    expect(t.from).not.toHaveBeenCalledWith('night_outs');
  });

  it('posts with no night ask for no token at all', async () => {
    const rpc = vi.fn(async () => ({ data: [], error: null }));
    const t = feedClient([post({ night_out_id: null })], rpc);

    await fetchFeedPosts(t.client, 10);

    expect((t.rpc.mock.calls as unknown[][]).filter((c) => c[0] === 'get_night_out')).toHaveLength(0);
  });

  it('returns unavailable rather than throwing when there is no client', async () => {
    await expect(fetchFeedPosts(null, 10)).resolves.toMatchObject({ ok: false });
  });
});
