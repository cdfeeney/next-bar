// @vitest-environment jsdom
import { beforeEach, describe, expect, test, vi } from 'vitest';
import {
  ACCOUNT_CONTENT_JOURNAL_KEY,
  ACCOUNT_CONTENT_QUARANTINE_KEY,
  getPendingForeign,
  quarantineAccountContent,
  quarantineRawInvalidContent,
  readQuarantineStore,
  readQuarantinedAccountContent,
  recoverQuarantineJournal,
  releaseQuarantinedEnvelope,
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

describe('santa round-2 hardening (Codex lane findings)', () => {
  const OLD = LISTS;
  const NEW = [{ ...LISTS[0], barIds: ['attaboy', 'death-and-co'] }];

  /** The exact state a digest-guard abort leaves behind: OLD committed under
   *  A, live already holds NEW, divergence flagged, journal stuck at P4. */
  function seedDivergenceAbort(options?: {
    confirmedAtCapture?: { clock: string } | null;
  }): void {
    const idOld = contentIdentity(OLD);
    const oldEnvelope = {
      data: OLD,
      clientUpdatedAt: '2026-08-02T00:00:00.000Z',
      digest: idOld.digest,
      byteLength: idOld.byteLength,
      quarantinedAt: '2026-08-05T00:00:00.000Z',
      status: 'quarantined',
      confirmedAtCapture: options?.confirmedAtCapture ?? null,
    };
    window.localStorage.setItem(LISTS_KEY, JSON.stringify(NEW));
    window.localStorage.setItem(ACCOUNT_CONTENT_OWNER_KEY, USER_A);
    window.localStorage.setItem(
      ACCOUNT_CONTENT_QUARANTINE_KEY,
      JSON.stringify({
        version: 2,
        accounts: { [USER_A]: { lists: oldEnvelope } },
        rawInvalid: {},
        pendingForeign: null,
        resolutionRequired: [
          {
            reason:
              'live lists diverged from journaled envelope; both copies preserved',
            at: '2026-08-05T00:00:00.000Z',
            ownerUserId: USER_A,
            key: 'lists',
          },
        ],
      }),
    );
    window.localStorage.setItem(
      ACCOUNT_CONTENT_JOURNAL_KEY,
      JSON.stringify({
        version: 1,
        ownerUserId: USER_A,
        phase: 'P4',
        startedAt: '2026-08-05T00:00:00.000Z',
        pending: { lists: oldEnvelope },
        pendingRaw: {},
      }),
    );
  }

  test('re-quarantine after a divergence abort SUPERSEDES the old committed copy — never destroys it', () => {
    seedDivergenceAbort();
    const idOld = contentIdentity(OLD);

    const result = quarantineAccountContent(USER_A);

    expect(result.ok).toBe(true);
    const envelope = readQuarantinedAccountContent(USER_A).lists;
    // The current live value is the main preserved copy…
    expect(envelope?.data).toEqual(NEW);
    // …and the previously committed OLD copy survives as a snapshot.
    expect(
      envelope?.superseded?.some((s) => s.digest === idOld.digest),
    ).toBe(true);
    expect(
      envelope?.superseded?.find((s) => s.digest === idOld.digest)?.data,
    ).toEqual(OLD);
    // With both copies durably preserved the move completes: live gone,
    // owner marker gone.
    expect(window.localStorage.getItem(LISTS_KEY)).toBeNull();
    expect(window.localStorage.getItem(ACCOUNT_CONTENT_OWNER_KEY)).toBeNull();
  });

  test('the divergence resolution-required entry CLEARS once both copies are preserved in the store', () => {
    seedDivergenceAbort();

    quarantineAccountContent(USER_A);

    const store = readQuarantineStore();
    expect(
      store.resolutionRequired.filter(
        (e) => e.key === 'lists' && e.ownerUserId === USER_A,
      ),
    ).toEqual([]);
  });

  test('a committed copy whose server presence was PROVEN at capture is superseded without a snapshot', () => {
    seedDivergenceAbort({
      confirmedAtCapture: { clock: '2026-08-02T00:00:00.000Z' },
    });

    quarantineAccountContent(USER_A);

    const envelope = readQuarantinedAccountContent(USER_A).lists;
    expect(envelope?.data).toEqual(NEW);
    expect(envelope?.superseded ?? []).toEqual([]);
  });

  test('releasing an envelope PROMOTES its superseded snapshot to an explicit conflict — silent deletion never', () => {
    const idOld = contentIdentity(OLD);
    const idNew = contentIdentity(NEW);
    window.localStorage.setItem(
      ACCOUNT_CONTENT_QUARANTINE_KEY,
      JSON.stringify({
        version: 2,
        accounts: {
          [USER_A]: {
            lists: {
              data: NEW,
              clientUpdatedAt: '2026-08-05T00:00:00.000Z',
              digest: idNew.digest,
              byteLength: idNew.byteLength,
              quarantinedAt: '2026-08-05T00:00:00.000Z',
              status: 'quarantined',
              confirmedAtCapture: null,
              superseded: [
                {
                  data: OLD,
                  clientUpdatedAt: '2026-08-02T00:00:00.000Z',
                  digest: idOld.digest,
                  byteLength: idOld.byteLength,
                  quarantinedAt: '2026-08-04T00:00:00.000Z',
                  supersededAt: '2026-08-05T00:00:00.000Z',
                  confirmedAtCapture: null,
                },
              ],
            },
          },
        },
        rawInvalid: {},
        pendingForeign: null,
        resolutionRequired: [],
      }),
    );

    expect(releaseQuarantinedEnvelope(USER_A, 'lists')).toBe(true);

    const envelope = readQuarantinedAccountContent(USER_A).lists;
    expect(envelope?.status).toBe('conflict');
    expect(envelope?.data).toEqual(OLD);
    expect(envelope?.superseded ?? []).toEqual([]);
  });

  test('a stale release naming a DIFFERENT digest is a no-op — a promoted snapshot is never deleted by it', () => {
    // Two tabs raced: this slot now holds the promoted snapshot (digest S),
    // but the stale tab still believes it is releasing envelope E.
    const idOld = contentIdentity(OLD);
    const idNew = contentIdentity(NEW);
    window.localStorage.setItem(
      ACCOUNT_CONTENT_QUARANTINE_KEY,
      JSON.stringify({
        version: 2,
        accounts: {
          [USER_A]: {
            lists: {
              data: OLD,
              clientUpdatedAt: '2026-08-02T00:00:00.000Z',
              digest: idOld.digest,
              byteLength: idOld.byteLength,
              quarantinedAt: '2026-08-04T00:00:00.000Z',
              status: 'conflict',
              confirmedAtCapture: null,
            },
          },
        },
        rawInvalid: {},
        pendingForeign: null,
        resolutionRequired: [],
      }),
    );

    // The stale tab's release names envelope E's digest (NEW) — not what
    // the slot holds now. It must refuse rather than delete.
    expect(releaseQuarantinedEnvelope(USER_A, 'lists', idNew.digest)).toBe(
      false,
    );
    expect(readQuarantinedAccountContent(USER_A).lists?.data).toEqual(OLD);

    // A release naming the CURRENT digest still works.
    expect(releaseQuarantinedEnvelope(USER_A, 'lists', idOld.digest)).toBe(
      true,
    );
    expect(readQuarantinedAccountContent(USER_A).lists).toBeUndefined();
  });

  test('a stale update naming a DIFFERENT digest is a no-op — no resurrection over a changed slot', async () => {
    const { updateQuarantinedEnvelope } = await import(
      '@/lib/accountContent.quarantine'
    );
    const idOld = contentIdentity(OLD);
    const idNew = contentIdentity(NEW);
    const promoted = {
      data: OLD,
      clientUpdatedAt: '2026-08-02T00:00:00.000Z',
      digest: idOld.digest,
      byteLength: idOld.byteLength,
      quarantinedAt: '2026-08-04T00:00:00.000Z',
      status: 'conflict' as const,
      confirmedAtCapture: null,
    };
    window.localStorage.setItem(
      ACCOUNT_CONTENT_QUARANTINE_KEY,
      JSON.stringify({
        version: 2,
        accounts: { [USER_A]: { lists: promoted } },
        rawInvalid: {},
        pendingForeign: null,
        resolutionRequired: [],
      }),
    );
    const staleEnvelope = {
      data: NEW,
      clientUpdatedAt: '2026-08-05T00:00:00.000Z',
      digest: idNew.digest,
      byteLength: idNew.byteLength,
      quarantinedAt: '2026-08-05T00:00:00.000Z',
      status: 'conflict' as const,
      confirmedAtCapture: null,
    };

    expect(
      updateQuarantinedEnvelope(USER_A, 'lists', staleEnvelope, idNew.digest),
    ).toBe(false);
    expect(readQuarantinedAccountContent(USER_A).lists?.data).toEqual(OLD);
  });

  test('single-key raw-invalid capture SUPERSEDES the prior raw entry instead of destroying it', () => {
    const OLD_RAW = '{old corrupt bytes';
    const OLDER_RAW = '{even older corrupt bytes';
    const NEW_RAW = '{new corrupt bytes';
    window.localStorage.setItem(LISTS_KEY, NEW_RAW);
    window.localStorage.setItem(
      ACCOUNT_CONTENT_QUARANTINE_KEY,
      JSON.stringify({
        version: 2,
        accounts: {},
        rawInvalid: {
          [USER_A]: {
            lists: {
              raw: OLD_RAW,
              capturedAt: '2026-08-04T00:00:00.000Z',
              superseded: [
                {
                  raw: OLDER_RAW,
                  capturedAt: '2026-08-03T00:00:00.000Z',
                  supersededAt: '2026-08-04T00:00:00.000Z',
                },
              ],
            },
          },
        },
        pendingForeign: null,
        resolutionRequired: [],
      }),
    );

    expect(quarantineRawInvalidContent(USER_A, 'lists')).toBe(true);

    const rawEnvelope = readQuarantineStore().rawInvalid[USER_A]?.lists;
    expect(rawEnvelope?.raw).toBe(NEW_RAW);
    // Both prior copies survive in the chain.
    expect(rawEnvelope?.superseded?.some((s) => s.raw === OLD_RAW)).toBe(true);
    expect(rawEnvelope?.superseded?.some((s) => s.raw === OLDER_RAW)).toBe(
      true,
    );
  });

  test('divergent raw invalid text is superseded, never destroyed', () => {
    const OLD_RAW = '{old corrupt bytes';
    const NEW_RAW = '{new corrupt bytes';
    window.localStorage.setItem(LISTS_KEY, NEW_RAW);
    window.localStorage.setItem(ACCOUNT_CONTENT_OWNER_KEY, USER_A);
    window.localStorage.setItem(
      ACCOUNT_CONTENT_QUARANTINE_KEY,
      JSON.stringify({
        version: 2,
        accounts: {},
        rawInvalid: {
          [USER_A]: {
            lists: { raw: OLD_RAW, capturedAt: '2026-08-04T00:00:00.000Z' },
          },
        },
        pendingForeign: null,
        resolutionRequired: [],
      }),
    );

    const result = quarantineAccountContent(USER_A);

    expect(result.ok).toBe(true);
    const rawEnvelope = readQuarantineStore().rawInvalid[USER_A]?.lists;
    expect(rawEnvelope?.raw).toBe(NEW_RAW);
    expect(rawEnvelope?.superseded?.some((s) => s.raw === OLD_RAW)).toBe(true);
  });
});

describe('santa round-1 hardening (Codex lane findings)', () => {
  test('recovery of a stale P3 journal PRESERVES live content that changed after the commit', () => {
    // Crash left a committed journal for OLD; a concurrent tab then wrote
    // NEW into the live key. Recovery must not delete the only copy of NEW.
    const OLD = LISTS;
    const NEW = [{ ...LISTS[0], barIds: ['attaboy', 'death-and-co'] }];
    const idOld = contentIdentity(OLD);
    window.localStorage.setItem(LISTS_KEY, JSON.stringify(NEW));
    window.localStorage.setItem(ACCOUNT_CONTENT_OWNER_KEY, USER_A);
    window.localStorage.setItem(
      ACCOUNT_CONTENT_QUARANTINE_KEY,
      JSON.stringify({
        version: 2,
        accounts: {
          [USER_A]: {
            lists: {
              data: OLD,
              clientUpdatedAt: '2026-08-02T00:00:00.000Z',
              digest: idOld.digest,
              byteLength: idOld.byteLength,
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
      JSON.stringify({
        version: 1,
        ownerUserId: USER_A,
        phase: 'P3',
        startedAt: '2026-08-05T00:00:00.000Z',
        pending: {
          lists: {
            data: OLD,
            clientUpdatedAt: '2026-08-02T00:00:00.000Z',
            digest: idOld.digest,
            byteLength: idOld.byteLength,
            quarantinedAt: '2026-08-05T00:00:00.000Z',
            status: 'quarantined',
          },
        },
        pendingRaw: {},
      }),
    );

    recoverQuarantineJournal();

    // BOTH copies survive: NEW stays live, OLD stays enveloped.
    expect(window.localStorage.getItem(LISTS_KEY)).toBe(JSON.stringify(NEW));
    expect(readQuarantinedAccountContent(USER_A).lists?.data).toEqual(OLD);
    // The owner marker must NOT have been removed (residue stays owned).
    expect(window.localStorage.getItem(ACCOUNT_CONTENT_OWNER_KEY)).toBe(USER_A);
    const store = readQuarantineStore();
    expect(
      store.resolutionRequired.some((e) => e.key === 'lists'),
    ).toBe(true);
  });

  test('a content-key removal failure keeps the OWNER MARKER (residue never turns anonymous)', () => {
    seedLiveContent();
    const original = Storage.prototype.removeItem;
    const spy = vi
      .spyOn(Storage.prototype, 'removeItem')
      .mockImplementation(function (this: Storage, key: string) {
        if (key === LISTS_KEY) throw new DOMException('denied', 'SecurityError');
        original.call(this, key);
      });
    try {
      quarantineAccountContent(USER_A);
    } finally {
      spy.mockRestore();
    }
    // The lists key could not be removed — the owner marker must survive so
    // the surviving residue can never be adopted as anonymous data.
    expect(window.localStorage.getItem(LISTS_KEY)).toBe(JSON.stringify(LISTS));
    expect(window.localStorage.getItem(ACCOUNT_CONTENT_OWNER_KEY)).toBe(USER_A);
    // The preserved copy still exists for when removal becomes possible.
    expect(readQuarantinedAccountContent(USER_A).lists?.data).toEqual(LISTS);
  });

  test('an unrecognized store VERSION is never clobbered by a later write', () => {
    window.localStorage.setItem(
      ACCOUNT_CONTENT_QUARANTINE_KEY,
      JSON.stringify({ version: 1, accounts: { [USER_A]: { lists: { data: LISTS } } } }),
    );
    expect(setPendingForeign(USER_B)).toBe(false);
    // Original bytes intact.
    expect(
      (JSON.parse(
        window.localStorage.getItem(ACCOUNT_CONTENT_QUARANTINE_KEY) ?? '{}',
      ) as { version?: number }).version,
    ).toBe(1);
  });

  test('raw-invalid capture re-checks the live key and spares a concurrent correction', () => {
    window.localStorage.setItem(LISTS_KEY, '{broken');
    const original = Storage.prototype.getItem;
    let contentReads = 0;
    const spy = vi
      .spyOn(Storage.prototype, 'getItem')
      .mockImplementation(function (this: Storage, key: string) {
        if (key === LISTS_KEY) {
          contentReads += 1;
          // First read captures the invalid text; by the pre-removal
          // re-check a concurrent tab has corrected the value.
          if (contentReads > 1) return JSON.stringify(LISTS);
          return '{broken';
        }
        return original.call(this, key);
      });
    try {
      expect(quarantineRawInvalidContent(USER_A, 'lists')).toBe(false);
    } finally {
      spy.mockRestore();
    }
    // The corrected value was never removed.
    expect(window.localStorage.getItem(LISTS_KEY)).toBe('{broken');
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
