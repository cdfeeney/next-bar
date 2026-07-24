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
 *
 * B3b (migration 0008) adds the consent layer for private accounts:
 *   - follow_user now returns text — 'followed' | 'requested' | 'rejected'.
 *     Until 0008 is applied the live RPC still returns boolean; the mapping
 *     in followByHandle accepts BOTH shapes so this client is deployable
 *     either side of the apply.
 *   - accept/decline (target side), cancel (requester side).
 *   - get_follow_requests() (inbox) / get_outgoing_requests() ("Requested"
 *     button states surviving reload).
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

/** Outcome of a follow attempt once requests exist (B3b). */
export type FollowStatus = 'followed' | 'requested';

export type FollowOutcome = {
  profile: PublicProfile;
  status: FollowStatus;
};

/** An incoming follow request (the target's inbox). */
export type FollowRequest = {
  id: string;
  handle: string;
  displayName: string | null;
  requestedAt: string;
};

type RequestRow = {
  id: string;
  handle: string | null;
  display_name: string | null;
  requested_at: string;
};

type ProfileRow = { id: string; handle: string | null; display_name: string | null };
type FriendRatingRow = {
  user_id: string;
  bar_id: string;
  tier: Rating;
  rated_at: string;
};

/** Trim + strip a leading @ — what users paste is "@claire", what the DB knows is "claire". */
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
 * Returns the resolved profile plus what the server did with the attempt:
 * 'followed' (edge exists) or 'requested' (target is private — a consent
 * request now sits in their inbox, B3b). Null when resolution fails, the
 * RPC errors, or the server declines (rate cap, self-follow, missing
 * target). The server response is authoritative — a null here means the
 * optimistic UI entry must be rolled back.
 *
 * Return-shape mapping accepts BOTH RPC generations: pre-0008 `follow_user`
 * returns boolean (true = followed), post-0008 returns text. Anything else
 * — including the old `false` and the new 'rejected' — is null.
 */
export async function followByHandle(
  supabase: SupabaseClient,
  handle: string,
): Promise<FollowOutcome | null> {
  const profile = await getProfileByHandle(supabase, handle);
  if (profile === null) return null;

  const { data, error } = await supabase.rpc('follow_user', {
    target: profile.id,
  });
  if (error) return null;
  if (data === true || data === 'followed') return { profile, status: 'followed' };
  if (data === 'requested') return { profile, status: 'requested' };
  return null;
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

/**
 * The caller's inbox of incoming follow requests via `get_follow_requests`
 * (B3b definer read — requester profiles handle-resolved because profiles
 * has no client SELECT). Null on RPC error (callers keep prior state);
 * requester rows without a handle are dropped — an unclaimed profile has no
 * /u/ route and no way to be rendered.
 */
export async function fetchFollowRequests(
  supabase: SupabaseClient,
): Promise<FollowRequest[] | null> {
  const { data, error } = await supabase.rpc('get_follow_requests');
  if (error || !Array.isArray(data)) return null;
  return (data as RequestRow[])
    .filter((row): row is RequestRow & { handle: string } =>
      typeof row.handle === 'string',
    )
    .map((row) => ({
      id: row.id,
      handle: row.handle,
      displayName: row.display_name,
      requestedAt: row.requested_at,
    }));
}

/**
 * The caller's own outgoing pending requests via `get_outgoing_requests` —
 * this is what lets a "Requested" button state survive a reload. Null on
 * RPC error; handle-less rows dropped (same rule as fetchFollows).
 */
export async function fetchOutgoingRequests(
  supabase: SupabaseClient,
): Promise<PublicProfile[] | null> {
  const { data, error } = await supabase.rpc('get_outgoing_requests');
  if (error || !Array.isArray(data)) return null;
  return (data as RequestRow[])
    .filter((row): row is RequestRow & { handle: string } =>
      typeof row.handle === 'string',
    )
    .map((row) => ({
      id: row.id,
      handle: row.handle,
      displayName: row.display_name,
    }));
}

/**
 * Accept an incoming request (target side): atomically creates the follows
 * edge and deletes the request. True only when the server confirms — a
 * false must roll back any optimistic inbox removal.
 */
export async function acceptFollowRequest(
  supabase: SupabaseClient,
  requesterId: string,
): Promise<boolean> {
  const { data, error } = await supabase.rpc('accept_follow_request', {
    requester: requesterId,
  });
  return !error && data === true;
}

/** Decline an incoming request (target side). True when a row was removed. */
export async function declineFollowRequest(
  supabase: SupabaseClient,
  requesterId: string,
): Promise<boolean> {
  const { data, error } = await supabase.rpc('decline_follow_request', {
    requester: requesterId,
  });
  return !error && data === true;
}

/**
 * Withdraw the caller's own pending request (requester side) — the toggle
 * path for a "Requested" button. True when a row was removed.
 */
export async function cancelFollowRequest(
  supabase: SupabaseClient,
  targetId: string,
): Promise<boolean> {
  const { data, error } = await supabase.rpc('cancel_follow_request', {
    target: targetId,
  });
  return !error && data === true;
}

/**
 * The caller's FOLLOWERS via the 0010 `get_followers` definer read (B3c).
 * Null on RPC error (incl. pre-0010 missing function) so callers keep
 * prior state; handle-less rows dropped (unroutable), same as
 * fetchFollows.
 */
export async function fetchFollowers(
  supabase: SupabaseClient,
): Promise<PublicProfile[] | null> {
  const { data, error } = await supabase.rpc('get_followers');
  if (error || !Array.isArray(data)) return null;
  return (data as RequestRow[])
    .filter((row): row is RequestRow & { handle: string } =>
      typeof row.handle === 'string',
    )
    .map((row) => ({
      id: row.id,
      handle: row.handle,
      displayName: row.display_name,
    }));
}

/**
 * Follower count for any profile (B3c): integer for public profiles and
 * private profiles the caller follows; null for hidden/unknown profiles
 * AND on any error — the UI shows nothing rather than a wrong number.
 */
export async function fetchFollowerCount(
  supabase: SupabaseClient,
  profileId: string,
): Promise<number | null> {
  const { data, error } = await supabase.rpc('get_follower_count', {
    profile_id: profileId,
  });
  if (error || typeof data !== 'number') return null;
  return data;
}

/**
 * Friends = MUTUAL follows (B3c): the intersection of who you follow and
 * who follows you, keyed by profile id. Pure derivation — no RPC.
 */
export function deriveMutuals(
  following: readonly PublicProfile[],
  followers: readonly PublicProfile[],
): PublicProfile[] {
  const followerIds = new Set(followers.map((p) => p.id));
  return following.filter((p) => p.id !== '' && followerIds.has(p.id));
}
