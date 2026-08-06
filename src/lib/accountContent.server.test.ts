// @vitest-environment jsdom
import { describe, expect, test, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  ACCOUNT_CONTENT_PAYLOAD_BUDGET_BYTES,
  fetchServerAccountContent,
  fetchServerAccountContentKey,
  upsertServerAccountContent,
} from '@/lib/accountContent.server';

const USER = '11111111-2222-3333-4444-555555555555';

type Row = { state_key: string; payload: unknown; client_updated_at: string };

/** Minimal thenable query builder capturing filter calls. */
function fakeClient(opts: {
  rows?: Row[];
  error?: { code?: string; message?: string } | null;
  status?: number;
  upsertError?: { code?: string; message?: string } | null;
}): { client: SupabaseClient; eqCalls: Array<[string, unknown]>; upserts: unknown[] } {
  const eqCalls: Array<[string, unknown]> = [];
  const upserts: unknown[] = [];
  const result = {
    data: opts.error ? null : (opts.rows ?? []),
    error: opts.error ?? null,
    status: opts.status ?? (opts.error ? 400 : 200),
  };
  const builder: Record<string, unknown> = {};
  const chain = (): Record<string, unknown> => builder;
  builder.select = vi.fn(chain);
  builder.eq = vi.fn((column: string, value: unknown) => {
    eqCalls.push([column, value]);
    return builder;
  });
  builder.maybeSingle = vi.fn(async () => ({
    ...result,
    data: (opts.rows ?? [])[0] ?? null,
  }));
  builder.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve(result).then(resolve);
  builder.upsert = vi.fn((row: unknown) => {
    upserts.push(row);
    return {
      then: (resolve: (v: unknown) => unknown) =>
        Promise.resolve({
          data: null,
          error: opts.upsertError ?? null,
          status: opts.upsertError ? 400 : 201,
        }).then(resolve),
    };
  });
  const client = { from: vi.fn(() => builder) } as unknown as SupabaseClient;
  return { client, eqCalls, upserts };
}

describe('user_id equality filters — defense in depth beside RLS', () => {
  test('fetchServerAccountContent filters by user_id explicitly', async () => {
    const { client, eqCalls } = fakeClient({ rows: [] });
    const result = await fetchServerAccountContent(client, USER);
    expect(result.kind).toBe('ok');
    expect(eqCalls).toContainEqual(['user_id', USER]);
  });

  test('fetchServerAccountContentKey filters by user_id AND key', async () => {
    const { client, eqCalls } = fakeClient({ rows: [] });
    const result = await fetchServerAccountContentKey(client, USER, 'lists');
    expect(result.kind).toBe('ok');
    expect(eqCalls).toContainEqual(['user_id', USER]);
    expect(eqCalls).toContainEqual(['state_key', 'lists']);
  });
});

describe('capability classification', () => {
  test.each([
    ['42P01', 'unavailable'],
    ['PGRST205', 'unavailable'],
  ])('missing-table code %s → unavailable', async (code, kind) => {
    const { client } = fakeClient({ error: { code, message: 'missing' } });
    expect((await fetchServerAccountContent(client, USER)).kind).toBe(kind);
  });

  test('clock-guard rejection (22023) → invalid-clock, surfaced and never retried', async () => {
    const { client } = fakeClient({
      error: { code: '22023', message: 'client_updated_at out of range' },
    });
    expect((await fetchServerAccountContent(client, USER)).kind).toBe(
      'invalid-clock',
    );
  });

  test('RLS rejection (42501) → auth-rejected, never silently retried as network', async () => {
    const { client } = fakeClient({
      error: { code: '42501', message: 'permission denied' },
      status: 403,
    });
    expect((await fetchServerAccountContent(client, USER)).kind).toBe(
      'auth-rejected',
    );
  });

  test('a plain network/unknown failure → failed (retryable)', async () => {
    const client = {
      from: vi.fn(() => {
        throw new TypeError('fetch failed');
      }),
    } as unknown as SupabaseClient;
    expect((await fetchServerAccountContent(client, USER)).kind).toBe('failed');
  });
});

describe('payload budget preflight', () => {
  test('a payload over 200,000 bytes is refused BEFORE any request', async () => {
    const { client, upserts } = fakeClient({});
    const big = 'x'.repeat(ACCOUNT_CONTENT_PAYLOAD_BUDGET_BYTES);
    const result = await upsertServerAccountContent(client, USER, 'lists', {
      data: [
        {
          id: 'big',
          name: big,
          barIds: [],
          createdAt: '2026-08-01T00:00:00.000Z',
          updatedAt: '2026-08-01T00:00:00.000Z',
        },
      ],
      clientUpdatedAt: '2026-08-01T00:00:00.000Z',
    });
    expect(result.kind).toBe('too-large');
    expect(upserts).toHaveLength(0);
  });

  test('a payload under budget goes through', async () => {
    const { client, upserts } = fakeClient({});
    const result = await upsertServerAccountContent(client, USER, 'lists', {
      data: [],
      clientUpdatedAt: '2026-08-01T00:00:00.000Z',
    });
    expect(result.kind).toBe('ok');
    expect(upserts).toHaveLength(1);
  });
});
