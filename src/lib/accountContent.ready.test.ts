// @vitest-environment jsdom
import { beforeEach, describe, expect, test, vi } from 'vitest';
import {
  ensureAccountContentReady,
  __resetAccountContentReadyForTests,
} from '@/lib/accountContent.ready';
import {
  setAccountContentAuthContext,
  __resetAccountContentContextForTests,
} from '@/lib/accountContent.context';
import {
  ACCOUNT_CONTENT_OWNER_KEY,
  readLocalAccountContent,
} from '@/lib/accountContent.local';
import {
  getPendingForeign,
  readQuarantinedAccountContent,
  resolvePendingForeign,
} from '@/lib/accountContent.quarantine';
import { clearAccountCache } from '@/lib/accountCache';
import { listArchivedNights } from '@/lib/nightArchive';
import { loadLists } from '@/lib/lists';
import { loadCurrentLog } from '@/lib/nightLog';
import { listSharedNights } from '@/lib/sharedNightsLocal';

const USER_A = 'aaaaaaaa-1111-2222-3333-444444444444';
const USER_B = 'bbbbbbbb-1111-2222-3333-444444444444';

const ARCHIVE_KEY = 'next-bar:night-archive:v1';
const LISTS_KEY = 'next-bar:lists:v1';
const LOG_KEY = 'next-bar:night-log:v1';
const SHARED_KEY = 'next-bar:shared-nights:v1';

const ARCHIVE = [
  {
    nightKey: '2026-07-30',
    visits: [{ barId: 'attaboy', at: '2026-07-31T02:00:00.000Z' }],
  },
];
const LISTS = [
  {
    id: 'want-to-go',
    name: 'Want to go',
    barIds: ['attaboy'],
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-02T00:00:00.000Z',
  },
];

function seedOwnedContent(owner: string): void {
  window.localStorage.setItem(ARCHIVE_KEY, JSON.stringify(ARCHIVE));
  window.localStorage.setItem(LISTS_KEY, JSON.stringify(LISTS));
  window.localStorage.setItem(
    LOG_KEY,
    JSON.stringify({
      night: '2026-08-01',
      visits: [{ barId: 'mr-purple', at: '2026-08-02T01:00:00.000Z' }],
    }),
  );
  window.localStorage.setItem(
    SHARED_KEY,
    JSON.stringify({
      '2026-07-30': {
        token: '123e4567-e89b-42d3-a456-426614174000',
        sharedAt: '2026-07-31T15:00:00.000Z',
      },
    }),
  );
  window.localStorage.setItem(ACCOUNT_CONTENT_OWNER_KEY, owner);
}

beforeEach(() => {
  window.localStorage.clear();
  __resetAccountContentContextForTests();
  __resetAccountContentReadyForTests();
});

