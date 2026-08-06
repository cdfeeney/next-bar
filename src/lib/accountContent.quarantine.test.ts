// @vitest-environment jsdom
import { beforeEach, describe, expect, test, vi } from 'vitest';
import {
  ACCOUNT_CONTENT_JOURNAL_KEY,
  ACCOUNT_CONTENT_QUARANTINE_KEY,
  getPendingForeign,
  quarantineAccountContent,
  readQuarantineStore,
  readQuarantinedAccountContent,
  recoverQuarantineJournal,
  resolvePendingForeign,
  setPendingForeign,
  wipeAllQuarantineState,
} from '@/lib/accountContent.quarantine';
import {
  ACCOUNT_CONTENT_META_KEY,
  ACCOUNT_CONTENT_OWNER_KEY,
} from '@/lib/accountContent.local';
import { ACCOUNT_CONTENT_CONFIRMED_KEY } from '@/lib/accountContent.confirmed';
import { contentIdentity } from '@/lib/accountContent.digest';

const USER_A = 'aaaaaaaa-1111-2222-3333-444444444444';
const USER_B = 'bbbbbbbb-1111-2222-3333-444444444444';

const LISTS_KEY = 'next-bar:lists:v1';
const ARCHIVE_KEY = 'next-bar:night-archive:v1';
const LOG_KEY = 'next-bar:night-log:v1';
const SHARED_KEY = 'next-bar:shared-nights:v1';

const LISTS = [
  {
    id: 'want-to-go',
    name: 'Want to go',
    barIds: ['attaboy'],
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-02T00:00:00.000Z',
  },
];
const ARCHIVE = [
  {
    nightKey: '2026-07-30',
    visits: [{ barId: 'attaboy', at: '2026-07-31T02:00:00.000Z' }],
  },
];
const SHARED = {
  '2026-07-30': {
    token: '123e4567-e89b-42d3-a456-426614174000',
    sharedAt: '2026-07-31T15:00:00.000Z',
  },
};

function seedLiveContent(): void {
  window.localStorage.setItem(LISTS_KEY, JSON.stringify(LISTS));
  window.localStorage.setItem(ARCHIVE_KEY, JSON.stringify(ARCHIVE));
  window.localStorage.setItem(SHARED_KEY, JSON.stringify(SHARED));
  window.localStorage.setItem(ACCOUNT_CONTENT_OWNER_KEY, USER_A);
  window.localStorage.setItem(
    ACCOUNT_CONTENT_META_KEY,
    JSON.stringify({ lists: '2026-08-02T00:00:00.000Z' }),
  );
}

beforeEach(() => {
  window.localStorage.clear();
});

describe('quarantineAccountContent — happy path P1–P6', () => {
  test('moves every live domain into the owner envelope and clears live state', () => {
    seedLiveContent();
    const result = quarantineAccountContent(USER_A);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.movedKeys.sort()).toEqual(
      ['lists', 'night_archive', 'shared_nights'].sort(),
    );

    const envelopes = readQuarantinedAccountContent(USER_A);
    expect(envelopes.lists?.data).toEqual(LISTS);
    expect(envelopes.lists?.digest).toBe(contentIdentity(LISTS).digest);
    expect(envelopes.night_archive?.data).toEqual(ARCHIVE);
    expect(envelopes.shared_nights?.data).toEqual(SHARED);

    // Live copies, meta, owner, journal: all gone.
    expect(window.localStorage.getItem(LISTS_KEY)).toBeNull();
    expect(window.localStorage.getItem(ARCHIVE_KEY)).toBeNull();
    expect(window.localStorage.getItem(SHARED_KEY)).toBeNull();
    expect(window.localStorage.getItem(ACCOUNT_CONTENT_OWNER_KEY)).toBeNull();
    expect(window.localStorage.getItem(ACCOUNT_CONTENT_JOURNAL_KEY)).toBeNull();
    const meta = JSON.parse(
      window.localStorage.getItem(ACCOUNT_CONTENT_META_KEY) ?? '{}',
    ) as Record<string, unknown>;
    expect(meta.lists).toBeUndefined();
  });

  test('the owner marker is removed LAST — after every content and meta removal', () => {
    seedLiveContent();
    const removeOrder: string[] = [];
    const originalRemove = Storage.prototype.removeItem;
    const spy = vi
      .spyOn(Storage.prototype, 'removeItem')
      .mockImplementation(function (this: Storage, key: string) {
        removeOrder.push(key);
        originalRemove.call(this, key);
      });
    try {
      quarantineAccountContent(USER_A);
    } finally {
      spy.mockRestore();
    }
    const ownerIdx = removeOrder.indexOf(ACCOUNT_CONTENT_OWNER_KEY);
    expect(ownerIdx).toBeGreaterThanOrEqual(0);
    for (const contentKey of [LISTS_KEY, ARCHIVE_KEY, SHARED_KEY]) {
      const idx = removeOrder.indexOf(contentKey);
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(ownerIdx);
    }
    // Only the journal clear may follow the owner removal.
    expect(
      removeOrder.slice(ownerIdx + 1).filter((k) => k !== ACCOUNT_CONTENT_JOURNAL_KEY),
    ).toEqual([]);
  });

  test('invalid raw text is preserved VERBATIM in the raw quarantine, never parsed away', () => {
    window.localStorage.setItem(LISTS_KEY, '{definitely not json');
    window.localStorage.setItem(ACCOUNT_CONTENT_OWNER_KEY, USER_A);
    const result = quarantineAccountContent(USER_A);
    expect(result.ok).toBe(true);
    const store = readQuarantineStore();
    expect(store.rawInvalid[USER_A]?.lists?.raw).toBe('{definitely not json');
    expect(window.localStorage.getItem(LISTS_KEY)).toBeNull();
  });

  test('with nothing live, the dangling owner marker is still removed', () => {
    window.localStorage.setItem(ACCOUNT_CONTENT_OWNER_KEY, USER_A);
    const result = quarantineAccountContent(USER_A);
    expect(result).toEqual({ ok: true, movedKeys: [] });
    expect(window.localStorage.getItem(ACCOUNT_CONTENT_OWNER_KEY)).toBeNull();
  });
});

