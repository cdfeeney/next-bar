// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  WANT_TO_GO_KEY,
  addWantToGo,
  loadWantToGo,
  pruneWantToGo,
  removeWantToGo,
} from '@/lib/wantToGo';

describe('wantToGo (QA5-S2)', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('starts empty and round-trips an add', () => {
    expect(loadWantToGo()).toEqual([]);
    addWantToGo('attaboy');
    const entries = loadWantToGo();
    expect(entries).toHaveLength(1);
    expect(entries[0].barId).toBe('attaboy');
    // addedAt is a real ISO timestamp.
    expect(Number.isNaN(new Date(entries[0].addedAt).getTime())).toBe(false);
  });

  it('writes the fixed cross-slice contract shape under the fixed key', () => {
    addWantToGo('attaboy');
    const raw = window.localStorage.getItem('next-bar:list:want-to-go:v1');
    expect(WANT_TO_GO_KEY).toBe('next-bar:list:want-to-go:v1');
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw as string) as unknown[];
    expect(parsed).toEqual([
      { barId: 'attaboy', addedAt: expect.any(String) },
    ]);
  });

  it('dedups by barId — re-adding is a no-op that keeps the original addedAt', () => {
    addWantToGo('attaboy');
    const first = loadWantToGo()[0];
    addWantToGo('attaboy');
    expect(loadWantToGo()).toEqual([first]);
  });

  it('preserves oldest-first insertion order across multiple adds', () => {
    addWantToGo('attaboy');
    addWantToGo('death-and-co');
    expect(loadWantToGo().map((e) => e.barId)).toEqual([
      'attaboy',
      'death-and-co',
    ]);
  });

  it('remove drops only the matching bar; unknown ids are no-ops', () => {
    addWantToGo('attaboy');
    addWantToGo('death-and-co');
    removeWantToGo('attaboy');
    expect(loadWantToGo().map((e) => e.barId)).toEqual(['death-and-co']);
    removeWantToGo('nope');
    expect(loadWantToGo().map((e) => e.barId)).toEqual(['death-and-co']);
  });

  it('corrupt storage reads as [], never throws', () => {
    window.localStorage.setItem(WANT_TO_GO_KEY, '{not json');
    expect(loadWantToGo()).toEqual([]);
    window.localStorage.setItem(WANT_TO_GO_KEY, JSON.stringify({ nope: 1 }));
    expect(loadWantToGo()).toEqual([]);
  });

  it('salvages valid entries from a partially-corrupt array (shared key — never nuke the list)', () => {
    window.localStorage.setItem(
      WANT_TO_GO_KEY,
      JSON.stringify([
        { barId: 'attaboy', addedAt: '2026-07-26T01:00:00.000Z' },
        { barId: 42, addedAt: 'x' }, // malformed — dropped
        'garbage', // malformed — dropped
        { barId: 'attaboy', addedAt: '2026-07-26T02:00:00.000Z' }, // dupe — first wins
        { barId: 'death-and-co', addedAt: '2026-07-26T03:00:00.000Z' },
      ]),
    );
    expect(loadWantToGo()).toEqual([
      { barId: 'attaboy', addedAt: '2026-07-26T01:00:00.000Z' },
      { barId: 'death-and-co', addedAt: '2026-07-26T03:00:00.000Z' },
    ]);
  });

  it('pruneWantToGo drops rated bars in one pass and no-ops otherwise', () => {
    addWantToGo('attaboy');
    addWantToGo('death-and-co');
    pruneWantToGo(new Set(['attaboy', 'unrelated']));
    expect(loadWantToGo().map((e) => e.barId)).toEqual(['death-and-co']);
    // Nothing matching → storage untouched.
    const before = window.localStorage.getItem(WANT_TO_GO_KEY);
    pruneWantToGo(new Set(['still-unrelated']));
    expect(window.localStorage.getItem(WANT_TO_GO_KEY)).toBe(before);
  });

  it('writes dispatch a storage event keyed to the contract key (notifyChange)', () => {
    const keys: Array<string | null> = [];
    const onStorage = (event: StorageEvent): void => {
      keys.push(event.key);
    };
    window.addEventListener('storage', onStorage);
    try {
      addWantToGo('attaboy');
      removeWantToGo('attaboy');
    } finally {
      window.removeEventListener('storage', onStorage);
    }
    expect(keys).toEqual([WANT_TO_GO_KEY, WANT_TO_GO_KEY]);
  });
});
