import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { PairwiseComparison } from '@/types/ratings';
import {
  deleteAllServerComparisons,
  fetchServerComparisons,
  insertServerComparison,
  mergeLocalComparisonsToServer,
} from '@/lib/pairwise.server';

/**
 * V8-2 continuity: the pairwise transcript is one of the two objects that
 * already has a server owner (`pairwise_comparisons`, migration 0002), so its
 * documented merge rule — union by the exact (winner, loser, comparedAt)
 * tuple, append-only, never latch on failure — has to be enforced by tests
 * and not only by the inventory document.
 *
 * Fake supabase builder, same idiom as ratings.server.test.ts, extended for
 * the `.select().order().order()` chain the transcript read uses.
 */
type SelectResult = { data: unknown; error: unknown };
type WriteResult = { error: unknown };

function fakeSupabase(opts: {
  selectData?: unknown;
  selectError?: unknown;
  insertError?: unknown;
  deleteError?: unknown;
}) {
  const calls = {
    from: [] as string[],
    select: [] as string[],
    order: [] as Array<{ column: string; options: unknown }>,
    insert: [] as unknown[],
    delete: 0,
    eq: [] as Array<{ column: string; value: unknown }>,
  };

  const selectResult: SelectResult = {
    data: opts.selectData,
    error: opts.selectError ?? null,
  };

  // .order() is chainable AND awaitable — the read awaits after the second.
  function orderable(): PromiseLike<SelectResult> & {
    order: (column: string, options: unknown) => ReturnType<typeof orderable>;
  } {
    return Object.assign(Promise.resolve(selectResult), {
      order(column: string, options: unknown) {
        calls.order.push({ column, options });
        return orderable();
      },
    });
  }

  const client = {
    from(table: string) {
      calls.from.push(table);
      return {
        select(columns: string) {
          calls.select.push(columns);
          return orderable();
        },
        insert(rows: unknown): Promise<WriteResult> {
          calls.insert.push(rows);
          return Promise.resolve({ error: opts.insertError ?? null });
        },
        delete() {
          calls.delete += 1;
          return {
            eq(column: string, value: unknown) {
              calls.eq.push({ column, value });
              return Promise.resolve<WriteResult>({
                error: opts.deleteError ?? null,
              });
            },
          };
        },
      };
    },
  } as unknown as SupabaseClient;

  return { client, calls };
}

const local = (
  winnerBarId: string,
  loserBarId: string,
  comparedAt: string,
): PairwiseComparison => ({ winnerBarId, loserBarId, comparedAt });

describe('fetchServerComparisons', () => {
  it('maps rows into the local transcript shape', async () => {
    const { client } = fakeSupabase({
      selectData: [
        {
          winner_bar_id: 'attaboy',
          loser_bar_id: 'death-and-co',
          compared_at: '2026-08-12T23:00:00.000Z',
        },
      ],
    });
    await expect(fetchServerComparisons(client)).resolves.toEqual([
      {
        winnerBarId: 'attaboy',
        loserBarId: 'death-and-co',
        comparedAt: '2026-08-12T23:00:00.000Z',
      },
    ]);
  });

  it('reads in replay order — compared_at, then id as a stable tiebreak', async () => {
    const { client, calls } = fakeSupabase({ selectData: [] });
    await fetchServerComparisons(client);
    expect(calls.from).toEqual(['pairwise_comparisons']);
    expect(calls.order.map((o) => o.column)).toEqual(['compared_at', 'id']);
    expect(calls.order.every((o) => o.options)).toBe(true);
  });

  it('returns null on error so a failed read is not mistaken for an empty transcript', async () => {
    const { client } = fakeSupabase({ selectError: { message: 'rls' } });
    await expect(fetchServerComparisons(client)).resolves.toBeNull();
  });

  it('returns null when data is null with no error', async () => {
    const { client } = fakeSupabase({ selectData: null });
    await expect(fetchServerComparisons(client)).resolves.toBeNull();
  });
});

describe('insertServerComparison', () => {
  it('writes the canonical column shape including the session tag', async () => {
    const { client, calls } = fakeSupabase({});
    await insertServerComparison(
      client,
      'user-a',
      local('attaboy', 'death-and-co', '2026-08-12T23:00:00.000Z'),
      'session-1',
    );
    expect(calls.insert[0]).toEqual({
      user_id: 'user-a',
      winner_bar_id: 'attaboy',
      loser_bar_id: 'death-and-co',
      compared_at: '2026-08-12T23:00:00.000Z',
      session_id: 'session-1',
    });
  });
});

