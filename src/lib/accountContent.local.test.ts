import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ACCOUNT_CONTENT_META_KEY,
  ACCOUNT_CONTENT_OWNER_KEY,
  accountContentKeyForStorageKey,
  readAccountContentOwner,
  readLocalAccountContent,
  sameAccountContentData,
  stampLocalAccountContent,
  storageKeyForAccountContent,
  writeAccountContentOwner,
  writeLocalAccountContent,
} from '@/lib/accountContent.local';

const T1 = '2026-08-01T20:00:00.000Z';
const T2 = '2026-08-02T20:00:00.000Z';
const list = {
  id: 'want-to-go',
  name: 'Want to go',
  barIds: ['attaboy'],
  createdAt: T1,
  updatedAt: T2,
};

describe('accountContent.local', () => {
  beforeEach(() => window.localStorage.clear());

  it('distinguishes never-written state from a timestamped deletion', () => {
    expect(readLocalAccountContent('lists')).toEqual({ status: 'absent' });
    window.localStorage.setItem(storageKeyForAccountContent('lists'), JSON.stringify([list]));
    stampLocalAccountContent('lists', T1);
    window.localStorage.removeItem(storageKeyForAccountContent('lists'));
    stampLocalAccountContent('lists', T2);
    expect(readLocalAccountContent('lists')).toEqual({
      status: 'present',
      value: { data: null, clientUpdatedAt: T2 },
    });
  });

  it('makes two same-millisecond local mutations strictly monotonic', () => {
    window.localStorage.setItem(storageKeyForAccountContent('lists'), JSON.stringify([list]));
    expect(stampLocalAccountContent('lists', T1)).toEqual({
      status: 'present',
      value: { data: [list], clientUpdatedAt: T1 },
    });
    expect(stampLocalAccountContent('lists', T1)).toEqual({
      status: 'present',
      value: {
        data: [list],
        clientUpdatedAt: '2026-08-01T20:00:00.001Z',
      },
    });
  });

  it('derives a stable timestamp for pre-sync content without re-stamping it', () => {
    window.localStorage.setItem(storageKeyForAccountContent('lists'), JSON.stringify([list]));
    expect(readLocalAccountContent('lists')).toEqual({
      status: 'present',
      value: { data: [list], clientUpdatedAt: T2 },
    });
    expect(window.localStorage.getItem(ACCOUNT_CONTENT_META_KEY)).toBeNull();
  });

  it('fails closed on corrupt or domain-mismatched content', () => {
    window.localStorage.setItem(storageKeyForAccountContent('lists'), '{broken');
    expect(readLocalAccountContent('lists')).toEqual({ status: 'invalid' });
    expect(
      writeLocalAccountContent('lists', {
        data: { night: '2026-08-01', visits: [] },
        clientUpdatedAt: T1,
      }),
    ).toBe(false);
  });

  it('hydrates valid data and emits the existing store event', () => {
    const seen = vi.fn();
    window.addEventListener('storage', seen);
    expect(
      writeLocalAccountContent('lists', {
        data: [list],
        clientUpdatedAt: T1,
      }),
    ).toBe(true);
    expect(JSON.parse(window.localStorage.getItem(storageKeyForAccountContent('lists'))!)).toEqual([
      list,
    ]);
    expect(readLocalAccountContent('lists')).toEqual({
      status: 'present',
      value: { data: [list], clientUpdatedAt: T1 },
    });
    expect(seen).toHaveBeenCalledTimes(1);
    expect((seen.mock.calls[0][0] as StorageEvent).key).toBe(
      storageKeyForAccountContent('lists'),
    );
    window.removeEventListener('storage', seen);
  });

  it('round-trips the ownership latch and maps only explicit content keys', () => {
    writeAccountContentOwner('user-a');
    expect(readAccountContentOwner()).toBe('user-a');
    expect(window.localStorage.getItem(ACCOUNT_CONTENT_OWNER_KEY)).toBe('user-a');
    expect(accountContentKeyForStorageKey(storageKeyForAccountContent('night_log'))).toBe(
      'night_log',
    );
    expect(accountContentKeyForStorageKey(null)).toBeNull();
    expect(accountContentKeyForStorageKey('next-bar:age-ack:v1')).toBeNull();
  });

  it('compares object keys canonically but preserves array order', () => {
    expect(sameAccountContentData({ b: 2, a: 1 }, { a: 1, b: 2 })).toBe(true);
    expect(sameAccountContentData(['a', 'b'], ['b', 'a'])).toBe(false);
  });
});
