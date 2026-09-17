import { describe, expect, test } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import { fetchSavedNightBars } from './server';

/** A client whose only RPC answers with the given envelope. */
function clientAnswering(envelope: { data?: unknown; error?: unknown }): SupabaseClient {
  return { rpc: async () => envelope } as unknown as SupabaseClient;
}

describe('fetchSavedNightBars — "could not read" is not "no stops" (R-05a)', () => {
  test('a pre-0083 / empty answer is an empty list', async () => {
    await expect(fetchSavedNightBars(clientAnswering({ data: [] }), 'sn-1')).resolves.toEqual([]);
  });

  test('an RPC error is null, never an empty list', async () => {
    await expect(
      fetchSavedNightBars(clientAnswering({ data: null, error: { message: 'boom' } }), 'sn-1'),
    ).resolves.toBeNull();
  });

  test('a non-array answer is null', async () => {
    await expect(fetchSavedNightBars(clientAnswering({ data: { odd: true } }), 'sn-1')).resolves.toBeNull();
  });

  test('a thrown transport error is null', async () => {
    const client = { rpc: async () => { throw new Error('offline'); } } as unknown as SupabaseClient;
    await expect(fetchSavedNightBars(client, 'sn-1')).resolves.toBeNull();
  });

  test('rows come back ordered by sort_order with ratings narrowed to the three tiers', async () => {
    const client = clientAnswering({
      data: [
        { bar_id: 'b', sort_order: 2, rating: 'pass' },
        { bar_id: 'a', sort_order: 1, rating: 'loved' },
        { bar_id: 'c', sort_order: 3, rating: 'meh' },
      ],
    });
    await expect(fetchSavedNightBars(client, 'sn-1')).resolves.toEqual([
      { barId: 'a', sortOrder: 1, rating: 'loved' },
      { barId: 'b', sortOrder: 2, rating: 'pass' },
      { barId: 'c', sortOrder: 3, rating: null },
    ]);
  });
});