describe('mergeLocalComparisonsToServer', () => {
  const A = local('attaboy', 'death-and-co', '2026-08-12T23:00:00.000Z');
  const B = local('bar-54', 'attaboy', '2026-08-12T23:30:00.000Z');

  it('returns 0 without a round trip when there is nothing local', async () => {
    const { client, calls } = fakeSupabase({});
    await expect(
      mergeLocalComparisonsToServer(client, 'user-a', [], null),
    ).resolves.toBe(0);
    expect(calls.from).toEqual([]);
  });

  it('unions: inserts only tuples the server transcript does not already hold', async () => {
    const { client, calls } = fakeSupabase({
      selectData: [
        {
          winner_bar_id: A.winnerBarId,
          loser_bar_id: A.loserBarId,
          compared_at: A.comparedAt,
        },
      ],
    });
    await expect(
      mergeLocalComparisonsToServer(client, 'user-a', [A, B], 'session-1'),
    ).resolves.toBe(1);
    expect(calls.insert[0]).toEqual([
      {
        user_id: 'user-a',
        winner_bar_id: 'bar-54',
        loser_bar_id: 'attaboy',
        compared_at: '2026-08-12T23:30:00.000Z',
        session_id: 'session-1',
      },
    ]);
  });

  it('is idempotent — a second merge against a synced server inserts nothing', async () => {
    const { client, calls } = fakeSupabase({
      selectData: [A, B].map((c) => ({
        winner_bar_id: c.winnerBarId,
        loser_bar_id: c.loserBarId,
        compared_at: c.comparedAt,
      })),
    });
    await expect(
      mergeLocalComparisonsToServer(client, 'user-a', [A, B], null),
    ).resolves.toBe(0);
    expect(calls.insert).toEqual([]);
  });

  it('keeps a genuine re-answer: same pair, later timestamp is a distinct tuple', async () => {
    // Append-only transcript — redoing a judgment must survive the merge, or
    // replay silently reverts to the older answer.
    const reAnswer = local('death-and-co', 'attaboy', '2026-08-13T01:00:00.000Z');
    const { client, calls } = fakeSupabase({
      selectData: [
        {
          winner_bar_id: A.winnerBarId,
          loser_bar_id: A.loserBarId,
          compared_at: A.comparedAt,
        },
      ],
    });
    await expect(
      mergeLocalComparisonsToServer(client, 'user-a', [A, reAnswer], null),
    ).resolves.toBe(1);
    expect(calls.insert[0]).toEqual([
      {
        user_id: 'user-a',
        winner_bar_id: 'death-and-co',
        loser_bar_id: 'attaboy',
        compared_at: '2026-08-13T01:00:00.000Z',
        session_id: null,
      },
    ]);
  });

  it('preserves the local comparedAt rather than stamping merge time', async () => {
    const { client, calls } = fakeSupabase({ selectData: [] });
    await mergeLocalComparisonsToServer(client, 'user-a', [A], null);
    expect((calls.insert[0] as Array<{ compared_at: string }>)[0].compared_at).toBe(
      A.comparedAt,
    );
  });

  it('returns null when the pre-merge read fails — the caller must not latch merged-for', async () => {
    const { client, calls } = fakeSupabase({ selectError: { message: 'offline' } });
    await expect(
      mergeLocalComparisonsToServer(client, 'user-a', [A], null),
    ).resolves.toBeNull();
    expect(calls.insert).toEqual([]);
  });

  it('returns null when the insert fails — a partial merge must retry next sign-in', async () => {
    const { client } = fakeSupabase({
      selectData: [],
      insertError: { message: 'conflict' },
    });
    await expect(
      mergeLocalComparisonsToServer(client, 'user-a', [A], null),
    ).resolves.toBeNull();
  });
});

describe('deleteAllServerComparisons', () => {
  it('scopes the delete to the user and reports success', async () => {
    const { client, calls } = fakeSupabase({});
    await expect(deleteAllServerComparisons(client, 'user-a')).resolves.toBe(true);
    expect(calls.eq).toEqual([{ column: 'user_id', value: 'user-a' }]);
  });

  it('resolves false on error instead of throwing', async () => {
    const { client } = fakeSupabase({ deleteError: { message: 'nope' } });
    await expect(deleteAllServerComparisons(client, 'user-a')).resolves.toBe(false);
  });
});
