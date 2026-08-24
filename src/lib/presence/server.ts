import type { SupabaseClient } from '@supabase/supabase-js';
import {
  isBarId,
  isPresenceAudience,
  isPresenceStatus,
  isValidPin,
  type CirclePresence,
  type MyPresence,
  type PresenceAudience,
  type PresenceStatus,
} from './index';

/**
 * Server-mode presence operations (migration 0068).
 *
 * House pattern (ratings.server.ts / suggestions.server.ts): pure async
 * functions, null/false on transport or RLS error, never throw.
 *
 * Writes go through `set_night_presence` / `clear_night_presence`; the read is
 * `get_circle_presence`, a SECURITY DEFINER function that applies the audience
 * rule itself. There is NO table-level SELECT on `night_presence` for anyone
 * but its owner, so the audience is enforced rather than displayed.
 *
 * THE NIGHT IS NEVER A PARAMETER. Every RPC here resolves the night from
 * `public.nyc_night_key()` on the server. A client that could name the night
 * could pin itself into a different one — and a client clock that is merely
 * wrong would do it by accident, which is the failure this whole boundary
 * exists to end. That is why these signatures look thinner than
 * `fetchCircleSuggestions`, which does take a night: suggestions are read for a
 * night the caller is already looking at; presence is written for now.
 */

type CirclePresenceRow = {
  user_id: unknown;
  handle: unknown;
  display_name: unknown;
  status: unknown;
  bar_id: unknown;
  updated_at: unknown;
};

/**
 * Set or change the caller's presence for tonight.
 *
 * True only when the server confirms. The pin/status pair is validated here as
 * well as in SQL so an invalid pair costs no round trip — and so the caller
 * gets `false` rather than a thrown Postgres error.
 */
export async function setPresence(
  supabase: SupabaseClient,
  presence: {
    status: PresenceStatus;
    barId?: string | null;
    audience?: PresenceAudience;
  },
): Promise<boolean> {
  const barId = presence.barId ?? null;
  const audience = presence.audience ?? 'friends';
  if (!isPresenceStatus(presence.status)) return false;
  if (!isPresenceAudience(audience)) return false;
  if (!isValidPin(presence.status, barId)) return false;

  const { data, error } = await supabase.rpc('set_night_presence', {
    p_status: presence.status,
    p_bar_id: barId,
    p_audience: audience,
  });
  return !error && data === true;
}

/** Clear tonight's presence entirely. True only when the server confirms. */
export async function clearPresence(
  supabase: SupabaseClient,
): Promise<boolean> {
  const { data, error } = await supabase.rpc('clear_night_presence');
  return !error && data === true;
}

/**
 * Tonight's presence across the people the caller follows, already filtered by
 * each pin's own audience.
 *
 * Returns null on error — callers MUST distinguish "nobody is out" ([]) from
 * "couldn't load" (null). Rendering the empty state on a failed fetch would
 * tell the user their friends are staying in, which is a lie the surface can
 * avoid making (V8-R-OPS-005).
 *
 * Rows are validated defensively: a row whose status is not one of the three,
 * or whose bar id is not a catalog id, is DROPPED rather than coerced. A
 * malformed row is not a person to describe.
 */
export async function fetchCirclePresence(
  supabase: SupabaseClient,
): Promise<CirclePresence[] | null> {
  const { data, error } = await supabase.rpc('get_circle_presence');
  if (error || !Array.isArray(data)) return null;

  return (data as CirclePresenceRow[]).flatMap((row) => {
    if (typeof row?.user_id !== 'string' || row.user_id.length === 0) return [];
    if (typeof row?.handle !== 'string' || row.handle.length === 0) return [];
    if (!isPresenceStatus(row.status)) return [];
    if (typeof row.updated_at !== 'string') return [];
    // A bar id that is present but malformed drops the PIN, not the person —
    // they still set a status, and describePresence names it in words.
    const barId = isBarId(row.bar_id) ? row.bar_id : null;
    if (!isValidPin(row.status, barId)) return [];
    return [
      {
        userId: row.user_id,
        handle: row.handle,
        displayName:
          typeof row.display_name === 'string' ? row.display_name : null,
        status: row.status,
        barId,
        updatedAt: row.updated_at,
      },
    ];
  });
}

/**
 * The caller's own presence tonight, or null when they have set none.
 *
 * Read straight from the table rather than through an RPC: the own-row RLS
 * policy already scopes this to `auth.uid()`, and the night filter is applied
 * from the client's `nycNightKey()`. Both sides resolve the same 4:00 AM
 * America/New_York boundary from the same definition, so a row that the client
 * considers tonight's is the same row the server does.
 */
export async function fetchMyPresence(
  supabase: SupabaseClient,
): Promise<MyPresence | null> {
  // THROUGH THE RPC, NEVER THE TABLE. This read used to be
  // `.from('night_presence').select(...).eq('user_id', userId).eq('night', night)`, relying
  // on the own-row RLS policy to scope it. That policy never ran: 0068 revokes ALL table
  // privileges on night_presence from every application role, so the query was denied at
  // the PERMISSION layer before any policy was evaluated. It failed 42501 for every caller
  // — no pill activated, and the row could not be cleared by tapping again.
  //
  // `get_my_presence()` takes no arguments on purpose: identity is auth.uid() and the night
  // is the server-side boundary, so the caller's own row is the only row it can ever
  // return. The userId and night parameters are gone rather than ignored — a parameter a
  // function does not honour is a lie a later caller will believe.
  const { data, error } = await supabase.rpc('get_my_presence');
  if (error || !Array.isArray(data) || data.length === 0) return null;
  const row = data[0] as CirclePresenceRow & { audience: unknown };
  if (!isPresenceStatus(row.status)) return null;
  const barId = isBarId(row.bar_id) ? row.bar_id : null;
  if (!isValidPin(row.status, barId)) return null;
  return {
    status: row.status,
    barId,
    audience: isPresenceAudience(row.audience) ? row.audience : 'friends',
    updatedAt: typeof row.updated_at === 'string' ? row.updated_at : '',
  };
}
