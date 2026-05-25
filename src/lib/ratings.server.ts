import type { SupabaseClient } from '@supabase/supabase-js';
import type { BarRating, Rating } from '@/types/ratings';

/**
 * Server-mode rating operations (Supabase-backed). Pure async functions —
 * keep the React layer free of SQL specifics.
 *
 * Shape mapping:
 *   localStorage BarRating  ↔  Supabase `ratings` row
 *   { barId, rating, ratedAt }  ↔  { bar_id, tier, rated_at }
 *
 * RLS guarantees the server will only return / accept rows for the
 * authenticated user, so we don't filter by user_id on reads.
 */

type Row = {
  bar_id: string;
  tier: Rating;
  rated_at: string;
};

function rowToRating(row: Row): BarRating {
  return { barId: row.bar_id, rating: row.tier, ratedAt: row.rated_at };
}

export async function fetchServerRatings(
  supabase: SupabaseClient,
): Promise<BarRating[]> {
  const { data, error } = await supabase
    .from('ratings')
    .select('bar_id, tier, rated_at');
  if (error || !data) return [];
  return (data as Row[]).map(rowToRating);
}

export async function upsertServerRating(
  supabase: SupabaseClient,
  userId: string,
  barId: string,
  rating: Rating,
): Promise<void> {
  await supabase.from('ratings').upsert(
    {
      user_id: userId,
      bar_id: barId,
      tier: rating,
      rated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,bar_id' },
  );
}

export async function deleteServerRating(
  supabase: SupabaseClient,
  userId: string,
  barId: string,
): Promise<void> {
  await supabase
    .from('ratings')
    .delete()
    .eq('user_id', userId)
    .eq('bar_id', barId);
}

/**
 * One-shot merge of localStorage ratings into the user's server ratings.
 * Server-wins on conflict — we only insert bars that don't already have a
 * server rating for this user. Idempotent: running twice does nothing.
 *
 * Returns the count of rows actually inserted (useful for telemetry / UI).
 */
export async function mergeLocalRatingsToServer(
  supabase: SupabaseClient,
  userId: string,
  localRatings: BarRating[],
): Promise<number> {
  if (localRatings.length === 0) return 0;

  const existing = await fetchServerRatings(supabase);
  const existingBarIds = new Set(existing.map((r) => r.barId));

  const toInsert = localRatings
    .filter((r) => !existingBarIds.has(r.barId))
    .map((r) => ({
      user_id: userId,
      bar_id: r.barId,
      tier: r.rating,
      rated_at: r.ratedAt,
    }));

  if (toInsert.length === 0) return 0;

  const { error } = await supabase.from('ratings').insert(toInsert);
  if (error) return 0;
  return toInsert.length;
}
