import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Server-mode RSVP operations ("I'm in" on tonight's suggestions —
 * migration 0012). House pattern: null/false on error, never throw.
 *
 * MOVE semantics live server-side in `rsvp_bar`: one RSVP per night —
 * RSVPing elsewhere moves you. "I'm out" goes through `unrsvp_bar`
 * (migration 0013) so BOTH RSVP writes serialize under the same
 * per-user advisory lock — a raw table delete raced `rsvp_bar`'s
 * delete-then-insert across tabs. Reads go through the circle-scoped
 * `get_circle_rsvps` definer.
 */

/** One friend-or-own RSVP for a given night. */
export type CircleRsvp = {
  userId: string;
  handle: string | null;
  displayName: string | null;
  barId: string;
};

type RsvpRow = {
  user_id: string;
  handle: string | null;
  display_name: string | null;
  bar_id: string;
};

const NIGHT_RE = /^\d{4}-\d{2}-\d{2}$/;
const BAR_ID_RE = /^[a-z0-9-]{1,60}$/;

/** RSVP to a bar for a night (moves any existing RSVP that night). */
export async function rsvpBar(
  supabase: SupabaseClient,
  barId: string,
  night: string,
): Promise<boolean> {
  if (!BAR_ID_RE.test(barId) || !NIGHT_RE.test(night)) return false;
  const { data, error } = await supabase.rpc('rsvp_bar', {
    bar: barId,
    night,
  });
  return !error && data === true;
}

/** Withdraw the caller's own RSVP ("I'm out") — serialized RPC. */
export async function unrsvpBar(
  supabase: SupabaseClient,
  barId: string,
  night: string,
): Promise<boolean> {
  if (!BAR_ID_RE.test(barId) || !NIGHT_RE.test(night)) return false;
  const { data, error } = await supabase.rpc('unrsvp_bar', {
    bar: barId,
    night,
  });
  return !error && data === true;
}

/**
 * Fetch tonight's RSVPs across the caller's circle. Returns null on
 * error — callers distinguish "nobody's in yet" ([]) from "couldn't
 * load" (null).
 */
export async function fetchCircleRsvps(
  supabase: SupabaseClient,
  night: string,
): Promise<CircleRsvp[] | null> {
  if (!NIGHT_RE.test(night)) return null;
  const { data, error } = await supabase.rpc('get_circle_rsvps', { night });
  if (error || !Array.isArray(data)) return null;
  return (data as RsvpRow[]).map((row) => ({
    userId: row.user_id,
    handle: row.handle,
    displayName: row.display_name,
    barId: row.bar_id,
  }));
}
