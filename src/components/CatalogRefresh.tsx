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
 *
 * PHONE SPEED, AGAIN (owner 2026-09-17, T-01c): the catalog crossed 2,000
 * rows and every visit waited for THREE serial 1,000-row pages before real
 * results could settle — measured 11.3 s cold / 3.8 s warm on a throttled
 * phone against staging. Two changes, both measured:
 *   1. The last good row set is kept in localStorage and swapped in at mount,
 *      so a returning visitor paints the full catalog before any request.
 *   2. Page 0 carries the exact count, and every remaining page is fetched
 *      at once instead of one after another.
 * ponytail: the refresh still runs on every visit; a `bars_version` column
 * and a conditional fetch would turn a no-change visit into one HEAD.
 */

/** Discovery/map/matching fields only; presentation details load on open. */
const CATALOG_COLUMNS =
  'id,name,lat,lng,tags,neighborhood,price_tier,hours,place_id,business_status,last_verified';

/**
 * PostgREST caps EVERY response at 1,000 rows — silently, with a 200 and
 * no error field. The catalog crossed 1,000 venues on 2026-07-27, so an
 * unpaginated select would have quietly dropped every bar past the
 * thousandth and the app would have looked completely fine while doing
 * it. Page explicitly; the exact count on page 0 says how many more.
 */
const PAGE = 1000;

export const CATALOG_SNAPSHOT_KEY = 'next-bar:catalog:v1';
/** Older than this and the snapshot is ignored: the catalog drifts weekly. */
export const CATALOG_SNAPSHOT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

type Snapshot = { savedAt: number; rows: BarsTableRow[] };

/** Storage can be absent, full, or private; every failure is just the cold path. */
function readSnapshot(now: number): BarsTableRow[] | null {
  try {
    const raw = window.localStorage.getItem(CATALOG_SNAPSHOT_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const { savedAt, rows } = parsed as Partial<Snapshot>;
    if (typeof savedAt !== 'number' || !Array.isArray(rows)) return null;
    if (now - savedAt > CATALOG_SNAPSHOT_MAX_AGE_MS) return null;
    return rows;
  } catch {
    return null;
  }
}

function writeSnapshot(rows: BarsTableRow[], now: number): void {
  try {
    const snapshot: Snapshot = { savedAt: now, rows };
    window.localStorage.setItem(CATALOG_SNAPSHOT_KEY, JSON.stringify(snapshot));
  } catch {
    // Quota or private mode: the next visit is simply cold again.
  }
}

type PageResult = { data: BarsTableRow[] | null; error: unknown; count?: number | null };

export default function CatalogRefresh(): JSX.Element | null {
  const [status, setStatus] = useState<'loading' | 'ready' | 'fallback'>('loading');
  useEffect(() => {
    const supabase = getBrowserSupabase();
    if (!supabase) {
      setStatus('fallback');
      return;
    }
    let cancelled = false;

    // 1. Snapshot first: a returning visitor never sees the emergency set.
    const snapshot = readSnapshot(Date.now());
    const snapshotCatalog = snapshot ? rowsToCatalog(snapshot) : null;
    const hasSnapshot = snapshotCatalog !== null;
    if (snapshotCatalog) {
      replaceCatalog(snapshotCatalog);
      setStatus('ready');
    }
    // A failed refresh degrades to the snapshot when there is one, and to the
    // emergency set (with the pill) when there is not.
    const fail = () => {
      if (!cancelled && !hasSnapshot) setStatus('fallback');
    };

    void (async () => {
      // Stable order is REQUIRED for correct paging — without it Postgres may
      // return rows in a different order per request and pages can overlap.
      const first = (await supabase
        .from('bars')
        .select(CATALOG_COLUMNS, { count: 'exact' })
        .order('id', { ascending: true })
        .range(0, PAGE - 1)) as PageResult;
      if (cancelled) return;
      if (first.error || !Array.isArray(first.data)) {
        fail();
        return;
      }
      const page = (from: number) =>
        supabase
          .from('bars')
          .select(CATALOG_COLUMNS)
          .order('id', { ascending: true })
          .range(from, from + PAGE - 1) as unknown as Promise<PageResult>;
      const all: BarsTableRow[] = [...first.data];
      if (typeof first.count === 'number') {
        // 2. Every remaining page at once.
        const rest: Promise<PageResult>[] = [];
        for (let from = PAGE; from < first.count; from += PAGE) rest.push(page(from));
        const pages = await Promise.all(rest);
        if (cancelled) return;
        if (pages.some((p) => p.error || !Array.isArray(p.data))) {
          fail();
          return;
        }
        all.push(...pages.flatMap((p) => p.data as BarsTableRow[]));
        // The catalog changed between the count and the pages: never swap in
        // a set with a hole or a duplicate in it.
        if (all.length !== first.count) {
          fail();
          return;
        }
      } else if (first.data.length === PAGE) {
        // No count header (a proxy or a stub that strips it): page serially
        // until a short page proves the end, exactly as before.
        for (let from = PAGE; ; from += PAGE) {
          const next = await page(from);
          if (cancelled) return;
          if (next.error || !Array.isArray(next.data)) {
            fail();
            return;
          }
          all.push(...next.data);
          if (next.data.length < PAGE) break;
        }
      }
      const next = rowsToCatalog(all);
      if (next === null) {
        fail();
        return;
      }
      replaceCatalog(next);
      writeSnapshot(all, Date.now());
      setStatus('ready');
    })().catch(fail);
    return () => {
      cancelled = true;
    };
  }, []);
  if (status === 'ready') return null;
  return (
    <p
      role="status"
      className="pointer-events-none fixed inset-x-4 bottom-[calc(76px+env(safe-area-inset-bottom))] z-[1400] mx-auto max-w-md rounded-full border border-border bg-surface/95 px-4 py-2 text-center text-xs text-muted shadow-lg"
    >
      {status === 'loading'
        ? 'Loading the Manhattan catalog…'
        : 'Catalog refresh unavailable — showing the emergency set.'}
    </p>
  );
}
