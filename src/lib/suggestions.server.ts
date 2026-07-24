import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Server-mode bar-suggestion operations ("Where should we go?"
 * nominations — migration 0011). House pattern (ratings.server.ts /
 * profile.server.ts): pure async functions, null/false on transport or
 * RLS error, never throw.
 *
 * Writes go through the `suggest_bar` SECURITY DEFINER RPC (3-per-night
 * cap enforced server-side; idempotent re-suggest); reads through the
 * `get_circle_suggestions` definer (own + followed users' rows only —
 * there is NO table-level SELECT). Un-suggest is the one direct table op
 * (own-row DELETE policy).
 */

/** One friend-or-own suggestion for a given night. */
export type CircleSuggestion = {
  userId: string;
  handle: string | null;
  displayName: string | null;
  barId: string;
};

type SuggestionRow = {
  user_id: string;
  handle: string | null;
  display_name: string | null;
  bar_id: string;
};

const NIGHT_RE = /^\d{4}-\d{2}-\d{2}$/;
const BAR_ID_RE = /^[a-z0-9-]{1,60}$/;

/**
 * Suggest a bar for a night. True only when the server confirms (false =
 * cap hit, invalid input, or error — the UI treats all three as "didn't
 * land" and re-fetches).
 */
export async function suggestBar(
  supabase: SupabaseClient,
  barId: string,
  night: string,
): Promise<boolean> {
  if (!BAR_ID_RE.test(barId) || !NIGHT_RE.test(night)) return false;
  const { data, error } = await supabase.rpc('suggest_bar', {
    bar: barId,
    night,
  });
  return !error && data === true;
}

/** Remove the caller's own suggestion (own-row RLS delete). */
export async function unsuggestBar(
  supabase: SupabaseClient,
  userId: string,
  barId: string,
  night: string,
): Promise<boolean> {
  if (!BAR_ID_RE.test(barId) || !NIGHT_RE.test(night)) return false;
  const { error } = await supabase
    .from('bar_suggestions')
    .delete()
    .eq('user_id', userId)
    .eq('bar_id', barId)
    .eq('night', night);
  return !error;
}

/**
 * Fetch tonight's suggestions across the caller's circle (own + people
 * they follow). Returns null on error — callers must distinguish "no
 * suggestions yet" ([]) from "couldn't load" (null).
 */
export async function fetchCircleSuggestions(
  supabase: SupabaseClient,
  night: string,
): Promise<CircleSuggestion[] | null> {
  if (!NIGHT_RE.test(night)) return null;
  const { data, error } = await supabase.rpc('get_circle_suggestions', {
    night,
  });
  if (error || !Array.isArray(data)) return null;
  return (data as SuggestionRow[]).map((row) => ({
    userId: row.user_id,
    handle: row.handle,
    displayName: row.display_name,
    barId: row.bar_id,
  }));
}
