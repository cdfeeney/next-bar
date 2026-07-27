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
 *
 * PHONE SPEED (operator 2026-07-27): `select('*')` pulled 833 KB on every
 * load. Two of those columns the app never reads at all (created_at,
 * updated_at, source = 56 KB) and `reviews` (155 KB) is rendered only in
 * the lightbox, for one bar at a time — it now loads on demand via
 * lib/barReviews. Naming the columns explicitly also means a future
 * column (photos blob, embeddings) can't silently re-inflate this fetch.
 */

/** Exactly the columns rowToBar consumes, minus on-demand `reviews`. */
const CATALOG_COLUMNS =
  'id,name,lat,lng,tags,neighborhood,price_tier,hours,blurb,address,place_id,business_status,photo_count,photo_attributions,last_verified';

/**
 * PostgREST caps EVERY response at 1,000 rows — silently, with a 200 and
 * no error field. The catalog crossed 1,000 venues on 2026-07-27, so an
 * unpaginated select would have quietly dropped every bar past the
 * thousandth and the app would have looked completely fine while doing
 * it. Page explicitly and keep going until a short page proves the end.
 */
const PAGE = 1000;

export default function CatalogRefresh(): null {
  useEffect(() => {
    const supabase = getBrowserSupabase();
    if (!supabase) return;
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
        if (cancelled || error || !Array.isArray(data)) return; // fallback: static
        all.push(...(data as BarsTableRow[]));
        if (data.length < PAGE) break;
      }
      const next = rowsToCatalog(all, getBarsSnapshot().length);
      if (cancelled || next === null) return;
      replaceCatalog(next);
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  return null;
}
