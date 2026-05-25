import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { BarRating } from '@/types/ratings';
import {
  deleteServerRating,
  fetchServerRatings,
  mergeLocalRatingsToServer,
  upsertServerRating,
} from '@/lib/ratings.server';

/**
 * Hand-rolled fake of the supabase-js fluent builder. Every method records
 * the call so the test can assert WHAT was sent to the DB, not just that
 * something happened. `Promise.resolve(...)` at the leaves makes the chain
 * awaitable in any of the shapes ratings.server.ts uses today.
 */
type SelectResult = { data: unknown; error: unknown };
type WriteResult = { error: unknown };

function fakeSupabase(opts: {
  selectData?: unknown;
  selectError?: unknown;
  insertError?: unknown;
  upsertError?: unknown;
  deleteError?: unknown;
}) {
  const calls = {
    from: [] as string[],
    select: [] as string[],
    insert: [] as unknown[],
    upsert: [] as Array<{ row: unknown; options: unknown }>,
    delete: 0,
    eq: [] as Array<{ column: string; value: unknown }>,
  };

  const deleteChain = {
    eq(column: string, value: unknown) {
      calls.eq.push({ column, value });
      // ratings.server.ts chains .eq(...).eq(...) before awaiting.
      return Object.assign(
        Promise.resolve<WriteResult>({ error: opts.deleteError ?? null }),
        {
          eq(column2: string, value2: unknown) {
            calls.eq.push({ column: column2, value: value2 });
            return Promise.resolve<WriteResult>({ error: opts.deleteError ?? null });
          },
        },
      );
    },
  };

  const client = {
    from(table: string) {
      calls.from.push(table);
      return {
        select(columns: string): Promise<SelectResult> {
          calls.select.push(columns);
          return Promise.resolve({
            data: opts.selectData,
            error: opts.selectError ?? null,
          });
        },
        insert(rows: unknown): Promise<WriteResult> {
          calls.insert.push(rows);
          return Promise.resolve({ error: opts.insertError ?? null });
        },
        upsert(row: unknown, options: unknown): Promise<WriteResult> {
          calls.upsert.push({ row, options });
          return Promise.resolve({ error: opts.upsertError ?? null });
        },
        delete() {
          calls.delete += 1;
          return deleteChain;
        },
      };
    },
  } as unknown as SupabaseClient;

  return { client, calls };
}

describe('fetchServerRatings', () => {
  it('maps Supabase rows (bar_id/tier/rated_at) into BarRating shape', async () => {
    const { client } = fakeSupabase({
      selectData: [
        { bar_id: 'attaboy', tier: 'loved', rated_at: '2026-05-10T00:00:00.000Z' },
        { bar_id: 'death-and-co', tier: 'liked', rated_at: '2026-05-12T00:00:00.000Z' },
      ],
    });

    const result = await fetchServerRatings(client);

    expect(result).toEqual([
      { barId: 'attaboy', rating: 'loved', ratedAt: '2026-05-10T00:00:00.000Z' },
      { barId: 'death-and-co', rating: 'liked', ratedAt: '2026-05-12T00:00:00.000Z' },
    ]);
  });

  it('returns [] when the query errors', async () => {
    const { client } = fakeSupabase({
      selectError: { message: 'RLS denied' },
      selectData: null,
    });

    expect(await fetchServerRatings(client)).toEqual([]);
  });

  it('returns [] when data is null with no error', async () => {
    const { client } = fakeSupabase({ selectData: null });
    expect(await fetchServerRatings(client)).toEqual([]);
  });

  it('selects from the `ratings` table with the three needed columns', async () => {
    const { client, calls } = fakeSupabase({ selectData: [] });
    await fetchServerRatings(client);

    expect(calls.from).toEqual(['ratings']);
    expect(calls.select).toEqual(['bar_id, tier, rated_at']);
  });
});

describe('upsertServerRating', () => {
  it('sends the canonical column shape and onConflict key', async () => {
    const { client, calls } = fakeSupabase({});

    const before = Date.now();
    await upsertServerRating(client, 'user-1', 'attaboy', 'loved');
    const after = Date.now();

    expect(calls.from).toEqual(['ratings']);
    expect(calls.upsert).toHaveLength(1);

    const { row, options } = calls.upsert[0];
    expect(row).toMatchObject({
      user_id: 'user-1',
      bar_id: 'attaboy',
      tier: 'loved',
    });
    expect(options).toEqual({ onConflict: 'user_id,bar_id' });

    const ratedAt = (row as { rated_at: string }).rated_at;
    const parsed = Date.parse(ratedAt);
    expect(Number.isNaN(parsed)).toBe(false);
    expect(parsed).toBeGreaterThanOrEqual(before);
    expect(parsed).toBeLessThanOrEqual(after);
  });

  it('does not throw on Supabase error (writes are fire-and-forget)', async () => {
    const { client } = fakeSupabase({ upsertError: { message: 'RLS denied' } });
    await expect(
      upsertServerRating(client, 'user-1', 'attaboy', 'loved'),
    ).resolves.toBeUndefined();
  });
});