describe('quota pressure — removal never precedes a durable preserved copy', () => {
  test('P1 journal write failure (quota) removes NOTHING', () => {
    seedLiveContent();
    const original = Storage.prototype.setItem;
    const spy = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(function (this: Storage, key: string, value: string) {
        if (key === ACCOUNT_CONTENT_JOURNAL_KEY) {
          throw new DOMException('quota', 'QuotaExceededError');
        }
        original.call(this, key, value);
      });
    try {
      const result = quarantineAccountContent(USER_A);
      expect(result).toEqual({ ok: false, reason: 'quota' });
    } finally {
      spy.mockRestore();
    }
    expect(window.localStorage.getItem(LISTS_KEY)).toBe(JSON.stringify(LISTS));
    expect(window.localStorage.getItem(ACCOUNT_CONTENT_OWNER_KEY)).toBe(USER_A);
    expect(readQuarantinedAccountContent(USER_A)).toEqual({});
  });

  test('P3 commit failure (quota on the store) removes NOTHING', () => {
    seedLiveContent();
    const original = Storage.prototype.setItem;
    const spy = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(function (this: Storage, key: string, value: string) {
        if (key === ACCOUNT_CONTENT_QUARANTINE_KEY) {
          throw new DOMException('quota', 'QuotaExceededError');
        }
        original.call(this, key, value);
      });
    try {
      const result = quarantineAccountContent(USER_A);
      expect(result.ok).toBe(false);
    } finally {
      spy.mockRestore();
    }
    expect(window.localStorage.getItem(LISTS_KEY)).toBe(JSON.stringify(LISTS));
    expect(window.localStorage.getItem(ARCHIVE_KEY)).toBe(
      JSON.stringify(ARCHIVE),
    );
    expect(window.localStorage.getItem(ACCOUNT_CONTENT_OWNER_KEY)).toBe(USER_A);
  });
});

