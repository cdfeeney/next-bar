import type { Bar } from '@/types';
import { getBarById } from '@/lib/catalog';
import { rowToBar, type BarsTableRow } from '@/lib/catalogServer';

/**
 * Server-side single-bar lookup that sees IMPORTED bars.
 *
 * The bug this fixes: /share/[barId] resolved through the static bundle
 * catalog only, so every link to one of the ~350 mass-imported venues
 * 404'd — i.e. the Send feature was broken for nearly half the catalog,
 * and silently, because the sender sees a valid card before tapping Send.
 * CatalogRefresh solves this on the CLIENT, but a share link is opened
 * cold by a RECIPIENT and is server-rendered.
 *
 * Static bundle first (synchronous, zero network), then the bars table
 * over PostgREST with the ANON key — the same read the browser client
 * makes, so it needs no service role and stays inside the public RLS
 * policy. Rows go through the same rowToBar boundary validation as the
 * client swap: an invalid row degrades to "not found", never to a
 * half-rendered page.
 */

const ID_RE = /^[a-z0-9-]{1,60}$/;

/** Columns the share surfaces actually render (keep in sync with rowToBar). */
const SHARE_COLUMNS =
  'id,name,lat,lng,tags,neighborhood,price_tier,hours,blurb,address,place_id,business_status,photo_count,photo_attributions,last_verified,hours_source,hours_confidence,hours_verified_at';

export async function getBarByIdServer(id: string): Promise<Bar | undefined> {
  const local = getBarById(id);
  if (local) return local;

  // Reject anything that can't be a real id BEFORE building a query.
  if (!ID_RE.test(id)) return undefined;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return undefined;

  try {
    const res = await fetch(
      `${url}/rest/v1/bars?id=eq.${id}&select=${SHARE_COLUMNS}&limit=1`,
      {
        headers: { apikey: key, Authorization: `Bearer ${key}` },
        // Shared links are hot for a few hours and the row is stable —
        // cache at the edge so a group blowing up one link is one read.
        next: { revalidate: 300 },
      },
    );
    if (!res.ok) return undefined;
    const rows: unknown = await res.json();
    if (!Array.isArray(rows) || rows.length === 0) return undefined;
    return rowToBar(rows[0] as BarsTableRow) ?? undefined;
  } catch {
    // Network/DNS failure on a share page must render "not found", not 500.
    return undefined;
  }
}