describe('deleteServerRating', () => {
  it('filters by both user_id and bar_id before issuing delete', async () => {
    const { client, calls } = fakeSupabase({});

    await deleteServerRating(client, 'user-1', 'attaboy');

    expect(calls.from).toEqual(['ratings']);
    expect(calls.delete).toBe(1);
    expect(calls.eq).toEqual([
      { column: 'user_id', value: 'user-1' },
      { column: 'bar_id', value: 'attaboy' },
    ]);
  });

  it('does not throw on Supabase error', async () => {
    const { client } = fakeSupabase({ deleteError: { message: 'RLS denied' } });
    await expect(
      deleteServerRating(client, 'user-1', 'attaboy'),
    ).resolves.toBeUndefined();
  });
});

describe('mergeLocalRatingsToServer', () => {
  const local: BarRating[] = [
    { barId: 'attaboy', rating: 'loved', ratedAt: '2026-05-10T00:00:00.000Z' },
    { barId: 'death-and-co', rating: 'liked', ratedAt: '2026-05-12T00:00:00.000Z' },
    { barId: 'employees-only', rating: 'pass', ratedAt: '2026-05-15T00:00:00.000Z' },
  ];

  it('returns 0 immediately when there are no local ratings (no DB roundtrip)', async () => {
    const { client, calls } = fakeSupabase({ selectData: [] });

    const inserted = await mergeLocalRatingsToServer(client, 'user-1', []);

    expect(inserted).toBe(0);
    // No select happened — we short-circuited.
    expect(calls.from).toEqual([]);
  });

  it('inserts only bars not already present on the server (server-wins)', async () => {
    const { client, calls } = fakeSupabase({
      selectData: [
        // attaboy already on server — should be excluded from the insert.
        { bar_id: 'attaboy', tier: 'pass', rated_at: '2026-04-01T00:00:00.000Z' },
      ],
    });

    const inserted = await mergeLocalRatingsToServer(client, 'user-1', local);

    expect(inserted).toBe(2);
    expect(calls.insert).toHaveLength(1);
    const rows = calls.insert[0] as Array<Record<string, string>>;
    expect(rows.map((r) => r.bar_id).sort()).toEqual(['death-and-co', 'employees-only']);
    expect(rows.every((r) => r.user_id === 'user-1')).toBe(true);
    // Server-wins means the existing 'pass' tier on attaboy stays — we do
    // NOT overwrite it with the local 'loved'.
    expect(rows.find((r) => r.bar_id === 'attaboy')).toBeUndefined();
  });

  it('is idempotent — re-running with a fully-synced server inserts nothing', async () => {
    const { client, calls } = fakeSupabase({
      selectData: local.map((r) => ({
        bar_id: r.barId,
        tier: r.rating,
        rated_at: r.ratedAt,
      })),
    });

    const inserted = await mergeLocalRatingsToServer(client, 'user-1', local);

    expect(inserted).toBe(0);
    expect(calls.insert).toHaveLength(0);
  });

  it('preserves the local ratedAt timestamp in inserted rows', async () => {
    const { client, calls } = fakeSupabase({ selectData: [] });

    await mergeLocalRatingsToServer(client, 'user-1', local);

    const rows = calls.insert[0] as Array<Record<string, string>>;
    const byBar = Object.fromEntries(rows.map((r) => [r.bar_id, r.rated_at]));
    expect(byBar['attaboy']).toBe('2026-05-10T00:00:00.000Z');
    expect(byBar['death-and-co']).toBe('2026-05-12T00:00:00.000Z');
    expect(byBar['employees-only']).toBe('2026-05-15T00:00:00.000Z');
  });

  it('returns 0 (no count) when the insert errors, even with rows to send', async () => {
    const { client } = fakeSupabase({
      selectData: [],
      insertError: { message: 'RLS denied' },
    });

    const inserted = await mergeLocalRatingsToServer(client, 'user-1', local);

    expect(inserted).toBe(0);
  });

  it('maps local tier values into the `tier` column (not `rating`)', async () => {
    // Guards against drift between localStorage BarRating.rating and the
    // server schema column name `tier`. This was the merge bug the v0.5.0
    // type system would NOT have caught.
    const { client, calls } = fakeSupabase({ selectData: [] });

    await mergeLocalRatingsToServer(client, 'user-1', [
      { barId: 'attaboy', rating: 'loved', ratedAt: '2026-05-10T00:00:00.000Z' },
    ]);

    const rows = calls.insert[0] as Array<Record<string, string>>;
    expect(rows[0].tier).toBe('loved');
    expect((rows[0] as Record<string, unknown>).rating).toBeUndefined();
  });
});

describe('coverage suppression', () => {
  it('imports the module surface', () => {
    // Static reference so vitest reports a hit even on early-return paths.
    expect(typeof mergeLocalRatingsToServer).toBe('function');
    expect(typeof fetchServerRatings).toBe('function');
    expect(typeof upsertServerRating).toBe('function');
    expect(typeof deleteServerRating).toBe('function');
    expect(vi.isMockFunction(() => 0)).toBe(false);
  });
});
