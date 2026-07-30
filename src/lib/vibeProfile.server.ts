import type { SupabaseClient } from '@supabase/supabase-js';
import type { VibeProfile } from '@/types';
import { parseVibeProfile, type StoredProfile } from '@/lib/storedProfile';

/**
 * Server-mode vibe profile operations (Supabase-backed, migration 0033).
 * Pure async functions — keep the React layer free of SQL specifics.
 *
 * Shape mapping:
 *   localStorage StoredProfile  ↔  Supabase `vibe_profiles` row
 *   { tags, preferredNeighborhoods, archetype, savedAt }
 *     ↔  { profile jsonb, saved_at }
 *
 * RLS (0033) guarantees the server only returns / accepts the authenticated
 * user's row, so reads do not filter by user_id.
 *
 * NULL IS "FAILED", NOT "EMPTY" — the same contract as ratings.server.ts.
 * Hydrating a cache from a failed fetch would silently wipe it, and latching
 * an ownership flag after a failed write would mark unsynced data as synced.
 * Callers MUST distinguish the two.
 */

type Row = {
  profile: unknown;
  saved_at: string;
};

/**
 * Fetch the user's vibe profile.
 *
 * Returns:
 *   StoredProfile — a valid stored row
 *   'absent'      — the query succeeded and there is no row (or the stored
 *                   row failed validation, which is treated as absent so a
 *                   corrupt row can be overwritten rather than deadlocking)
 *   null          — the fetch FAILED (transport/RLS). Keep local data.
 */
export async function fetchServerVibeProfile(
  supabase: SupabaseClient,
): Promise<StoredProfile | 'absent' | null> {
  const { data, error } = await supabase
    .from('vibe_profiles')
    .select('profile,saved_at')
    // maybeSingle: zero rows is a normal outcome, not an error. `.single()`
    // would return PGRST116 and be indistinguishable from a real failure.
    .maybeSingle();

  if (error) return null;
  if (!data) return 'absent';

  const row = data as Row;
  // Validate through the SAME parser the localStorage path uses, so a row
  // written by an older/newer client can never enter the app unvalidated.
  const parsed = parseVibeProfile({
    ...(typeof row.profile === 'object' && row.profile !== null
      ? (row.profile as Record<string, unknown>)
      : {}),
    savedAt: row.saved_at,
  });
  return parsed ?? 'absent';
}

/**
 * Write the user's vibe profile. Returns the row written, or null on failure.
 *
 * The 0033 `vibe_profiles_lww` trigger silently skips an UPDATE whose
 * saved_at is not strictly newer than the stored row, so a stale write is a
 * successful no-op rather than a clobber. That means a non-null return means
 * "the server accepted the request", NOT "the server stored this exact row" —
 * callers that need the authoritative row must re-read it.
 */
export async function upsertServerVibeProfile(
  supabase: SupabaseClient,
  userId: string,
  profile: StoredProfile,
): Promise<StoredProfile | null> {
  const { tags, preferredNeighborhoods, archetype, savedAt } = profile;
  const { error } = await supabase.from('vibe_profiles').upsert(
    {
      user_id: userId,
      profile: { tags, preferredNeighborhoods, archetype } satisfies VibeProfile,
      saved_at: savedAt,
    },
    { onConflict: 'user_id' },
  );
  if (error) return null;
  return profile;
}

/**
 * Delete the user's vibe profile row. Returns false on failure so the caller
 * can refuse to clear local state (clearing locally after a failed server
 * delete would just resurrect the row on the next sync).
 *
 * Requires the owner-scoped delete policy added in 0033.
 */
export async function deleteServerVibeProfile(
  supabase: SupabaseClient,
  userId: string,
): Promise<boolean> {
  const { error } = await supabase
    .from('vibe_profiles')
    .delete()
    .eq('user_id', userId);
  if (!error) return true;
  // Migration 0033 is authored but deliberately UNAPPLIED, so in every current
  // environment this table does not exist yet. Postgres 42P01 (undefined_table)
  // must count as "there is no server row to delete" — otherwise the Settings
  // clear button, which refuses to clear locally when this returns false,
  // becomes permanently broken for signed-in users until an operator runs the
  // migration. That would be a REGRESSION: the button worked before this
  // feature existed.
  //
  // This stays correct once the table exists: only a MISSING TABLE is
  // forgiven. A genuine failure (network, RLS, permission) still returns false
  // and still blocks the local clear, so a live server row can never be
  // orphaned by a local-only clear and then re-hydrated.
  return isUndefinedTable(error);
}

/** PostgREST surfaces Postgres error codes on `error.code`. */
function isUndefinedTable(error: { code?: string; message?: string }): boolean {
  if (error.code === '42P01') return true;
  // PostgREST also reports an unknown relation as PGRST205 ("Could not find the
  // table in the schema cache") before the schema cache is refreshed.
  if (error.code === 'PGRST205') return true;
  return /does not exist|could not find the table/i.test(error.message ?? '');
}
