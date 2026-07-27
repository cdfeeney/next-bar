import type { SupabaseClient } from '@supabase/supabase-js';
import type { VibeVote } from '@/lib/vibeVotes';

/**
 * Server-mode vibe-vote operations (migration 0017 — AUTHORED, may be
 * UNAPPLIED). House pattern (suggestions.server.ts): pure async
 * functions, null/false on transport or RLS error, never throw.
 *
 * DARK PATTERN (0008 precedent): while 0017 is unapplied the RPCs don't
 * exist — every call errors → fetch returns null → the poll UI renders
 * nothing. No flag needed; applying the migration lights it up.
 */

const NIGHT_RE = /^\d{4}-\d{2}-\d{2}$/;
const TAG_RE = /^[a-z][a-z-]{1,23}$/;

type VoteRow = {
  user_id: string;
  handle: string | null;
  display_name: string | null;
  tag: string;
  created_at: string;
};

/** Cast (or move) the caller's one vote for the night. */
export async function castVibeVote(
  supabase: SupabaseClient,
  night: string,
  tag: string,
): Promise<boolean> {
  if (!NIGHT_RE.test(night) || !TAG_RE.test(tag)) return false;
  const { data, error } = await supabase.rpc('cast_vibe_vote', {
    p_night: night,
    p_tag: tag,
  });
  return !error && data === true;
}

/** Rescind the caller's own vote (own-row RLS delete). */
export async function rescindVibeVote(
  supabase: SupabaseClient,
  userId: string,
  night: string,
): Promise<boolean> {
  if (!NIGHT_RE.test(night)) return false;
  const { error } = await supabase
    .from('vibe_votes')
    .delete()
    .eq('user_id', userId)
    .eq('night', night);
  return !error;
}

/**
 * Fetch tonight's votes across the caller's circle (own + followed).
 * Returns null on error — INCLUDING the unapplied-migration case, which
 * callers must treat as "feature dark", never as "no votes yet" ([]).
 */
export async function fetchCircleVibeVotes(
  supabase: SupabaseClient,
  night: string,
): Promise<VibeVote[] | null> {
  if (!NIGHT_RE.test(night)) return null;
  const { data, error } = await supabase.rpc('get_circle_vibe_votes', {
    p_night: night,
  });
  if (error || !Array.isArray(data)) return null;
  return (data as VoteRow[]).map((row) => ({
    userId: row.user_id,
    handle: row.handle,
    displayName: row.display_name,
    tag: row.tag,
    createdAt: row.created_at,
  }));
}
