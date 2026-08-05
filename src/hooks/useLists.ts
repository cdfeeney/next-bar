'use client';

import { useCallback, useEffect, useState } from 'react';
import type { BarList } from '@/lib/lists';
import {
  addBarToList as addBarLib,
  createList as createListLib,
  deleteList as deleteListLib,
  loadLists,
  removeBarFromList as removeBarLib,
} from '@/lib/lists';

import { LISTS_KEY } from '@/lib/lists';
import { ensureWantToGoFolded } from '@/lib/wantToGo';

const KEY = LISTS_KEY;

export type UseListsReturn = {
  lists: BarList[];
  createList: (name: string) => BarList | null;
  deleteList: (id: string) => void;
  /** Returns whether a NEW membership was written (false = duplicate/unknown). */
  addBarToList: (id: string, barId: string) => boolean;
  removeBarFromList: (id: string, barId: string) => void;
};

/**
 * Local-only lists state over src/lib/lists.ts. Mirrors useRatings'
 * local mode: hydrate from localStorage after mount (SSR renders []),
 * then stay in sync via the lib's synthesized `storage` events so every
 * mounted consumer sees writes from any other.
 */
export function useLists(): UseListsReturn {
  const [lists, setLists] = useState<BarList[]>([]);

  useEffect(() => {
    // Fold any legacy Want-to-go store into the lists model BEFORE the
    // first read — /lists and every other lists consumer must see the
    // reserved list on an upgraded device, not only after a want-to-go
    // surface happened to mount first (santa: Codex, g-ac3a291c).
    ensureWantToGoFolded();
    setLists(loadLists());
    const onStorage = (event: StorageEvent): void => {
      if (event.key !== null && event.key !== KEY) return;
      setLists(loadLists());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const createList = useCallback((name: string): BarList | null => {
    const created = createListLib(name);
    setLists(loadLists());
    return created;
  }, []);

  const deleteList = useCallback((id: string): void => {
    deleteListLib(id);
    setLists(loadLists());
  }, []);

  const addBarToList = useCallback((id: string, barId: string): boolean => {
    const wrote = addBarLib(id, barId);
    setLists(loadLists());
    return wrote;
  }, []);

  const removeBarFromList = useCallback((id: string, barId: string): void => {
    removeBarLib(id, barId);
    setLists(loadLists());
  }, []);

  return { lists, createList, deleteList, addBarToList, removeBarFromList };
}
