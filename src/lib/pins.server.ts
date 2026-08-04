import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Server-mode venue-pin operations ("Pin where I am" — draft migration
 * 0038, g-31f36bf8). House pattern: null/false on error, never throw.
 *
 * PRIVACY CONTRACT (criteria 4–5): the ONLY things this module ever
 * sends are a catalog bar id and a night key. Geolocation may rank
 * nearby bars on-device before the user picks one, but no coordinate,
 * accuracy, or raw-position value exists anywhere in these payloads —
 * pins.server.test.ts pins that at the RPC-argument level.
 *
 * MOVE semantics live server-side in `pin_venue`: one pin per night —
 * pinning elsewhere moves you (upsert on the (user_id, night) PK).
 * `unpin_venue` shares the same per-user advisory lock so pin writes
 * never interleave across tabs. Reads go through the MUTUAL-friends-only
 * `get_friend_pins` definer (a one-way follower never sees presence).
 */

/** One friend-or-own pin for a given night. */
export type FriendPin = {
  userId: string;
  handle: string | null;
  displayName: string | null;
  barId: string;
  pinnedAt: string;
};

type PinRow = {
  user_id: string;
  handle: string | null;
  display_name: string | null;
  bar_id: string;
  pinned_at: string;
};

const NIGHT_RE = /^\d{4}-\d{2}-\d{2}$/;
const BAR_ID_RE = /^[a-z0-9-]{1,60}$/;

/** Pin the caller at a bar for a night (moves any existing pin). */
export async function pinVenue(
  supabase: SupabaseClient,
  barId: string,
  night: string,
): Promise<boolean> {
  if (!BAR_ID_RE.test(barId) || !NIGHT_RE.test(night)) return false;
  const { data, error } = await supabase.rpc('pin_venue', {
    bar: barId,
    night,
  });
  return !error && data === true;
}

/** Remove the caller's own pin for a night — serialized RPC. */
export async function unpinVenue(
  supabase: SupabaseClient,
  night: string,
): Promise<boolean> {
  if (!NIGHT_RE.test(night)) return false;
  const { data, error } = await supabase.rpc('unpin_venue', { night });
  return !error && data === true;
}

/**
 * Fetch tonight's pins across the caller's MUTUAL friends (plus their
 * own). Returns null on error — callers distinguish "nobody's pinned"
 * ([]) from "couldn't load" (null).
 */
export async function fetchFriendPins(
  supabase: SupabaseClient,
  night: string,
): Promise<FriendPin[] | null> {
  if (!NIGHT_RE.test(night)) return null;
  const { data, error } = await supabase.rpc('get_friend_pins', { night });
  if (error || !Array.isArray(data)) return null;
  return (data as PinRow[]).map((row) => ({
    userId: row.user_id,
    handle: row.handle,
    displayName: row.display_name,
    barId: row.bar_id,
    pinnedAt: row.pinned_at,
  }));
}
