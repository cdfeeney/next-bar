import type { SupabaseClient } from '@supabase/supabase-js';
import type { Rating } from '@/types/ratings';

/**
 * Server-mode social-graph operations (B3). Pure async functions — keep the
 * React layer free of SQL/RPC specifics (ratings.server.ts pattern: null on
 * transport/RLS error, never throw).
 *
 * Every surface here is a migration-0007 RPC or view; there is deliberately
 * NO direct table write path on `follows` (INSERT is revoked — the
 * SECURITY DEFINER `follow_user` RPC is the only write path, so its
 * follow-rate cap cannot be bypassed; mirrors the 0006 claim_handle lesson):
 *   - get_profile_by_handle(h) — exact-handle resolution (private users are
 *     resolvable by exact handle only, per the B2 decision).
 *   - get_following()          — the caller's circle, handle-resolved.
 *   - follow_user(target) / unfollow_user(target) — edge writes.
 *   - friend_ratings view      — tier-only friend read on ratings. The
 *     `score` column is NEVER selected or exposed (blueprint hard rule:
 *     score stays owner-only; tier is the friend-visible signal).
 */

const HANDLE_RE = /^[a-z0-9_]{3,20}$/;

export type PublicProfile = {
  id: string;
  handle: string;
  displayName: string | null;
};

export type FriendRating = {
  userId: string;
  barId: string;
  rating: Rating;
  ratedAt: string;
};

type ProfileRow = { id: string; handle: string | null; display_name: string | null };
type FriendRatingRow = {
  user_id: string;
  bar_id: string;
  tier: Rating;
  rated_at: string;
};

/** Trim + strip a leading @ — what users paste is "@maya", what the DB knows is "maya". */
function cleanHandle(handle: string): string {
  return handle.trim().replace(/^@/, '');
}

/**
 * Resolve a handle to a profile via the `get_profile_by_handle` RPC.
 *
 * Returns null when the input is invalid (client-side rejection, no
 * roundtrip), no profile matches, the caller is rate-capped, or the RPC
 * errored. Exact match resolves private profiles too — private users remain
 * addable by exact handle only (B2 decision); prefix search never lists them.
 */
export async function getProfileByHandle(
  supabase: SupabaseClient,
  handle: string,
): Promise<PublicProfile | null> {
  const cleaned = cleanHandle(handle);
  if (!HANDLE_RE.test(cleaned.toLowerCase())) return null;

  const { data, error } = await supabase.rpc('get_profile_by_handle', {
    h: cleaned,
  });
  if (error || !Array.isArray(data)) return null;

  const row = data[0] as ProfileRow | undefined;
  if (!row || typeof row.handle !== 'string') return null;
  return { id: row.id, handle: row.handle, displayName: row.display_name };
}

/**
 * Fetch the signed-in user's circle (who they follow), handle-resolved via
 * the `get_following` RPC. Returns null on RPC error so callers can keep
 * prior state rather than blanking a circle on a transient failure. Rows
 * without a handle are dropped — an unclaimed profile has no /u/ route.
 */
export async function fetchFollows(
  supabase: SupabaseClient,
): Promise<PublicProfile[] | null> {
  const { data, error } = await supabase.rpc('get_following');
  if (error || !Array.isArray(data)) return null;
  return (data as ProfileRow[])
    .filter((row): row is ProfileRow & { handle: string } =>
      typeof row.handle === 'string',
    )
    .map((row) => ({
      id: row.id,
      handle: row.handle,
      displayName: row.display_name,
    }));
}

/**
 * Follow by handle: resolve → `follow_user(target)`.
 *
 * Returns the followed profile so the caller can render the circle entry
 * without a refetch, or null when resolution fails, the RPC errors, or the
 * server declines (rate cap, self-follow, missing target). The server
 * response is authoritative — a null here means the optimistic UI entry
 * must be rolled back.
 */
export async function followByHandle(
  supabase: SupabaseClient,
  handle: string,
): Promise<PublicProfile | null> {
  const profile = await getProfileByHandle(supabase, handle);
  if (profile === null) return null;

  const { data, error } = await supabase.rpc('follow_user', {
    target: profile.id,
  });
  if (error || data !== true) return null;
  return profile;
}

/**
 * Unfollow by id — the circle entry already carries the real id, so this
 * spends no unit of the shared search cap (Opus review: the by-handle
 * variant burned one per unfollow). True only when the server confirms an
 * edge was removed.
 */
export async function unfollowById(
  supabase: SupabaseClient,
  targetId: string,
): Promise<boolean> {
  const { data, error } = await supabase.rpc('unfollow_user', {
    target: targetId,
  });
  return !error && data === true;
}

/**
 * Unfollow by handle: resolve → `unfollow_user(target)`. Prefer
 * `unfollowById` when the id is already known (no search-cap spend).
 */
export async function unfollowByHandle(
  supabase: SupabaseClient,
  handle: string,
): Promise<boolean> {
  const profile = await getProfileByHandle(supabase, handle);
  if (profile === null) return false;
  return unfollowById(supabase, profile.id);
}

/**
 * A friend's ratings through the `get_friend_ratings()` definer RPC — tier
 * only, NEVER score. An RPC with a MATERIALIZED fence replaced the
 * security_barrier view (DeepSeek review): LEAKPROOF uuid `=` let the
 * planner push a caller predicate below the EXISTS gate, a timing
 * side-channel on unfollowed users. Filtering by userId happens client-side
 * on the gated result set. "Not following" and "no ratings" both come back
 * as [] — null is reserved for transport/RLS failure.
 */
export async function fetchFriendRatings(
  supabase: SupabaseClient,
  userId: string,
): Promise<FriendRating[] | null> {
  const { data, error } = await supabase.rpc('get_friend_ratings');
  if (error || !Array.isArray(data)) return null;
  return (data as FriendRatingRow[])
    .filter((row) => row.user_id === userId)
    .map((row) => ({
      userId: row.user_id,
      barId: row.bar_id,
      rating: row.tier,
      ratedAt: row.rated_at,
    }));
}
