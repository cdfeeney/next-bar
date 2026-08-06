// @vitest-environment jsdom
import { beforeEach, describe, expect, test } from 'vitest';
import { clearAccountCache } from '@/lib/accountCache';
import { ACCOUNT_CONTENT_OWNER_KEY } from '@/lib/accountContent.local';
import { readQuarantinedAccountContent } from '@/lib/accountContent.quarantine';

const USER_A = 'aaaaaaaa-1111-2222-3333-444444444444';
const ARCHIVE_KEY = 'next-bar:night-archive:v1';
const RATINGS_KEY = 'next-bar:ratings:v1';

const ARCHIVE = [
  {
    nightKey: '2026-07-30',
    visits: [{ barId: 'attaboy', at: '2026-07-31T02:00:00.000Z' }],
  },
];

beforeEach(() => {
  window.localStorage.clear();
});

describe('clearAccountCache — v2.1 fail-into-preservation', () => {
  test('UNSYNCED sign-out preservation: owned account content is quarantined, never deleted', () => {
    // Dirty state: content present, owner known, NO server confirmation.
    window.localStorage.setItem(ARCHIVE_KEY, JSON.stringify(ARCHIVE));
    window.localStorage.setItem(ACCOUNT_CONTENT_OWNER_KEY, USER_A);

    clearAccountCache();

    // Preserved under its owner…
    expect(readQuarantinedAccountContent(USER_A).night_archive?.data).toEqual(
      ARCHIVE,
    );
    // …and no longer live (inert residue).
    expect(window.localStorage.getItem(ARCHIVE_KEY)).toBeNull();
    expect(window.localStorage.getItem(ACCOUNT_CONTENT_OWNER_KEY)).toBeNull();
  });

  test('non-content account keys (ratings) keep the existing wipe', () => {
    window.localStorage.setItem(RATINGS_KEY, JSON.stringify([]));
    window.localStorage.setItem(ACCOUNT_CONTENT_OWNER_KEY, USER_A);
    clearAccountCache();
    expect(window.localStorage.getItem(RATINGS_KEY)).toBeNull();
  });

  test('anonymous content (no owner marker) is not account residue and survives', () => {
    window.localStorage.setItem(ARCHIVE_KEY, JSON.stringify(ARCHIVE));
    clearAccountCache();
    expect(window.localStorage.getItem(ARCHIVE_KEY)).toBe(
      JSON.stringify(ARCHIVE),
    );
    expect(readQuarantinedAccountContent(USER_A)).toEqual({});
  });
});
