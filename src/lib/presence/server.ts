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

/**
 * The ONE place an RPC is called here, so "never throw" above is a property of
 * the module rather than a habit four call sites have to keep.
 *
 * A Supabase call has two failure shapes and only one arrives as `error`: a
 * transport fault or an unusable client THROWS. Reading only `error` lets that
 * rejection escape into the React effect that called it, which leaves the panel
 * on its loading state forever — the one state that never resolves into an
 * honest message, and the exact failure the sibling nightOutMedia module was
 * caught with. Fixed in both, at the shared point in each.
 *
 * A throw is reported as an error, never as `data: null, error: null`: callers
 * read a null-with-no-error as "the server answered with nothing", which is a
 * different claim from "we never reached the server".
 */
async function callRpc(
  supabase: SupabaseClient,
  fn: string,
  args?: Record<string, unknown>,
): Promise<{ data: unknown; error: unknown }> {
  try {
    // TRANSPARENT: a no-argument RPC is called with no second argument, not
    // with an explicit `undefined`. The two are equivalent to Supabase but not
    // to a test asserting the call shape, and "this RPC takes no arguments" is
    // a security property here worth being able to assert exactly —
    // `get_my_presence` can only answer about auth.uid() BECAUSE it has no
    // parameters.
    return args === undefined
      ? await supabase.rpc(fn)
      : await supabase.rpc(fn, args);
  } catch (thrown) {
    return { data: null, error: thrown ?? new Error(`${fn} threw`) };
  }
}

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
    /**
     * Only meaningful for the 'people' audience. A REQUEST, not a decision:
     * `set_night_presence` intersects it with the caller's mutual friends and
     * raises if nothing survives, so this can never widen who sees the pin.
     */
    recipientIds?: readonly string[];
  },
): Promise<boolean> {
  const barId = presence.barId ?? null;
  const audience = presence.audience ?? 'friends';
  if (!isPresenceStatus(presence.status)) return false;
  if (!isPresenceAudience(audience)) return false;
  if (!isValidPin(presence.status, barId)) return false;

  const recipientIds = presence.recipientIds ?? [];
  // FAIL BEFORE THE ROUND TRIP, matching the server's own rule. 'people' with an
  // empty list is not "show it to nobody" and must never fall back to 'friends';
  // the server raises on it, and returning false here spends no request to be
  // told so.
  if (audience === 'people' && recipientIds.length === 0) return false;

  const { data, error } = await callRpc(supabase, 'set_night_presence', {
    p_status: presence.status,
    p_bar_id: barId,
    p_audience: audience,
    p_recipient_ids: audience === 'people' ? [...recipientIds] : null,
  });
  return !error && data === true;
}

/** Clear tonight's presence entirely. True only when the server confirms. */
export async function clearPresence(
  supabase: SupabaseClient,
): Promise<boolean> {
  const { data, error } = await callRpc(supabase, 'clear_night_presence');
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
  const { data, error } = await callRpc(supabase, 'get_circle_presence');
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
 * Read through `get_my_presence()`, never off the table — see the body. The
 * night is the server's, so a row the client considers tonight's is the same
 * row the server does.
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
  const { data, error } = await callRpc(supabase, 'get_my_presence');
  if (error || !Array.isArray(data) || data.length === 0) return null;
  const row = data[0] as CirclePresenceRow & {
    audience: unknown;
    recipient_ids: unknown;
  };
  if (!isPresenceStatus(row.status)) return null;
  const barId = isBarId(row.bar_id) ? row.bar_id : null;
  if (!isValidPin(row.status, barId)) return null;
  // AN UNRECOGNISED AUDIENCE READS AS THE NARROWEST ONE WE CAN NAME, not the
  // widest. This value drives which controls the surface offers; defaulting a
  // row we cannot parse to 'friends' would show the user a wider audience than
  // the server is actually enforcing, which is the one direction that matters.
  const audience: PresenceAudience = isPresenceAudience(row.audience)
    ? row.audience
    : 'close';
  return {
    status: row.status,
    barId,
    audience,
    recipientIds: Array.isArray(row.recipient_ids)
      ? row.recipient_ids.filter(
          (id): id is string => typeof id === 'string' && id.length > 0,
        )
      : [],
    updatedAt: typeof row.updated_at === 'string' ? row.updated_at : '',
  };
}
