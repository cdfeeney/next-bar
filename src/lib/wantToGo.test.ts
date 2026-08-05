// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  WANT_TO_GO_KEY,
  WANT_TO_GO_LIST_ID,
  addWantToGo,
  loadWantToGo,
  pruneWantToGo,
  purgeWantToGo,
  removeWantToGo,
} from '@/lib/wantToGo';
import { loadLists } from '@/lib/lists';

const LISTS_KEY = 'next-bar:lists:v1';

/**
 * wantToGo — now a facade over the Lists model (goal g-ac3a291c crit 4):
 * the saves live in the reserved 'want-to-go' list inside
 * next-bar:lists:v1, and the legacy fixed-key store folds in exactly once
 * without losing saves. The public API is unchanged so every writer
 * (WantToGoToggle on map/next-bar/search) keeps working untouched.
 */
describe('wantToGo (lists-model facade, g-ac3a291c)', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('starts empty and round-trips an add through the lists store', () => {
    expect(loadWantToGo()).toEqual([]);
    addWantToGo('attaboy');
    expect(loadWantToGo().map((e) => e.barId)).toEqual(['attaboy']);
    // The save lives in the Lists model, not a parallel store.
    const wtg = loadLists().find((l) => l.id === WANT_TO_GO_LIST_ID);
    expect(wtg).toBeDefined();
    expect(wtg!.name).toBe('Want to go');
    expect(wtg!.barIds).toEqual(['attaboy']);
  });

  it('dedups by barId — re-adding is a no-op', () => {
    addWantToGo('attaboy');
    addWantToGo('attaboy');
    expect(loadWantToGo()).toHaveLength(1);
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

  it('pruneWantToGo drops rated bars in one pass and no-ops otherwise', () => {
    addWantToGo('attaboy');
    addWantToGo('death-and-co');
    pruneWantToGo(new Set(['attaboy', 'unrelated']));
    expect(loadWantToGo().map((e) => e.barId)).toEqual(['death-and-co']);
    const before = window.localStorage.getItem(LISTS_KEY);
    pruneWantToGo(new Set(['still-unrelated']));
    expect(window.localStorage.getItem(LISTS_KEY)).toBe(before);
  });

  it('writes dispatch a storage event keyed to the legacy contract key so mounted consumers refresh', () => {
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
    // The lists store fires its own key too — the facade guarantees AT
    // LEAST one event under the want-to-go key per mutating op.
    expect(keys.filter((k) => k === WANT_TO_GO_KEY).length).toBeGreaterThanOrEqual(2);
  });

  describe('legacy migration (crit 4/10 — never lose saves)', () => {
    it('folds the legacy fixed-key entries into the reserved list, oldest-first, and removes the key', () => {
      window.localStorage.setItem(
        WANT_TO_GO_KEY,
        JSON.stringify([
          { barId: 'attaboy', addedAt: '2026-07-01T00:00:00.000Z' },
          { barId: 'death-and-co', addedAt: '2026-07-02T00:00:00.000Z' },
        ]),
      );
      expect(loadWantToGo().map((e) => e.barId)).toEqual([
        'attaboy',
        'death-and-co',
      ]);
      expect(window.localStorage.getItem(WANT_TO_GO_KEY)).toBeNull();
      const wtg = loadLists().find((l) => l.id === WANT_TO_GO_LIST_ID);
      expect(wtg!.barIds).toEqual(['attaboy', 'death-and-co']);
    });

    it('merges legacy entries into an existing reserved list without duplicates', () => {
      addWantToGo('death-and-co'); // creates the reserved list
      window.localStorage.setItem(
        WANT_TO_GO_KEY,
        JSON.stringify([
          { barId: 'attaboy', addedAt: '2026-07-01T00:00:00.000Z' },
          { barId: 'death-and-co', addedAt: '2026-07-02T00:00:00.000Z' },
        ]),
      );
      expect(loadWantToGo().map((e) => e.barId)).toEqual([
        'death-and-co',
        'attaboy',
      ]);
    });

    it('salvages valid entries from a partially-corrupt legacy array and still clears the key', () => {
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
      expect(loadWantToGo().map((e) => e.barId)).toEqual([
        'attaboy',
        'death-and-co',
      ]);
      expect(window.localStorage.getItem(WANT_TO_GO_KEY)).toBeNull();
    });

    it('unparseable legacy JSON reads as empty and the key is cleared', () => {
      window.localStorage.setItem(WANT_TO_GO_KEY, '{not json[');
      expect(loadWantToGo()).toEqual([]);
      expect(window.localStorage.getItem(WANT_TO_GO_KEY)).toBeNull();
    });

    it('a quota-failed lists write must NOT destroy the legacy key (lossless under quota)', () => {
      window.localStorage.setItem(
        WANT_TO_GO_KEY,
        JSON.stringify([{ barId: 'attaboy', addedAt: '2026-07-01T00:00:00.000Z' }]),
      );
      const realSetItem = Storage.prototype.setItem;
      // Simulate a full store: every write throws QuotaExceededError.
      Storage.prototype.setItem = () => {
        throw new DOMException('quota', 'QuotaExceededError');
      };
      try {
        expect(loadWantToGo()).toEqual([]);
      } finally {
        Storage.prototype.setItem = realSetItem;
      }
      // The source of truth survived the failed fold…
      expect(window.localStorage.getItem(WANT_TO_GO_KEY)).not.toBeNull();
      // …and the next call (quota relieved) folds it in losslessly.
      expect(loadWantToGo().map((e) => e.barId)).toEqual(['attaboy']);
      expect(window.localStorage.getItem(WANT_TO_GO_KEY)).toBeNull();
    });

    it('quota failure dispatches NO events — a re-folding listener must not recurse (santa: Codex)', () => {
      window.localStorage.setItem(
        WANT_TO_GO_KEY,
        JSON.stringify([{ barId: 'attaboy', addedAt: '2026-07-01T00:00:00.000Z' }]),
      );
      // A listener that re-enters the fold, exactly like useWantToGo does.
      let listenerCalls = 0;
      const onStorage = (): void => {
        listenerCalls += 1;
        if (listenerCalls > 50) throw new Error('unbounded event recursion');
        loadWantToGo();
      };
      window.addEventListener('storage', onStorage);
      const realSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = () => {
        throw new DOMException('quota', 'QuotaExceededError');
      };
      try {
        loadWantToGo();
      } finally {
        Storage.prototype.setItem = realSetItem;
        window.removeEventListener('storage', onStorage);
      }
      // Failed writes are silent: no event, no recursion, source intact.
      expect(listenerCalls).toBe(0);
      expect(window.localStorage.getItem(WANT_TO_GO_KEY)).not.toBeNull();
    });

    it('purgeWantToGo removes the reserved list AND any un-folded legacy key', () => {
      window.localStorage.setItem(
        WANT_TO_GO_KEY,
        JSON.stringify([{ barId: 'attaboy', addedAt: '2026-07-01T00:00:00.000Z' }]),
      );
      purgeWantToGo();
      expect(window.localStorage.getItem(WANT_TO_GO_KEY)).toBeNull();
      expect(loadWantToGo()).toEqual([]);
      // The delete stays deleted: nothing resurrects the old saves.
      addWantToGo('death-and-co');
      expect(loadWantToGo().map((e) => e.barId)).toEqual(['death-and-co']);
    });

    it('corrupt LISTS storage degrades safely (reads as empty, rebuilds on add)', () => {
      window.localStorage.setItem(LISTS_KEY, '{not json[');
      expect(loadWantToGo()).toEqual([]);
      addWantToGo('attaboy');
      expect(loadWantToGo().map((e) => e.barId)).toEqual(['attaboy']);
    });
  });

  it('named lists are untouched by want-to-go operations', () => {
    window.localStorage.setItem(
      LISTS_KEY,
      JSON.stringify([
        {
          id: 'my-list',
          name: 'Rooftops',
          barIds: ['westlight'],
          createdAt: '2026-07-01T00:00:00.000Z',
          updatedAt: '2026-07-01T00:00:00.000Z',
        },
      ]),
    );
    addWantToGo('attaboy');
    removeWantToGo('attaboy');
    const other = loadLists().find((l) => l.id === 'my-list');
    expect(other!.barIds).toEqual(['westlight']);
  });
});
