'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { IntentStatus, TonightIntent } from '@/lib/intent';
import {
  clearIntent as clearIntentLib,
  loadIntent,
  setIntent as setIntentLib,
} from '@/lib/intent';

const KEY = 'next-bar:intent:v1';

/** How often an open tab re-checks the clock for the 5am rollover (F5). */
const NIGHT_REFRESH_INTERVAL_MS = 60_000;

export type UseIntentReturn = {
  intent: TonightIntent | null;
  /** Set your status; tapping the active status again clears it. */
  toggleIntent: (status: IntentStatus) => void;
};

/**
 * Fire `refresh` once after mount, then every minute and whenever the tab
 * becomes visible again — the shared "the clock moved" signal that catches
 * the midnight/5am rollover while a tab stays open (F5). Used here to
 * expire stale intents, and by every other nightKey-scoped consumer
 * (phase home, tonight-exclusion, the /friends Tonight strip).
 */
export function useNightRefresh(refresh: () => void): void {
  // Latest-callback ref so a new closure each render doesn't tear down
  // and re-register the interval/listener.
  const refreshRef = useRef(refresh);
  useEffect(() => {
    refreshRef.current = refresh;
  });

  useEffect(() => {
    const run = (): void => refreshRef.current();
    run();
    const timer = window.setInterval(run, NIGHT_REFRESH_INTERVAL_MS);
    const onVisibilityChange = (): void => {
      if (document.visibilityState === 'visible') run();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);
}

/** Keep the previous object when nothing changed so refresh ticks don't re-render. */
function reconcileIntent(
  prev: TonightIntent | null,
  next: TonightIntent | null,
): TonightIntent | null {
  if (prev?.status === next?.status && prev?.setAt === next?.setAt) {
    return prev;
  }
  return next;
}

/**
 * Your "tonight" intent over src/lib/intent.ts. Same shape as useLists:
 * hydrate after mount (SSR renders null), stay in sync via the lib's
 * synthesized `storage` events, and re-evaluate expiry on the night-refresh
 * signal so a stale chip visually clears at 5am without a reload (F5).
 */
export function useIntent(): UseIntentReturn {
  const [intent, setIntent] = useState<TonightIntent | null>(null);

  useNightRefresh(() => {
    setIntent((prev) => reconcileIntent(prev, loadIntent()));
  });

  useEffect(() => {
    const onStorage = (event: StorageEvent): void => {
      if (event.key !== null && event.key !== KEY) return;
      setIntent(loadIntent());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  // Decide set-vs-clear from the DISPLAYED state, not a fresh load: after
  // the 5am rollover a still-lit chip loads as null (expired), and the old
  // load-then-decide flow would SET a fresh intent instead of clearing (F5).
  const toggleIntent = useCallback(
    (status: IntentStatus): void => {
      if (intent?.status === status) {
        clearIntentLib();
        setIntent(null);
      } else {
        setIntentLib(status);
        setIntent(loadIntent());
      }
    },
    [intent],
  );

  return { intent, toggleIntent };
}
