'use client';

import { useCallback, useEffect, useState } from 'react';
import type { WantToGoEntry } from '@/lib/wantToGo';
import { LISTS_KEY } from '@/lib/lists';
import {
  WANT_TO_GO_KEY,
  addWantToGo as addLib,
  loadWantToGo,
  pruneWantToGo as pruneLib,
  removeWantToGo as removeLib,
} from '@/lib/wantToGo';

export type UseWantToGoReturn = {
  /** Oldest-first saved bars. [] until mounted (SSR renders empty). */
  entries: WantToGoEntry[];
  /** Returns whether a NEW save was written (false = already saved / failed). */
  add: (barId: string) => boolean;
  remove: (barId: string) => void;
  /** Drop every entry that's since been rated (see lib docs). */
  pruneRated: (ratedBarIds: ReadonlySet<string>) => void;
};

/**
 * Local want-to-go state over src/lib/wantToGo.ts. Mirrors useLists:
 * hydrate from localStorage after mount, then stay in sync via `storage`
 * events (both real cross-tab ones and the lib's synthesized same-tab
 * ones) so every mounted consumer sees writes from any other.
 *
 * That justification used to name "the parallel /discover slice writing the
 * same contract key" as the reason the listener is needed. It is no longer
 * true: /discover was archived (goal g-12d33864) and it held the only
 * `addWantToGo` call site, so nothing in the app writes this key today and
 * `add` below has no caller. The listener still earns its place for the real
 * cross-TAB case, but do not treat it as evidence of a second writer.
 */
export function useWantToGo(): UseWantToGoReturn {
  const [entries, setEntries] = useState<WantToGoEntry[]>([]);

  useEffect(() => {
    setEntries(loadWantToGo());
    // Both keys: the facade's own legacy-contract key AND the lists store
    // key — the saves now LIVE in the lists model (g-ac3a291c), so a
    // removal made on /lists or the rankings switcher must refresh every
    // mounted want-to-go consumer too.
    const onStorage = (event: StorageEvent): void => {
      if (
        event.key !== null &&
        event.key !== WANT_TO_GO_KEY &&
        event.key !== LISTS_KEY
      ) {
        return;
      }
      setEntries(loadWantToGo());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const add = useCallback((barId: string): boolean => {
    const wrote = addLib(barId);
    setEntries(loadWantToGo());
    return wrote;
  }, []);

  const remove = useCallback((barId: string): void => {
    removeLib(barId);
    setEntries(loadWantToGo());
  }, []);

  const pruneRated = useCallback(
    (ratedBarIds: ReadonlySet<string>): void => {
      pruneLib(ratedBarIds);
      setEntries(loadWantToGo());
    },
    [],
  );

  return { entries, add, remove, pruneRated };
}
