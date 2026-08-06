// @vitest-environment jsdom
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { contentIdentity } from '@/lib/accountContent.digest';
import {
  ACCOUNT_CONTENT_META_KEY,
  stampLocalAccountContent,
} from '@/lib/accountContent.local';
import {
  ACCOUNT_CONTENT_CONFIRMED_KEY,
  classifyAccountContent,
  hydrateConfirmedAccountContent,
  readConfirmedAccountContentMeta,
  writeConfirmedAccountContentMeta,
} from '@/lib/accountContent.confirmed';

const USER = '11111111-2222-3333-4444-555555555555';
const OTHER = '99999999-8888-7777-6666-555555555555';
const LISTS_STORAGE_KEY = 'next-bar:lists:v1';

const LIST = [
  {
    id: 'want-to-go',
    name: 'Want to go',
    barIds: ['attaboy'],
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-02T00:00:00.000Z',
  },
];

function seedConfirmed(data: unknown, userId = USER, clock = '2026-08-02T00:00:00.000Z'): void {
  const id = contentIdentity(data);
  window.localStorage.setItem(
    ACCOUNT_CONTENT_CONFIRMED_KEY,
    JSON.stringify({
      lists: {
        version: 2,
        userId,
        clock,
        digest: id.digest,
        byteLength: id.byteLength,
        confirmedAt: '2026-08-02T00:00:01.000Z',
      },
    }),
  );
}

beforeEach(() => {
  window.localStorage.clear();
});

describe('confirmed metadata v2 — read/write', () => {
  test('round-trips a well-formed entry', () => {
    const id = contentIdentity(LIST);
    expect(
      writeConfirmedAccountContentMeta('lists', {
        version: 2,
        userId: USER,
        clock: '2026-08-02T00:00:00.000Z',
        digest: id.digest,
        byteLength: id.byteLength,
        confirmedAt: '2026-08-02T00:00:01.000Z',
      }),
    ).toBe(true);
    expect(readConfirmedAccountContentMeta('lists')?.digest).toBe(id.digest);
  });

  test.each([
    ['not JSON', 'garbage'],
    ['wrong version', JSON.stringify({ lists: { version: 1, userId: 'u' } })],
    [
      'missing digest',
      JSON.stringify({
        lists: {
          version: 2,
          userId: 'u',
          clock: '2026-08-02T00:00:00.000Z',
          byteLength: 3,
          confirmedAt: '2026-08-02T00:00:01.000Z',
        },
      }),
    ],
    [
      'invalid clock',
      JSON.stringify({
        lists: {
          version: 2,
          userId: 'u',
          clock: 'yesterday-ish',
          digest: 'deadbeefdeadbeef',
          byteLength: 3,
          confirmedAt: '2026-08-02T00:00:01.000Z',
        },
      }),
    ],
  ])('malformed confirmation reads as absent (%s)', (_label, raw) => {
    window.localStorage.setItem(ACCOUNT_CONTENT_CONFIRMED_KEY, raw);
    expect(readConfirmedAccountContentMeta('lists')).toBeNull();
  });
});

describe('classifyAccountContent', () => {
  test('no live value, no meta, no confirmation → absent', () => {
    expect(classifyAccountContent('lists', USER)).toBe('absent');
  });

  test('unparseable raw text → invalid', () => {
    window.localStorage.setItem(LISTS_STORAGE_KEY, '{not json');
    expect(classifyAccountContent('lists', USER)).toBe('invalid');
  });

  test('live data matching this user’s confirmed digest → clean', () => {
    window.localStorage.setItem(LISTS_STORAGE_KEY, JSON.stringify(LIST));
    seedConfirmed(LIST);
    expect(classifyAccountContent('lists', USER)).toBe('clean');
  });

  test('present data with NO confirmation → dirty (absence never confirms)', () => {
    window.localStorage.setItem(LISTS_STORAGE_KEY, JSON.stringify(LIST));
    expect(classifyAccountContent('lists', USER)).toBe('dirty');
  });

  test('malformed confirmation → dirty, never clean', () => {
    window.localStorage.setItem(LISTS_STORAGE_KEY, JSON.stringify(LIST));
    window.localStorage.setItem(
      ACCOUNT_CONTENT_CONFIRMED_KEY,
      JSON.stringify({ lists: { version: 2 } }),
    );
    expect(classifyAccountContent('lists', USER)).toBe('dirty');
  });

  test('confirmation for a DIFFERENT user never makes this user clean', () => {
    window.localStorage.setItem(LISTS_STORAGE_KEY, JSON.stringify(LIST));
    seedConfirmed(LIST, OTHER);
    expect(classifyAccountContent('lists', USER)).toBe('dirty');
  });

  test('live data differing from confirmed digest → dirty', () => {
    window.localStorage.setItem(LISTS_STORAGE_KEY, JSON.stringify(LIST));
    seedConfirmed([{ ...LIST[0], barIds: [] }]);
    expect(classifyAccountContent('lists', USER)).toBe('dirty');
  });
});