describe('crash recovery — resumes only after revalidation', () => {
  function journalFor(
    phase: 'P1' | 'P3' | 'P4' | 'P5',
    pending: Record<string, unknown>,
  ): string {
    return JSON.stringify({
      version: 1,
      ownerUserId: USER_A,
      phase,
      startedAt: '2026-08-05T00:00:00.000Z',
      pending,
      pendingRaw: {},
    });
  }

  function listsEnvelope(): Record<string, unknown> {
    const id = contentIdentity(LISTS);
    return {
      lists: {
        data: LISTS,
        clientUpdatedAt: '2026-08-02T00:00:00.000Z',
        digest: id.digest,
        byteLength: id.byteLength,
        quarantinedAt: '2026-08-05T00:00:00.000Z',
        status: 'quarantined',
      },
    };
  }

  test('crash at P1 with live intact: recovery completes the whole move', () => {
    window.localStorage.setItem(LISTS_KEY, JSON.stringify(LISTS));
    window.localStorage.setItem(ACCOUNT_CONTENT_OWNER_KEY, USER_A);
    window.localStorage.setItem(
      ACCOUNT_CONTENT_META_KEY,
      JSON.stringify({ lists: '2026-08-02T00:00:00.000Z' }),
    );
    window.localStorage.setItem(
      ACCOUNT_CONTENT_JOURNAL_KEY,
      journalFor('P1', listsEnvelope()),
    );

    recoverQuarantineJournal();

    expect(readQuarantinedAccountContent(USER_A).lists?.data).toEqual(LISTS);
    expect(window.localStorage.getItem(LISTS_KEY)).toBeNull();
    expect(window.localStorage.getItem(ACCOUNT_CONTENT_OWNER_KEY)).toBeNull();
    expect(window.localStorage.getItem(ACCOUNT_CONTENT_JOURNAL_KEY)).toBeNull();
  });

  test('crash at P1 after further live mutation: recovery preserves the NEWER live value', () => {
    const newer = [{ ...LISTS[0], barIds: ['attaboy', 'death-and-co'] }];
    window.localStorage.setItem(LISTS_KEY, JSON.stringify(newer));
    window.localStorage.setItem(ACCOUNT_CONTENT_OWNER_KEY, USER_A);
    window.localStorage.setItem(
      ACCOUNT_CONTENT_JOURNAL_KEY,
      journalFor('P1', listsEnvelope()), // stale capture of the OLD value
    );

    recoverQuarantineJournal();

    expect(readQuarantinedAccountContent(USER_A).lists?.data).toEqual(newer);
    expect(window.localStorage.getItem(LISTS_KEY)).toBeNull();
  });

  test('crash at P3 (committed, live still present): committed envelope is authoritative and completes P4–P6', () => {
    window.localStorage.setItem(LISTS_KEY, JSON.stringify(LISTS));
    window.localStorage.setItem(ACCOUNT_CONTENT_OWNER_KEY, USER_A);
    const id = contentIdentity(LISTS);
    window.localStorage.setItem(
      ACCOUNT_CONTENT_QUARANTINE_KEY,
      JSON.stringify({
        version: 2,
        accounts: {
          [USER_A]: {
            lists: {
              data: LISTS,
              clientUpdatedAt: '2026-08-02T00:00:00.000Z',
              digest: id.digest,
              byteLength: id.byteLength,
              quarantinedAt: '2026-08-05T00:00:00.000Z',
              status: 'quarantined',
            },
          },
        },
        rawInvalid: {},
        pendingForeign: null,
        resolutionRequired: [],
      }),
    );
    window.localStorage.setItem(
      ACCOUNT_CONTENT_JOURNAL_KEY,
      journalFor('P3', listsEnvelope()),
    );

    recoverQuarantineJournal();

    expect(window.localStorage.getItem(LISTS_KEY)).toBeNull();
    expect(window.localStorage.getItem(ACCOUNT_CONTENT_OWNER_KEY)).toBeNull();
    expect(window.localStorage.getItem(ACCOUNT_CONTENT_JOURNAL_KEY)).toBeNull();
    expect(readQuarantinedAccountContent(USER_A).lists?.data).toEqual(LISTS);
  });

  test('crash at P4 (live removed): recovery finishes meta and owner without touching the envelope', () => {
    window.localStorage.setItem(ACCOUNT_CONTENT_OWNER_KEY, USER_A);
    window.localStorage.setItem(
      ACCOUNT_CONTENT_META_KEY,
      JSON.stringify({ lists: '2026-08-02T00:00:00.000Z' }),
    );
    window.localStorage.setItem(
      ACCOUNT_CONTENT_CONFIRMED_KEY,
      JSON.stringify({}),
    );
    const id = contentIdentity(LISTS);
    window.localStorage.setItem(
      ACCOUNT_CONTENT_QUARANTINE_KEY,
      JSON.stringify({
        version: 2,
        accounts: {
          [USER_A]: {
            lists: {
              data: LISTS,
              clientUpdatedAt: '2026-08-02T00:00:00.000Z',
              digest: id.digest,
              byteLength: id.byteLength,
              quarantinedAt: '2026-08-05T00:00:00.000Z',
              status: 'quarantined',
            },
          },
        },
        rawInvalid: {},
        pendingForeign: null,
        resolutionRequired: [],
      }),
    );
    window.localStorage.setItem(
      ACCOUNT_CONTENT_JOURNAL_KEY,
      journalFor('P4', listsEnvelope()),
    );

    recoverQuarantineJournal();

    expect(window.localStorage.getItem(ACCOUNT_CONTENT_OWNER_KEY)).toBeNull();
    expect(window.localStorage.getItem(ACCOUNT_CONTENT_JOURNAL_KEY)).toBeNull();
    const meta = JSON.parse(
      window.localStorage.getItem(ACCOUNT_CONTENT_META_KEY) ?? '{}',
    ) as Record<string, unknown>;
    expect(meta.lists).toBeUndefined();
    expect(readQuarantinedAccountContent(USER_A).lists?.data).toEqual(LISTS);
  });

  test('committed record failing revalidation preserves BOTH copies and records resolution-required', () => {
    // Live value present; committed store claims lists but with a WRONG digest.
    window.localStorage.setItem(LISTS_KEY, JSON.stringify(LISTS));
    window.localStorage.setItem(ACCOUNT_CONTENT_OWNER_KEY, USER_A);
    window.localStorage.setItem(
      ACCOUNT_CONTENT_QUARANTINE_KEY,
      JSON.stringify({
        version: 2,
        accounts: {
          [USER_A]: {
            lists: {
              data: [{ ...LISTS[0], name: 'Corrupted differently' }],
              clientUpdatedAt: '2026-08-02T00:00:00.000Z',
              digest: contentIdentity(LISTS).digest, // digest does NOT match data
              byteLength: 1,
              quarantinedAt: '2026-08-05T00:00:00.000Z',
              status: 'quarantined',
            },
          },
        },
        rawInvalid: {},
        pendingForeign: null,
        resolutionRequired: [],
      }),
    );
    window.localStorage.setItem(
      ACCOUNT_CONTENT_JOURNAL_KEY,
      journalFor('P3', listsEnvelope()),
    );

    recoverQuarantineJournal();

    // Both copies survive: live untouched, corrupt envelope untouched.
    expect(window.localStorage.getItem(LISTS_KEY)).toBe(JSON.stringify(LISTS));
    expect(readQuarantinedAccountContent(USER_A).lists).toBeDefined();
    expect(window.localStorage.getItem(ACCOUNT_CONTENT_OWNER_KEY)).toBe(USER_A);
    const store = readQuarantineStore();
    expect(store.resolutionRequired).toHaveLength(1);
    expect(store.resolutionRequired[0].ownerUserId).toBe(USER_A);
    expect(window.localStorage.getItem(ACCOUNT_CONTENT_JOURNAL_KEY)).toBeNull();
  });
});

