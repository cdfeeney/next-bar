import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * nights.server — client half of the shared-nights surface (E4.4,
 * migration 0016). Sharing is an explicit per-night act; the returned
 * share token is the bearer capability the link carries. The anon read
 * is keyed on the token ALONE (DeepSeek review: a handle+date lookup was
 * an enumeration oracle).
 */

export type SharedNight = {
  handle: string;
  displayName: string | null;
  /** YYYY-MM-DD nightKey. */
  night: string;
  barIds: string[];
  lovedBarId: string | null;
  sharedAt: string;
};

const TOKEN_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Cheap format gate so garbage URLs never reach the RPC. */
export function isShareToken(value: string): boolean {
  return TOKEN_RE.test(value);
}

type SharedNightRow = {
  handle: string;
  display_name: string | null;
  night: string;
  bar_ids: string[];
  loved_bar_id: string | null;
  shared_at: string;
};

/**
 * Publish (or republish) a night. Returns the share token, or null on
 * failure. Re-sharing the same night keeps its token — links already
 * sent stay alive.
 */
export async function shareNight(
  supabase: SupabaseClient,
  night: { nightKey: string; barIds: string[]; lovedBarId: string | null },
): Promise<string | null> {
  const { data, error } = await supabase.rpc('share_night', {
    p_night: night.nightKey,
    p_bar_ids: night.barIds,
    p_loved_bar_id: night.lovedBarId,
  });
  if (error || typeof data !== 'string') return null;
  return data;
}

/** Revoke a shared night (its links die). True on success. */
export async function unshareNight(
  supabase: SupabaseClient,
  nightKey: string,
): Promise<boolean> {
  const { error } = await supabase.rpc('unshare_night', { p_night: nightKey });
  return error === null;
}

/** Anonymous token-keyed read. Null = unknown token / unshared / error. */
export async function fetchSharedNight(
  supabase: SupabaseClient,
  token: string,
): Promise<SharedNight | null> {
  if (!isShareToken(token)) return null;
  const { data, error } = await supabase.rpc('get_shared_night', {
    p_token: token,
  });
  if (error || !Array.isArray(data) || data.length === 0) return null;
  const row = data[0] as SharedNightRow;
  if (
    typeof row.handle !== 'string' ||
    typeof row.night !== 'string' ||
    !Array.isArray(row.bar_ids)
  ) {
    return null;
  }
  return {
    handle: row.handle,
    displayName: row.display_name ?? null,
    night: row.night,
    barIds: row.bar_ids.filter((b): b is string => typeof b === 'string'),
    lovedBarId: row.loved_bar_id ?? null,
    sharedAt: row.shared_at,
  };
}
