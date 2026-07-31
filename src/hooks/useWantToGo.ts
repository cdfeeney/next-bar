'use client';

import { useCallback, useEffect, useState } from 'react';
import type { WantToGoEntry } from '@/lib/wantToGo';
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
  add: (barId: string) => void;
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
    const onStorage = (event: StorageEvent): void => {
      if (event.key !== null && event.key !== WANT_TO_GO_KEY) return;
      setEntries(loadWantToGo());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const add = useCallback((barId: string): void => {
    addLib(barId);
    setEntries(loadWantToGo());
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
