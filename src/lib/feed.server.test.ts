import { describe, expect, it, vi } from 'vitest';

import { FEED_COMMENT_READ_LIMIT, fetchFeedComments, fetchFeedPosts } from './feed.server';

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
    // AND THE TOKEN ACTUALLY ARRIVES. Asserting only that the RPC was called proves the
    // mechanism and not the OUTCOME: token delivery could regress to always-null — the exact
    // user-visible symptom of the original defect, "View night" rendering for nobody — with
    // every other assertion in this file still green. Round 3 found precisely that gap.
    const view = (result as { ok: true; value: { nightShareToken: string | null }[] }).value;
    expect(view[0].nightShareToken).toBe('tok-abc');
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
    // Null, not undefined and not a leaked token: the card renders no "View night".
    const view = (result as { ok: true; value: { nightShareToken: string | null }[] }).value;
    expect(view[0].nightShareToken).toBeNull();
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

/**
 * A PostgREST double for `feed_comments` that RECORDS the query it was asked to
 * run, so the ordering and the ceiling can be asserted rather than assumed.
 */
function commentClient(rows: Row[]) {
  const calls: { order?: [string, { ascending: boolean }]; limit?: number } = {};
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn(() => chain);
  chain.in = vi.fn(() => chain);
  chain.order = vi.fn((column: string, options: { ascending: boolean }) => {
    calls.order = [column, options];
    return chain;
  });
  chain.limit = vi.fn(async (n: number) => {
    calls.limit = n;
    return { data: rows, error: null };
  });
  return { client: { from: vi.fn(() => chain) } as never, calls };
}

const comment = (over: Row = {}): Row => ({
  id: 'c1',
  post_id: 'post-1',
  author_id: 'author-1',
  body: 'a reply',
  created_at: '2026-08-24T00:00:00Z',
  ...over,
});

describe('fetchFeedComments — the thread read is bounded, and honest about it', () => {
  it('reads newest-first under a ceiling, so truncation drops the OLDEST replies', async () => {
    // A Feed post never expires (V8-R-FEED-002), so its thread only grows and this
    // query re-runs after every confirmed write. Unbounded it costs more forever;
    // bounded the WRONG WAY — oldest-first with a limit — it drops the newest, and
    // a just-sent reply disappearing is the one truncation a reply surface must
    // never choose.
    const t = commentClient([comment()]);

    await fetchFeedComments(t.client, ['post-1']);

    expect(t.calls.order, 'the thread read is not ordered newest-first').toEqual([
      'created_at',
      { ascending: false },
    ]);
    expect(t.calls.limit, 'the thread read is unbounded').toBe(FEED_COMMENT_READ_LIMIT);
  });

  it('still hands each thread back oldest-first, whatever order the rows arrived in', async () => {
    const t = commentClient([
      comment({ id: 'newest', created_at: '2026-08-24T03:00:00Z' }),
      comment({ id: 'oldest', created_at: '2026-08-24T01:00:00Z' }),
    ]);

    const result = await fetchFeedComments(t.client, ['post-1']);

    expect(result.ok).toBe(true);
    const thread = (result as { ok: true; value: Map<string, { id: string }[]> }).value.get('post-1');
    expect(thread?.map((row) => row.id)).toEqual(['oldest', 'newest']);
  });

  it('a TRUNCATED batch names no post empty, because it did not see that far', async () => {
    // Round 3 (MEDIUM, both lanes): the ceiling is flat across the batch, so one
    // busy post can consume all of it. Seeding the quieter posts with [] turned
    // "we did not read this far" into the affirmative "No replies yet." — the
    // false ready state the third state exists to remove, reintroduced by the
    // bound that was meant to be the safe half. An unseen post must stay ABSENT.
    const full = Array.from({ length: FEED_COMMENT_READ_LIMIT }, (_, i) =>
      comment({ id: `busy-${i}`, post_id: 'post-1' }));
    const t = commentClient(full);

    const result = await fetchFeedComments(t.client, ['post-1', 'post-2']);

    expect(result.ok).toBe(true);
    const value = (result as { ok: true; value: Map<string, unknown[]> }).value;
    expect(
      value.has('post-2'),
      'a post the truncated batch never reached was reported as read and empty',
    ).toBe(false);
    expect(value.has('post-1')).toBe(true);
  });

  it('a successful read names every post it was asked about, replies or not', async () => {
    // The caller tells "not read yet" from "read, and empty" by whether the key is
    // there, so omitting the quiet posts would report them unread forever — and
    // FeedComments would tell their viewers the replies could not be loaded.
    const t = commentClient([comment({ post_id: 'post-1' })]);

    const result = await fetchFeedComments(t.client, ['post-1', 'post-2']);

    expect(result.ok).toBe(true);
    const value = (result as { ok: true; value: Map<string, unknown[]> }).value;
    expect(value.has('post-2'), 'a post with no replies was left out of a successful read').toBe(true);
    expect(value.get('post-2')).toEqual([]);
  });
});