describe('multi-account coexistence — no eviction, no TTL', () => {
  test('two accounts’ envelopes coexist; quarantining B never disturbs A', () => {
    seedLiveContent();
    expect(quarantineAccountContent(USER_A).ok).toBe(true);

    const bLists = [{ ...LISTS[0], name: 'B list' }];
    window.localStorage.setItem(LISTS_KEY, JSON.stringify(bLists));
    window.localStorage.setItem(ACCOUNT_CONTENT_OWNER_KEY, USER_B);
    expect(quarantineAccountContent(USER_B).ok).toBe(true);

    expect(readQuarantinedAccountContent(USER_A).lists?.data).toEqual(LISTS);
    expect(readQuarantinedAccountContent(USER_B).lists?.data).toEqual(bLists);
  });
});

describe('foreign-residue resolution', () => {
  test('keep preserves the envelope; delete permanently drops that owner only', () => {
    seedLiveContent();
    quarantineAccountContent(USER_A);
    setPendingForeign(USER_A);
    expect(getPendingForeign()?.ownerUserId).toBe(USER_A);

    // Keep: envelope survives, block clears.
    expect(resolvePendingForeign('keep')).toBe(true);
    expect(getPendingForeign()).toBeNull();
    expect(readQuarantinedAccountContent(USER_A).lists?.data).toEqual(LISTS);

    // Delete permanently: this owner's envelopes drop.
    setPendingForeign(USER_A);
    expect(resolvePendingForeign('delete')).toBe(true);
    expect(readQuarantinedAccountContent(USER_A)).toEqual({});
    expect(getPendingForeign()).toBeNull();
  });
});

describe('wipeAllQuarantineState — account deletion only', () => {
  test('removes quarantine and journal unconditionally', () => {
    seedLiveContent();
    quarantineAccountContent(USER_A);
    window.localStorage.setItem(ACCOUNT_CONTENT_JOURNAL_KEY, '{"version":1}');
    wipeAllQuarantineState();
    expect(
      window.localStorage.getItem(ACCOUNT_CONTENT_QUARANTINE_KEY),
    ).toBeNull();
    expect(window.localStorage.getItem(ACCOUNT_CONTENT_JOURNAL_KEY)).toBeNull();
  });
});
