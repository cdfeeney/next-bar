'use client';

import { useEffect, useState } from 'react';
import { getBrowserSupabase } from '@/lib/supabase/client';
import { replaceCatalog } from '@/lib/catalog';
import { rowsToCatalog, type BarsTableRow } from '@/lib/catalogServer';

/**
 * Server-backed catalog refresh (0019 swap — mass-import prerequisite).
 * Mounted once in the root layout; AFTER hydration (Codex addendum: a
 * pre-hydration swap makes SSR/browser snapshots mismatch) it fetches the
 * `bars` table and swaps it in via replaceCatalog. The bundled
 * fallback is only the tiny curated core. Fetch or validation failure
 * reports that degraded state instead of pretending the full catalog loaded.
 *
 * PHONE SPEED (operator 2026-07-27): `select('*')` pulled 833 KB on every
 * load. Two of those columns the app never reads at all (created_at,
 * updated_at, source = 56 KB) and `reviews` (155 KB) is rendered only in
 * the lightbox, for one bar at a time — it now loads on demand via
 * lib/barReviews. Naming the columns explicitly also means a future
 * column (photos blob, embeddings) can't silently re-inflate this fetch.
 */

/** Discovery/map/matching fields only; presentation details load on open. */
const CATALOG_COLUMNS =
  'id,name,lat,lng,tags,neighborhood,price_tier,hours,place_id,business_status,last_verified';

/**
 * PostgREST caps EVERY response at 1,000 rows — silently, with a 200 and
 * no error field. The catalog crossed 1,000 venues on 2026-07-27, so an
 * unpaginated select would have quietly dropped every bar past the
 * thousandth and the app would have looked completely fine while doing
 * it. Page explicitly and keep going until a short page proves the end.
 */
const PAGE = 1000;

export default function CatalogRefresh(): JSX.Element | null {
  const [status, setStatus] = useState<'loading' | 'ready' | 'fallback'>('loading');
  useEffect(() => {
    const supabase = getBrowserSupabase();
    if (!supabase) {
      setStatus('fallback');
      return;
    }
    let cancelled = false;
    void (async () => {
      const all: BarsTableRow[] = [];
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await supabase
          .from('bars')
          .select(CATALOG_COLUMNS)
          // Stable order is REQUIRED for correct paging — without it
          // Postgres may return rows in a different order per request and
          // pages can overlap or skip.
          .order('id', { ascending: true })
          .range(from, from + PAGE - 1);
        if (cancelled) return;
        if (error || !Array.isArray(data)) {
          setStatus('fallback');
          return;
        }
        all.push(...(data as BarsTableRow[]));
        if (data.length < PAGE) break;
      }
      const next = rowsToCatalog(all);
      if (cancelled) return;
      if (next === null) {
        setStatus('fallback');
        return;
      }
      replaceCatalog(next);
      setStatus('ready');
    })().catch(() => {
      if (!cancelled) setStatus('fallback');
    });
    return () => {
      cancelled = true;
    };
  }, []);
  if (status === 'ready') return null;
  return (
    <p
      role={status === 'loading' ? 'status' : 'alert'}
      className="fixed inset-x-4 bottom-[calc(76px+env(safe-area-inset-bottom))] z-[1400] mx-auto max-w-md rounded-full border border-border bg-surface/95 px-4 py-2 text-center text-xs text-muted shadow-lg"
    >
      {status === 'loading'
        ? 'Loading the Manhattan catalog…'
        : 'Catalog refresh unavailable — showing the emergency set.'}
    </p>
  );
}
