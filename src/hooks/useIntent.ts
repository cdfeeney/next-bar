'use client';

import { useCallback, useEffect, useState } from 'react';
import type { IntentStatus, TonightIntent } from '@/lib/intent';
import {
  clearIntent as clearIntentLib,
  loadIntent,
  setIntent as setIntentLib,
} from '@/lib/intent';

const KEY = 'next-bar:intent:v1';

export type UseIntentReturn = {
  intent: TonightIntent | null;
  /** Set your status; tapping the active status again clears it. */
  toggleIntent: (status: IntentStatus) => void;
};

/**
 * Your "tonight" intent over src/lib/intent.ts. Same shape as useLists:
 * hydrate after mount (SSR renders null), stay in sync via the lib's
 * synthesized `storage` events.
 */
export function useIntent(): UseIntentReturn {
  const [intent, setIntent] = useState<TonightIntent | null>(null);

  useEffect(() => {
    setIntent(loadIntent());
    const onStorage = (event: StorageEvent): void => {
      if (event.key !== null && event.key !== KEY) return;
      setIntent(loadIntent());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const toggleIntent = useCallback((status: IntentStatus): void => {
    const current = loadIntent();
    if (current?.status === status) {
      clearIntentLib();
    } else {
      setIntentLib(status);
    }
    setIntent(loadIntent());
  }, []);

  return { intent, toggleIntent };
}
