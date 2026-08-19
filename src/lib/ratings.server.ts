import type { SupabaseClient } from '@supabase/supabase-js';
import type { BarRating, Rating } from '@/types/ratings';

/**
 * Server-mode rating operations (Supabase-backed). Pure async functions —
 * keep the React layer free of SQL specifics.
 *
 * Shape mapping:
 *   localStorage BarRating  ↔  Supabase `ratings` row
 *   { barId, rating, ratedAt, score }  ↔  { bar_id, tier, rated_at, score }
 *
 * RLS guarantees the server will only return / accept rows for the
 * authenticated user, so we don't filter by user_id on reads.
 *
 * Concurrency (B0.3): every write carries a client-generated `updated_at`;
 * the `ratings_lww` trigger (migration 0005) silently skips updates that
 * are not strictly newer, so two devices racing on the same bar converge
 * on the later write instead of the later-arriving one.
 */

type Row = {
  bar_id: string;
  tier: Rating;
  rated_at: string;
  score: number | null;
};

function rowToRating(row: Row): BarRating {
  return {
    barId: row.bar_id,
    rating: row.tier,
    ratedAt: row.rated_at,
    ...(typeof row.score === 'number' ? { score: row.score } : {}),
  };
}

/**
 * Fetch the user's ratings. Returns null on transport/RLS error so callers
 * can distinguish "no ratings" from "fetch failed" — hydrating a cache from
 * a failed fetch would silently wipe it.
 */
export async function fetchServerRatings(
  supabase: SupabaseClient,
): Promise<BarRating[] | null> {
  const { data, error } = await supabase
    .from('ratings')
    .select('bar_id, tier, rated_at, score');
  if (error || !data) return null;
  return (data as Row[]).map(rowToRating);
}

/**
 * Upsert one rating row.
 *
 * `score` semantics:
 *   - omitted (undefined) → column left out of the payload; PostgREST's
 *     ON CONFLICT SET only touches supplied columns, so an existing score
 *     is preserved (same-tier re-tap must not wipe refinement).
 *   - null → explicitly clears the score (tier CHANGED: the old score was
 *     interpolated inside the old tier's band and is meaningless now).
 *   - number → writes that score.
 *
 * `at`: the row's own timestamp, for sign-in retries of journaled writes
 * (V8-2 round-3). A retry must carry the ORIGINAL ratedAt, not "now" — a
 * fresh timestamp would win the LWW race against a genuinely newer change
 * made on another device while this one's write sat unacked.
 *
 * Returns true only when the server acknowledged the write — the dirty
 * journal is cleared on exactly this signal, so a swallowed failure can no
 * longer classify an unsynced row as disposable.
 */
export async function upsertServerRating(
  supabase: SupabaseClient,
  userId: string,
  barId: string,
  rating: Rating,
  score?: number | null,
  at?: string,
): Promise<boolean> {
  const stamp = at ?? new Date().toISOString();
  const { error } = await supabase.from('ratings').upsert(
    {
      user_id: userId,
      bar_id: barId,
      tier: rating,
      rated_at: stamp,
      updated_at: stamp,
      ...(score === undefined ? {} : { score }),
    },
    { onConflict: 'user_id,bar_id' },
  );
  return error === null;
}

/**
 * Write transcript-derived scores after a pairwise answer (B0.4).
 *
 * Score-ONLY updates, never full-row upserts (Codex review): a stale device
 * sending its cached tier/rated_at alongside a fresh updated_at would win
 * the LWW race and roll back a tier change made on another device. UPDATE
 * touches only score + updated_at; a row deleted server-side in between
 * simply no-ops.
 */
export async function updateServerScores(
  supabase: SupabaseClient,
  userId: string,
  entries: ReadonlyArray<BarRating>,
): Promise<void> {
  if (entries.length === 0) return;
  const now = new Date().toISOString();
  await Promise.all(
    entries.map((r) =>
      supabase
        .from('ratings')
        .update({
          score: typeof r.score === 'number' ? r.score : null,
          updated_at: now,
        })
        .eq('user_id', userId)
        .eq('bar_id', r.barId),
    ),
  );
}

/**
 * Returns true only on server ack — see upsertServerRating.
 *
 * `at`: the delete's own timestamp. When supplied, the delete only removes a
 * row whose `updated_at` is not newer — the LWW guard for journaled-delete
 * RETRIES (round-4 panel, Codex): an unconditional retry erased a rating the
 * user had since re-created on another device. An in-session delete passes
 * its own stamp too, for the same reason.
 */
export async function deleteServerRating(
  supabase: SupabaseClient,
  userId: string,
  barId: string,
  at?: string,
): Promise<boolean> {
  let query = supabase
    .from('ratings')
    .delete()
    .eq('user_id', userId)
    .eq('bar_id', barId);
  if (at !== undefined) query = query.lte('updated_at', at);
  const { error } = await query;
  return error === null;
}

/**
 * Delete EVERY rating row belonging to the user — the server half of the
 * Settings "Clear all ratings" action. Without it, clearing localStorage
 * alone just re-fetches the server rows on next mount and everything
 * reappears. RLS already scopes deletes to the authenticated user; the
 * explicit user_id filter keeps intent obvious and stays safe if policies
 * loosen later.
 */
export async function deleteAllServerRatings(
  supabase: SupabaseClient,
  userId: string,
): Promise<boolean> {
  // supabase-js does NOT throw on failure — it resolves with { error }.
  // Returning success explicitly keeps callers' failure handling alive
  // (Codex review: a try/catch around this was dead code).
  const { error } = await supabase
    .from('ratings')
    .delete()
    .eq('user_id', userId);
  return error === null;
}

/**
 * One-shot merge of localStorage ratings into the user's server ratings.
 * Server-wins on conflict — we only insert bars that don't already have a
 * server rating for this user. Idempotent: running twice does nothing.
 *
 * Returns the barIds actually INSERTED (round-4 panel, Claude + Codex — the
 * corroborated finding of the round: callers were bulk-clearing the dirty
 * journal for every local row, including rows this merge deliberately
 * SKIPPED because the server already had them; those skipped-but-newer rows
 * then lost their journal protection and were silently reverted). Returns
 * null when the merge did NOT complete (pre-merge fetch failed, or the
 * insert errored) — callers must not latch their merged-for flag on null,
 * so a failed merge retries on the next sign-in.
 */
export async function mergeLocalRatingsToServer(
  supabase: SupabaseClient,
  userId: string,
  localRatings: BarRating[],
): Promise<string[] | null> {
  if (localRatings.length === 0) return [];

  const existing = await fetchServerRatings(supabase);
  if (existing === null) return null;
  const existingBarIds = new Set(existing.map((r) => r.barId));

  const toInsert = localRatings
    .filter((r) => !existingBarIds.has(r.barId))
    .map((r) => ({
      user_id: userId,
      bar_id: r.barId,
      tier: r.rating,
      rated_at: r.ratedAt,
      updated_at: r.ratedAt,
      score: typeof r.score === 'number' ? r.score : null,
    }));

  if (toInsert.length === 0) return [];

  const { error } = await supabase.from('ratings').insert(toInsert);
  if (error) return null;
  return toInsert.map((row) => row.bar_id);
}
