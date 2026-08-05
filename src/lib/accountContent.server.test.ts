import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  fetchServerAccountContent,
  fetchServerAccountContentKey,
  upsertServerAccountContent,
} from '@/lib/accountContent.server';

const T1 = '2026-08-01T20:00:00.000Z';
const list = {
  id: 'want-to-go',
  name: 'Want to go',
  barIds: ['attaboy'],
  createdAt: T1,
  updatedAt: T1,
};

function row(overrides: Record<string, unknown> = {}) {
  return {
    state_key: 'lists',
    payload: { data: [list] },
    client_updated_at: T1,
    ...overrides,
  };
}

function readClient(options: {
  all?: { data: unknown; error: unknown };
  one?: { data: unknown; error: unknown };
  throws?: boolean;
}) {
  const query: Record<string, unknown> = {};
  const maybeSingle = vi.fn(async () => {
    if (options.throws) throw new Error('offline');
    return options.one ?? { data: null, error: null };
  });
  const eq = vi.fn(() => query);
  Object.assign(query, {
    eq,
    maybeSingle,
    then: (
      resolve: (value: { data: unknown; error: unknown }) => unknown,
      reject: (reason: unknown) => unknown,
    ) => {
      if (options.throws) return Promise.reject(new Error('offline')).then(resolve, reject);
      return Promise.resolve(options.all ?? { data: [], error: null }).then(resolve, reject);
    },
  });
  const select = vi.fn(() => query);
  const client = { from: vi.fn(() => ({ select })) } as unknown as SupabaseClient;
  return { client, eq, maybeSingle };
}

describe('accountContent.server reads', () => {
  it('parses an owner-scoped collection and preserves explicit tombstones', async () => {
    const { client } = readClient({
      all: {
        data: [row(), row({ state_key: 'night_log', payload: { data: null } })],
        error: null,
      },
    });
    const result = await fetchServerAccountContent(client);
    expect(result?.get('lists')?.data).toEqual([list]);
    expect(result?.get('night_log')).toEqual({ data: null, clientUpdatedAt: T1 });
  });

  it.each([
    [row({ state_key: 'unknown' })],
    [row({ payload: [] })],
    [row({ payload: { data: { wrong: true } } })],
    [row(), row()],
  ])('fails the entire fetch closed for malformed or duplicate rows', async (...rows) => {
    const { client } = readClient({ all: { data: rows, error: null } });
    expect(await fetchServerAccountContent(client)).toBeNull();
  });

  it('treats transport errors and thrown SDK promises as failure, never empty', async () => {
    const errored = readClient({ all: { data: null, error: { message: 'offline' } } });
    expect(await fetchServerAccountContent(errored.client)).toBeNull();
    expect(await fetchServerAccountContent(readClient({ throws: true }).client)).toBeNull();
  });

  it('filters a single-key read and distinguishes absent from failure', async () => {
    const good = readClient({ one: { data: row(), error: null } });
    expect(await fetchServerAccountContentKey(good.client, 'lists')).toEqual({
      data: [list],
      clientUpdatedAt: T1,
    });
    expect(good.eq).toHaveBeenCalledWith('state_key', 'lists');

    const absent = readClient({ one: { data: null, error: null } });
    expect(await fetchServerAccountContentKey(absent.client, 'lists')).toBe('absent');
    expect(await fetchServerAccountContentKey(readClient({ throws: true }).client, 'lists')).toBeNull();
  });
});

describe('accountContent.server writes', () => {
  it('upserts the exact owner, domain, payload wrapper, and client clock', async () => {
    const upsert = vi.fn(async () => ({ error: null }));
    const client = { from: vi.fn(() => ({ upsert })) } as unknown as SupabaseClient;
    expect(
      await upsertServerAccountContent(client, 'user-a', 'lists', {
        data: [list],
        clientUpdatedAt: T1,
      }),
    ).toBe(true);
    expect(upsert).toHaveBeenCalledWith(
      {
        user_id: 'user-a',
        state_key: 'lists',
        payload: { data: [list] },
        client_updated_at: T1,
      },
      { onConflict: 'user_id,state_key' },
    );
  });

  it('returns false for an error result or thrown SDK promise', async () => {
    const errorClient = {
      from: vi.fn(() => ({ upsert: vi.fn(async () => ({ error: { message: 'denied' } })) })),
    } as unknown as SupabaseClient;
    const throwClient = {
      from: vi.fn(() => ({ upsert: vi.fn(async () => { throw new Error('offline'); }) })),
    } as unknown as SupabaseClient;
    const value = { data: [list], clientUpdatedAt: T1 };
    expect(await upsertServerAccountContent(errorClient, 'u', 'lists', value)).toBe(false);
    expect(await upsertServerAccountContent(throwClient, 'u', 'lists', value)).toBe(false);
  });
});