describe('digest-idempotent stamping (cross-tab re-upload guard)', () => {
  test('a storage event whose data digest equals the confirmed digest does NOT bump the clock', () => {
    window.localStorage.setItem(LISTS_STORAGE_KEY, JSON.stringify(LIST));
    seedConfirmed(LIST, USER, '2026-08-02T00:00:00.000Z');
    window.localStorage.setItem(
      ACCOUNT_CONTENT_META_KEY,
      JSON.stringify({ lists: '2026-08-02T00:00:00.000Z' }),
    );

    const read = stampLocalAccountContent('lists');
    expect(read.status).toBe('present');
    const meta = JSON.parse(
      window.localStorage.getItem(ACCOUNT_CONTENT_META_KEY) ?? '{}',
    ) as Record<string, string>;
    // Unchanged — an echoed hydration is not a new mutation.
    expect(meta.lists).toBe('2026-08-02T00:00:00.000Z');
  });

  test('a REAL local mutation (different digest) still bumps the clock', () => {
    window.localStorage.setItem(
      LISTS_STORAGE_KEY,
      JSON.stringify([{ ...LIST[0], barIds: ['attaboy', 'death-and-co'] }]),
    );
    seedConfirmed(LIST, USER, '2026-08-02T00:00:00.000Z');
    window.localStorage.setItem(
      ACCOUNT_CONTENT_META_KEY,
      JSON.stringify({ lists: '2026-08-02T00:00:00.000Z' }),
    );

    stampLocalAccountContent('lists');
    const meta = JSON.parse(
      window.localStorage.getItem(ACCOUNT_CONTENT_META_KEY) ?? '{}',
    ) as Record<string, string>;
    expect(Date.parse(meta.lists)).toBeGreaterThan(
      Date.parse('2026-08-02T00:00:00.000Z'),
    );
  });

  test('a local mutation never overwrites confirmed metadata', () => {
    window.localStorage.setItem(LISTS_STORAGE_KEY, JSON.stringify(LIST));
    seedConfirmed(LIST, USER, '2026-08-02T00:00:00.000Z');
    const before = window.localStorage.getItem(ACCOUNT_CONTENT_CONFIRMED_KEY);
    stampLocalAccountContent('lists');
    expect(window.localStorage.getItem(ACCOUNT_CONTENT_CONFIRMED_KEY)).toBe(
      before,
    );
  });
});

describe('hydrateConfirmedAccountContent — confirmed metadata lands FIRST', () => {
  test('write order is confirmed → data → v1 meta (crash between leaves dirty, never falsely clean)', () => {
    const original = Storage.prototype.setItem;
    const order: string[] = [];
    const spy = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(function (this: Storage, key: string, value: string) {
        order.push(key);
        original.call(this, key, value);
      });

    try {
      const ok = hydrateConfirmedAccountContent(
        'lists',
        { data: LIST, clientUpdatedAt: '2026-08-02T00:00:00.000Z' },
        USER,
      );
      expect(ok).toBe(true);
    } finally {
      spy.mockRestore();
    }

    const confirmedIdx = order.indexOf(ACCOUNT_CONTENT_CONFIRMED_KEY);
    const dataIdx = order.indexOf(LISTS_STORAGE_KEY);
    const metaIdx = order.indexOf(ACCOUNT_CONTENT_META_KEY);
    expect(confirmedIdx).toBeGreaterThanOrEqual(0);
    expect(dataIdx).toBeGreaterThan(confirmedIdx);
    expect(metaIdx).toBeGreaterThan(dataIdx);
  });

  test('after hydration the key classifies clean for that user', () => {
    hydrateConfirmedAccountContent(
      'lists',
      { data: LIST, clientUpdatedAt: '2026-08-02T00:00:00.000Z' },
      USER,
    );
    expect(classifyAccountContent('lists', USER)).toBe('clean');
    expect(readConfirmedAccountContentMeta('lists')?.userId).toBe(USER);
  });

  test('a null-data hydration (server tombstone) is also confirmed-first and clean', () => {
    window.localStorage.setItem(LISTS_STORAGE_KEY, JSON.stringify(LIST));
    hydrateConfirmedAccountContent(
      'lists',
      { data: null, clientUpdatedAt: '2026-08-03T00:00:00.000Z' },
      USER,
    );
    expect(window.localStorage.getItem(LISTS_STORAGE_KEY)).toBeNull();
    expect(classifyAccountContent('lists', USER)).toBe('clean');
  });
});
