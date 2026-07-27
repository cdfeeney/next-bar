import type { Bar } from '@/types';
import { getBrowserSupabase } from '@/lib/supabase/client';

/**
 * On-demand Google-review fetch for ONE bar.
 *
 * Why this exists: `reviews` is 155 KB of the 833 KB the catalog refresh
 * used to pull on every single page load — for a field rendered in
 * exactly one place, the lightbox, for whichever single bar the user
 * opened. Fetching it per-bar-on-open moves that weight off the phone's
 * critical path entirely; the cost is one tiny query when a card is
 * expanded, by which point the app is already interactive.
 *
 * Static-bundle bars keep their sidecar reviews and never reach here.
 */

const ID_RE = /^[a-z0-9-]{1,60}$/;
const cache = new Map<string, Bar['reviews']>();

export async function fetchBarReviews(id: string): Promise<Bar['reviews']> {
  if (!ID_RE.test(id)) return undefined;
  // has(), not get() !== undefined: a bar with NO reviews caches as
  // `undefined`, and a value-based check would treat that hit as a miss
  // and re-query it on every single open.
  if (cache.has(id)) return cache.get(id);

  const supabase = getBrowserSupabase();
  if (!supabase) return undefined;
  const { data, error } = await supabase
    .from('bars')
    .select('reviews')
    .eq('id', id)
    .maybeSingle();
  if (error || !data) return undefined;

  const reviews = (data as { reviews: Bar['reviews'] }).reviews ?? undefined;
  // Cache the miss too — a bar with no reviews shouldn't re-query on
  // every open.
  cache.set(id, reviews);
  return reviews;
}

/** Test seam. */
export function clearReviewCache(): void {
  cache.clear();
}