describe('barrier verdicts', () => {
  test('auth unknown + owner marker present → blocked (nothing renders)', () => {
    seedOwnedContent(USER_A);
    expect(ensureAccountContentReady()).toEqual({
      status: 'blocked',
      reason: 'auth-unknown',
    });
  });

  test('auth unknown + no owner (pure anonymous) → ready', () => {
    window.localStorage.setItem(ARCHIVE_KEY, JSON.stringify(ARCHIVE));
    expect(ensureAccountContentReady()).toEqual({ status: 'ready' });
  });

  test('signed-in owner sees their own content: ready', () => {
    seedOwnedContent(USER_A);
    setAccountContentAuthContext({ kind: 'signed-in', userId: USER_A });
    expect(ensureAccountContentReady()).toEqual({ status: 'ready' });
    expect(listArchivedNights()).toEqual(ARCHIVE);
  });

  test('signed-in B over A’s live residue: quarantined under A, blocked for B', () => {
    seedOwnedContent(USER_A);
    setAccountContentAuthContext({ kind: 'signed-in', userId: USER_B });
    expect(ensureAccountContentReady()).toEqual({
      status: 'blocked',
      reason: 'foreign-residue',
    });
    // A's content preserved under A — never adopted by B.
    expect(readQuarantinedAccountContent(USER_A).night_archive?.data).toEqual(
      ARCHIVE,
    );
    expect(window.localStorage.getItem(ARCHIVE_KEY)).toBeNull();
    expect(getPendingForeign()?.ownerUserId).toBe(USER_A);
  });

  test('signed-out with owner residue (involuntary): quarantined inert, then ready', () => {
    seedOwnedContent(USER_A);
    setAccountContentAuthContext({ kind: 'signed-out' });
    expect(ensureAccountContentReady()).toEqual({ status: 'ready' });
    expect(readQuarantinedAccountContent(USER_A).lists?.data).toEqual(LISTS);
    // The anonymous session starts empty — residue is inert.
    expect(listArchivedNights()).toEqual([]);
    expect(loadLists()).toEqual([]);
  });

  test('the block persists for B until resolution; keep-it-for-them unblocks and preserves', () => {
    seedOwnedContent(USER_A);
    setAccountContentAuthContext({ kind: 'signed-in', userId: USER_B });
    ensureAccountContentReady();

    // Memo epoch churn does not clear the block.
    __resetAccountContentReadyForTests();
    expect(ensureAccountContentReady().status).toBe('blocked');

    resolvePendingForeign('keep');
    __resetAccountContentReadyForTests();
    expect(ensureAccountContentReady()).toEqual({ status: 'ready' });
    expect(readQuarantinedAccountContent(USER_A).lists?.data).toEqual(LISTS);
  });

  test('the residue owner returning is never blocked by their own data', () => {
    seedOwnedContent(USER_A);
    setAccountContentAuthContext({ kind: 'signed-in', userId: USER_B });
    ensureAccountContentReady(); // B saw the block; A's data quarantined
    setAccountContentAuthContext({ kind: 'signed-in', userId: USER_A });
    expect(ensureAccountContentReady()).toEqual({ status: 'ready' });
    expect(getPendingForeign()).toBeNull();
    // Envelope retained for the restore reconciliation.
    expect(readQuarantinedAccountContent(USER_A).lists?.data).toEqual(LISTS);
  });

  test('cache-epoch bump re-evaluates the memo', () => {
    setAccountContentAuthContext({ kind: 'signed-in', userId: USER_A });
    expect(ensureAccountContentReady()).toEqual({ status: 'ready' });
    seedOwnedContent(USER_A);
    // Same epoch: memoized ready. After a wipe bump: re-evaluated.
    clearAccountCache();
    expect(ensureAccountContentReady()).toEqual({ status: 'ready' });
  });
});

describe('santa round-1 hardening', () => {
  test('an owner-stamp write failure fails CLOSED instead of leaving content unattributable', async () => {
    const { ACCOUNT_CONTENT_OWNER_KEY: OWNER_KEY } = await import(
      '@/lib/accountContent.local'
    );
    window.localStorage.setItem(ARCHIVE_KEY, JSON.stringify(ARCHIVE));
    setAccountContentAuthContext({ kind: 'signed-in', userId: USER_A });
    const original = Storage.prototype.setItem;
    const spy = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(function (this: Storage, key: string, value: string) {
        if (key === OWNER_KEY) {
          throw new DOMException('quota', 'QuotaExceededError');
        }
        original.call(this, key, value);
      });
    try {
      expect(ensureAccountContentReady()).toEqual({
        status: 'blocked',
        reason: 'resolution-required',
      });
    } finally {
      spy.mockRestore();
    }
  });

  test('WRITERS are barred while blocked — no clobbering of unresolved residue', async () => {
    const { archiveNight } = await import('@/lib/nightArchive');
    const { createList } = await import('@/lib/lists');
    seedOwnedContent(USER_A);
    // Auth unknown + owner marker: blocked. A write burst in this window
    // must not touch the foreign residue.
    expect(ensureAccountContentReady().status).toBe('blocked');
    archiveNight({
      nightKey: '2026-08-05',
      visits: [{ barId: 'mr-purple', at: '2026-08-06T01:00:00.000Z' }],
    });
    expect(createList('My new list')).toBeNull();
    expect(window.localStorage.getItem(ARCHIVE_KEY)).toBe(
      JSON.stringify(ARCHIVE),
    );
    expect(window.localStorage.getItem(LISTS_KEY)).toBe(JSON.stringify(LISTS));
  });
});

