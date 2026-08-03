'use client';

import { useEffect } from 'react';
import {
  createPostHogAdapter,
  registerAdapter,
} from '@/lib/analyticsAdapters';

/**
 * Lazy, SSR-safe adapter registration (g-ee6c250d crit 6/7/16): mounted
 * once in the root layout, registers the PostHog adapter AFTER hydration
 * from a client effect — never as an import side effect. Registration
 * alone touches no network: the adapter's capture() checks the triple
 * PostHog gate (flag + key + host, none present in any environment) and
 * every dispatch re-checks the master NEXT_PUBLIC_ANALYTICS gate.
 * registerAdapter dedupes by name, so StrictMode's double-mount cannot
 * register twice.
 */
export default function AnalyticsInit(): null {
  useEffect(() => {
    registerAdapter(createPostHogAdapter());
  }, []);
  return null;
}
