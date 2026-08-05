import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

vi.mock('@/lib/accountContent.server', () => ({
  fetchServerAccountContent: vi.fn(),
  fetchServerAccountContentKey: vi.fn(),
  upsertServerAccountContent: vi.fn(),
}));

import {
  fetchServerAccountContent,
  fetchServerAccountContentKey,
  upsertServerAccountContent,
} from '@/lib/accountContent.server';
import {
  readAccountContentOwner,
  readLocalAccountContent,
  stampLocalAccountContent,
  storageKeyForAccountContent,
  writeLocalAccountContent,
  type LocalAccountContent,
} from '@/lib/accountContent.local';
import { syncAccountContent, syncAccountContentKey } from '@/lib/accountContentSync';

const fetchAll = vi.mocked(fetchServerAccountContent);
const fetchKey = vi.mocked(fetchServerAccountContentKey);
const upsert = vi.mocked(upsertServerAccountContent);
const client = {} as SupabaseClient;
const T1 = '2026-08-01T20:00:00.000Z';
const T2 = '2026-08-02T20:00:00.000Z';
const T3 = '2026-08-03T20:00:00.000Z';

function lists(at: string, barIds: string[]): LocalAccountContent {
  return {
    clientUpdatedAt: at,
    data: [{ id: 'want-to-go', name: 'Want to go', barIds, createdAt: T1, updatedAt: at }],
  };
}

function seedLocal(value: LocalAccountContent): void {
  if (value.data !== null) {
    window.localStorage.setItem(storageKeyForAccountContent('lists'), JSON.stringify(value.data));
  }
  stampLocalAccountContent('lists', value.clientUpdatedAt);
}

beforeEach(() => {
  window.localStorage.clear();
  vi.clearAllMocks();
  fetchAll.mockResolvedValue(new Map());
  fetchKey.mockResolvedValue('absent');
  upsert.mockResolvedValue(true);
});

describe('account content reconciliation', () => {
  it('uploads first-sign-in anonymous content and latches its owner', async () => {
    seedLocal(lists(T1, ['attaboy']));
    fetchKey.mockResolvedValue(lists(T1, ['attaboy']));
    const report = await syncAccountContent({
      supabase: client,
      userId: 'user-a',
      stillCurrent: () => true,
    });
    expect(report.lists).toBe('uploaded');
    expect(upsert).toHaveBeenCalledWith(client, 'user-a', 'lists', lists(T1, ['attaboy']));
    expect(readAccountContentOwner()).toBe('user-a');
  });

  it('hydrates a second device without uploading empty local state', async () => {
    fetchAll.mockResolvedValue(new Map([['lists', lists(T2, ['attaboy', 'sisters'])]]));
    const report = await syncAccountContent({
      supabase: client,
      userId: 'user-a',
      stillCurrent: () => true,
    });
    expect(report.lists).toBe('hydrated');
    expect(readLocalAccountContent('lists')).toEqual({ status: 'present', value: lists(T2, ['attaboy', 'sisters']) });
    expect(upsert).not.toHaveBeenCalled();
  });

  it('uses last-write-wins in both directions and lets server win a divergent tie', async () => {
    seedLocal(lists(T2, ['local']));
    fetchAll.mockResolvedValue(new Map([['lists', lists(T1, ['server-old'])]]));
    fetchKey.mockResolvedValue(lists(T2, ['local']));
    expect((await syncAccountContent({ supabase: client, userId: 'u', stillCurrent: () => true })).lists).toBe('uploaded');

    window.localStorage.clear();
    seedLocal(lists(T1, ['local-old']));
    fetchAll.mockResolvedValue(new Map([['lists', lists(T2, ['server-new'])]]));
    expect((await syncAccountContent({ supabase: client, userId: 'u', stillCurrent: () => true })).lists).toBe('hydrated');
    expect(readLocalAccountContent('lists')).toEqual({ status: 'present', value: lists(T2, ['server-new']) });

    writeLocalAccountContent('lists', lists(T2, ['losing-tie']));
    fetchAll.mockResolvedValue(new Map([['lists', lists(T2, ['server-tie'])]]));
    expect((await syncAccountContent({ supabase: client, userId: 'u', stillCurrent: () => true })).lists).toBe('hydrated');
    expect(readLocalAccountContent('lists')).toEqual({ status: 'present', value: lists(T2, ['server-tie']) });
  });

  it('propagates a newer local deletion as an explicit tombstone', async () => {
    seedLocal(lists(T1, ['attaboy']));
    window.localStorage.removeItem(storageKeyForAccountContent('lists'));
    stampLocalAccountContent('lists', T3);
    fetchKey.mockResolvedValue(lists(T1, ['server-old']));
    const outcome = await syncAccountContentKey({
      supabase: client,
      userId: 'user-a',
      key: 'lists',
      stillCurrent: () => true,
    });
    expect(outcome).toBe('uploaded');
    expect(upsert).toHaveBeenCalledWith(client, 'user-a', 'lists', {
      data: null,
      clientUpdatedAt: T3,
    });
  });

  it('never clobbers a local edit made while an upload is in flight', async () => {
    seedLocal(lists(T2, ['captured']));
    fetchKey
      .mockResolvedValueOnce(lists(T1, ['server-old']))
      .mockResolvedValueOnce(lists(T2, ['captured']));
    upsert.mockImplementation(async () => {
      writeLocalAccountContent('lists', lists(T3, ['mid-flight']));
      return true;
    });
    expect(
      await syncAccountContentKey({
        supabase: client,
        userId: 'u',
        key: 'lists',
        stillCurrent: () => true,
      }),
    ).toBe('uploaded');
    expect(readLocalAccountContent('lists')).toEqual({ status: 'present', value: lists(T3, ['mid-flight']) });
  });

  it('fails closed on fetch failure and abandons in-flight work after an epoch change', async () => {
    seedLocal(lists(T1, ['keep']));
    fetchAll.mockResolvedValue(null);
    const failed = await syncAccountContent({ supabase: client, userId: 'u', stillCurrent: () => true });
    expect(new Set(Object.values(failed))).toEqual(new Set(['fetch-failed']));
    expect(readAccountContentOwner()).toBeNull();
    expect(upsert).not.toHaveBeenCalled();

    fetchAll.mockResolvedValue(new Map());
    const aborted = await syncAccountContent({ supabase: client, userId: 'u', stillCurrent: () => false });
    expect(new Set(Object.values(aborted))).toEqual(new Set(['aborted']));
    expect(upsert).not.toHaveBeenCalled();
  });
});
