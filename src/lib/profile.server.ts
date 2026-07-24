import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Server-mode profile/username operations (B2). Pure async functions —
 * keep the React layer free of SQL/RPC specifics (ratings.server.ts
 * pattern: null on transport/RLS error, never throw).
 *
 * The claim + search surfaces are SECURITY DEFINER RPCs (migration 0006):
 * there is deliberately NO table-level public SELECT on `profiles`
 * (enumeration guard), so `search_handles` is the only public read path
 * and `claim_handle` is the only write path for handles.
 *
 * Validation contract: `[a-z0-9_]{3,20}` checked against the NORMALIZED
 * (lowercased) form — mixed-case input is legal and keeps its display
 * casing server-side (`handle` stores what you typed; `handle_normalized`
 * enforces case-insensitive uniqueness). Client-side rejection here is UX
 * only; the RPC re-validates authoritatively.
 */

const HANDLE_RE = /^[a-z0-9_]{3,20}$/;
const SEARCH_QUERY_RE = /^[a-z0-9_]{1,20}$/;

export type HandleSearchResult = {
  handle: string;
  displayName: string | null;
};

export type OwnProfile = {
  handle: string | null;
  displayName: string | null;
  isPrivate: boolean;
};

type SearchRow = { handle: string; display_name: string | null };
type ProfileRow = {
  handle: string | null;
  display_name: string | null;
  is_private: boolean;
};

/** True when `desired` normalizes to a legal handle. */
export function isValidHandle(desired: string): boolean {
  return HANDLE_RE.test(desired.trim().toLowerCase());
}

/**
 * Atomically claim a username via the `claim_handle` RPC.
 *
 * Returns the claimed handle (typed casing preserved), or null when the
 * input is invalid, the name is taken / the claim lost a race, the caller
 * is rate-capped, the caller already owns a different handle (no renames
 * in v1), or the RPC errored. The UI treats every null as "taken — try
 * another" plus a retry path; the server response is authoritative.
 */
export async function claimHandle(
  supabase: SupabaseClient,
  desired: string,
): Promise<string | null> {
  const trimmed = desired.trim();
  if (!HANDLE_RE.test(trimmed.toLowerCase())) return null;

  const { data, error } = await supabase.rpc('claim_handle', {
    desired: trimmed,
  });
  if (error || typeof data !== 'string') return null;
  return data;
}

/**
 * Prefix-search public handles via the `search_handles` RPC.
 *
 * Returns [] for an out-of-charset/empty query (client-side rejection, no
 * roundtrip) and null on RPC error — callers can distinguish "no matches"
 * from "search failed" (availability must not read a failure as free).
 */
export async function searchHandles(
  supabase: SupabaseClient,
  query: string,
): Promise<HandleSearchResult[] | null> {
  const normalized = query.trim().toLowerCase();
  if (!SEARCH_QUERY_RE.test(normalized)) return [];

  const { data, error } = await supabase.rpc('search_handles', {
    query: normalized,
  });
  if (error || !Array.isArray(data)) return null;
  return (data as SearchRow[]).map((row) => ({
    handle: row.handle,
    displayName: row.display_name,
  }));
}

/**
 * Best-effort availability probe: an exact (case-insensitive) match in the
 * public search results means taken. Known limits, both resolved by the
 * claim RPC being authoritative:
 *   - a PRIVATE user's handle won't appear here, so it reads "available"
 *     until the actual claim returns null;
 *   - a search error returns false (can't confirm ≠ available).
 */
export async function checkHandleAvailability(
  supabase: SupabaseClient,
  desired: string,
): Promise<boolean> {
  const normalized = desired.trim().toLowerCase();
  if (!HANDLE_RE.test(normalized)) return false;

  const results = await searchHandles(supabase, normalized);
  if (results === null) return false;
  return !results.some((r) => r.handle.toLowerCase() === normalized);
}

/**
 * Fetch the signed-in user's own profile row (RLS scopes the select to
 * `auth.uid()`). Returns null on error or when no row exists — callers
 * treat null as "unknown", not "no handle".
 */
export async function fetchOwnProfile(
  supabase: SupabaseClient,
): Promise<OwnProfile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('handle, display_name, is_private')
    .limit(1);
  if (error || !Array.isArray(data)) return null;

  const row = data[0] as ProfileRow | undefined;
  if (!row) return null;
  return {
    handle: row.handle,
    displayName: row.display_name,
    isPrivate: row.is_private,
  };
}

/**
 * Flip the caller's own is_private flag (B3b privacy toggle). Direct table
 * UPDATE is legal here: the 0006 column grant limits authenticated UPDATE
 * to display_name/is_private and RLS scopes it to the caller's own row.
 * True only when the server confirms — the toggle UI reverts on false.
 *
 * Going private does NOT demote existing followers (edges persist; the B3b
 * decision gates only NEW follows through requests).
 */
export async function setOwnPrivacy(
  supabase: SupabaseClient,
  userId: string,
  isPrivate: boolean,
): Promise<boolean> {
  const { error } = await supabase
    .from('profiles')
    .update({ is_private: isPrivate })
    .eq('id', userId);
  return !error;
}
