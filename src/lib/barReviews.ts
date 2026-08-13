import type { Bar } from '@/types';
import { getBrowserSupabase } from '@/lib/supabase/client';

/** Heavy fields fetched only when one bar is opened. */
export type BarDetails = Pick<Bar, 'address' | 'blurb'> &
  Partial<
    Pick<
      Bar,
      'googlePlaceId' | 'photoCount' | 'photoAttributions' | 'reviews'
    >
  >;

type DetailRow = {
  address?: unknown;
  blurb?: unknown;
  place_id?: unknown;
  photo_count?: unknown;
  photo_attributions?: unknown;
  reviews?: unknown;
};

const ID_RE = /^[a-z0-9-]{1,60}$/;
const cache = new Map<string, BarDetails | undefined>();

function rowToDetails(row: DetailRow): BarDetails | undefined {
  if (
    (row.address != null && typeof row.address !== 'string') ||
    (row.blurb != null && typeof row.blurb !== 'string') ||
    (row.place_id != null && typeof row.place_id !== 'string') ||
    (row.photo_count != null &&
      (!Number.isInteger(row.photo_count) || (row.photo_count as number) < 0)) ||
    (row.photo_attributions != null &&
      (!Array.isArray(row.photo_attributions) ||
        !row.photo_attributions.every((value) => typeof value === 'string'))) ||
    (row.reviews != null &&
      (!Array.isArray(row.reviews) ||
        !row.reviews.every(
          (review) =>
            review != null &&
            typeof review === 'object' &&
            typeof (review as { text?: unknown }).text === 'string' &&
            typeof (review as { author?: unknown }).author === 'string' &&
            typeof (review as { rating?: unknown }).rating === 'number',
        )))
  ) {
    return undefined;
  }

  return {
    address: typeof row.address === 'string' ? row.address : '',
    blurb: typeof row.blurb === 'string' ? row.blurb : '',
    ...(typeof row.place_id === 'string'
      ? { googlePlaceId: row.place_id }
      : {}),
    ...(typeof row.photo_count === 'number' && row.photo_count > 0
      ? { photoCount: row.photo_count }
      : {}),
    ...(Array.isArray(row.photo_attributions)
      ? { photoAttributions: row.photo_attributions as string[] }
      : {}),
    ...(Array.isArray(row.reviews)
      ? { reviews: row.reviews as Bar['reviews'] }
      : {}),
  };
}

export async function fetchBarDetails(id: string): Promise<BarDetails | undefined> {
  if (!ID_RE.test(id)) return undefined;
  if (cache.has(id)) return cache.get(id);

  const supabase = getBrowserSupabase();
  if (!supabase) return undefined;
  let result;
  try {
    result = await supabase
      .from('bars')
      .select('address,blurb,place_id,photo_count,photo_attributions,reviews')
      .eq('id', id)
      .maybeSingle();
  } catch {
    return undefined;
  }
  const { data, error } = result;
  if (error) return undefined;
  if (!data) {
    cache.set(id, undefined);
    return undefined;
  }

  const details = rowToDetails(data as DetailRow);
  cache.set(id, details);
  return details;
}

/** Back-compatible review accessor; shares the single detail query/cache. */
export async function fetchBarReviews(id: string): Promise<Bar['reviews']> {
  return (await fetchBarDetails(id))?.reviews;
}

/** Test seam. */
export function clearReviewCache(): void {
  cache.clear();
}