describe('santa round-2 hardening', () => {
  test('a guard-blocked write never dispatches a change notification (no false "something changed")', async () => {
    const { archiveNight } = await import('@/lib/nightArchive');
    const { recordVisit } = await import('@/lib/nightLog');
    const { recordSharedNight } = await import('@/lib/sharedNightsLocal');
    seedOwnedContent(USER_A); // auth unknown + owner marker → blocked
    expect(ensureAccountContentReady().status).toBe('blocked');

    const seen: Array<string | null> = [];
    const listener = (e: Event): void => {
      seen.push((e as StorageEvent).key);
    };
    window.addEventListener('storage', listener);
    try {
      archiveNight({
        nightKey: '2026-08-05',
        visits: [{ barId: 'mr-purple', at: '2026-08-06T01:00:00.000Z' }],
      });
      recordVisit('attaboy');
      recordSharedNight(
        '2026-08-05',
        '123e4567-e89b-42d3-a456-426614174001',
      );
    } finally {
      window.removeEventListener('storage', listener);
    }
    expect(
      seen.filter((k) => k === ARCHIVE_KEY || k === LOG_KEY || k === SHARED_KEY),
    ).toEqual([]);
  });

  test('a permitted write still notifies its listeners', async () => {
    const { recordSharedNight } = await import('@/lib/sharedNightsLocal');
    setAccountContentAuthContext({ kind: 'signed-out' }); // pure anonymous → ready
    expect(ensureAccountContentReady()).toEqual({ status: 'ready' });

    const seen: Array<string | null> = [];
    const listener = (e: Event): void => {
      seen.push((e as StorageEvent).key);
    };
    window.addEventListener('storage', listener);
    try {
      recordSharedNight(
        '2026-08-05',
        '123e4567-e89b-42d3-a456-426614174001',
      );
    } finally {
      window.removeEventListener('storage', listener);
    }
    expect(seen).toContain(SHARED_KEY);
  });
});

describe('reader wiring — every account-content reader consults the barrier', () => {
  test('FIRST FRAME: foreign residue renders as EMPTY in every reader (negative render)', () => {
    seedOwnedContent(USER_A);
    setAccountContentAuthContext({ kind: 'signed-in', userId: USER_B });

    expect(listArchivedNights()).toEqual([]);
    expect(loadLists()).toEqual([]);
    expect(loadCurrentLog()).toBeNull();
    expect(listSharedNights()).toEqual({});
    expect(readLocalAccountContent('lists')).toEqual({ status: 'absent' });
  });

  test('auth-unknown with an owner marker renders EMPTY in every reader', () => {
    seedOwnedContent(USER_A);
    expect(listArchivedNights()).toEqual([]);
    expect(loadLists()).toEqual([]);
    expect(loadCurrentLog()).toBeNull();
    expect(listSharedNights()).toEqual({});
    expect(readLocalAccountContent('night_archive')).toEqual({
      status: 'absent',
    });
  });

  test('ready state passes reads through unchanged', () => {
    seedOwnedContent(USER_A);
    setAccountContentAuthContext({ kind: 'signed-in', userId: USER_A });
    expect(listArchivedNights()).toEqual(ARCHIVE);
    expect(loadLists()).toEqual(LISTS);
    expect(loadCurrentLog()?.nightKey).toBe('2026-08-01');
    expect(Object.keys(listSharedNights())).toEqual(['2026-07-30']);
  });
});
