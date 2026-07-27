'use client';

import { useEffect } from 'react';
import { getBrowserSupabase } from '@/lib/supabase/client';
import { getBarsSnapshot, replaceCatalog } from '@/lib/catalog';
import { rowsToCatalog, type BarsTableRow } from '@/lib/catalogServer';

/**
 * Server-backed catalog refresh (0019 swap — mass-import prerequisite).
 * Mounted once in the root layout; AFTER hydration (Codex addendum: a
 * pre-hydration swap makes SSR/browser snapshots mismatch) it fetches the
 * `bars` table and swaps it in via replaceCatalog. The static bundle
 * catalog stays the synchronous fallback: fetch failure, validation
 * failure, or an implausibly small row set all leave today's behavior
 * untouched. This is what lets import batches land bars WITHOUT a deploy.
 */
export default function CatalogRefresh(): null {
  useEffect(() => {
    const supabase = getBrowserSupabase();
    if (!supabase) return;
    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase.from('bars').select('*');
      if (cancelled || error || !Array.isArray(data)) return; // fallback: static
      const next = rowsToCatalog(
        data as BarsTableRow[],
        getBarsSnapshot().length,
      );
      if (cancelled || next === null) return;
      replaceCatalog(next);
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  return null;
}
