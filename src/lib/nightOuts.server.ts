import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Server-mode Night Out operations (V8-3, migration 0044). House pattern:
 * null/false on error, never throw. Every write is a SECURITY DEFINER RPC —
 * the tables have no client grants, so this module IS the client surface.
 *
 * "Not tonight" is the UI label for `respondNightOut(id, false)` — the
 * database state is `declined` (PRD locked states).
 */

const BAR_ID_RE = /^[a-z0-9-]{1,60}$/;
const NIGHT_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type NightOut = {
  id: string;
  night: string;
  title: string | null;
  status: 'draft' | 'open' | 'decided' | 'cancelled';
  decidedBarId: string | null;
  ownerHandle: string | null;
  ownerDisplayName: string | null;
  shareToken: string;
  callerRole: 'owner' | 'member' | null;
  callerStatus: 'pending' | 'accepted' | 'declined' | null;
};

export type NightOutMember = {
  userId: string;
  handle: string | null;
  displayName: string | null;
  role: 'owner' | 'member';
  inviteStatus: 'pending' | 'accepted' | 'declined';
};

export type NightOutBoardEntry = {
  barId: string;
  suggestedByHandle: string | null;
  votes: number;
  callerVoted: boolean;
};

export type NightOutPreview = {
  night: string;
  title: string | null;
  status: string;
  ownerHandle: string | null;
  ownerDisplayName: string | null;
  acceptedCount: number;
};

/** Create a plan; returns its id, or null on failure. */
export async function createNightOut(
  supabase: SupabaseClient,
  night: string,
  title?: string,
): Promise<string | null> {
  if (!NIGHT_RE.test(night)) return null;
  const { data, error } = await supabase.rpc('create_night_out', {
    p_night: night,
    p_title: title ?? null,
  });
  return !error && typeof data === 'string' ? data : null;
}

export async function cancelNightOut(
  supabase: SupabaseClient,
  nightOutId: string,
): Promise<boolean> {
  if (!UUID_RE.test(nightOutId)) return false;
  const { data, error } = await supabase.rpc('cancel_night_out', {
    p_night_out: nightOutId,
  });
  return !error && data === true;
}

export async function decideNightOut(
  supabase: SupabaseClient,
  nightOutId: string,
  barId: string,
): Promise<boolean> {
  if (!UUID_RE.test(nightOutId) || !BAR_ID_RE.test(barId)) return false;
  const { data, error } = await supabase.rpc('decide_night_out', {
    p_night_out: nightOutId,
    p_bar: barId,
  });
  return !error && data === true;
}

export async function inviteToNightOut(
  supabase: SupabaseClient,
  nightOutId: string,
  userId: string,
): Promise<boolean> {
  if (!UUID_RE.test(nightOutId) || !UUID_RE.test(userId)) return false;
  const { data, error } = await supabase.rpc('invite_to_night_out', {
    p_night_out: nightOutId,
    p_user: userId,
  });
  return !error && data === true;
}

/** accept=true, or "Not tonight" (declined) with accept=false. */
export async function respondNightOut(
  supabase: SupabaseClient,
  nightOutId: string,
  accept: boolean,
): Promise<boolean> {
  if (!UUID_RE.test(nightOutId)) return false;
  const { data, error } = await supabase.rpc('respond_night_out', {
    p_night_out: nightOutId,
    p_accept: accept,
  });
  return !error && data === true;
}

/**
 * Member-scoped token resolution — viewing NEVER mutates membership (review
 * round 1, both lanes). Null = not a member (or error): fall to the preview
 * plus an explicit Join action.
 */
export async function resolveNightOutByToken(
  supabase: SupabaseClient,
  token: string,
): Promise<string | null> {
  if (!UUID_RE.test(token)) return null;
  const { data, error } = await supabase.rpc('resolve_night_out_by_token', {
    p_token: token,
  });
  return !error && typeof data === 'string' ? data : null;
}

/** Authenticated link recipient joins (becomes accepted); returns plan id. */
export async function joinNightOutByToken(
  supabase: SupabaseClient,
  token: string,
): Promise<string | null> {
  if (!UUID_RE.test(token)) return null;
  const { data, error } = await supabase.rpc('join_night_out_by_token', {
    p_token: token,
  });
  return !error && typeof data === 'string' ? data : null;
}

/**
 * Authenticated link recipient declines WITHOUT joining first; returns plan id.
 *
 * Round-2 review (Codex, high): the preview offered only Join, so saying "not
 * tonight" to a shared link meant accepting first — which recorded the user as
 * accepted and emitted an 'accepted' event the host could see.
 */
export async function declineNightOutByToken(
  supabase: SupabaseClient,
  token: string,
): Promise<string | null> {
  if (!UUID_RE.test(token)) return null;
  const { data, error } = await supabase.rpc('decline_night_out_by_token', {
    p_token: token,
  });
  return !error && typeof data === 'string' ? data : null;
}

export async function suggestNightOutBar(
  supabase: SupabaseClient,
  nightOutId: string,
  barId: string,
): Promise<boolean> {
  if (!UUID_RE.test(nightOutId) || !BAR_ID_RE.test(barId)) return false;
  const { data, error } = await supabase.rpc('suggest_night_out_bar', {
    p_night_out: nightOutId,
    p_bar: barId,
  });
  return !error && data === true;
}

export async function voteNightOutBar(
  supabase: SupabaseClient,
  nightOutId: string,
  barId: string,
): Promise<boolean> {
  if (!UUID_RE.test(nightOutId) || !BAR_ID_RE.test(barId)) return false;
  const { data, error } = await supabase.rpc('vote_night_out_bar', {
    p_night_out: nightOutId,
    p_bar: barId,
  });
  return !error && data === true;
}

type NightOutRow = {
  id: string;
  night: string;
  title: string | null;
  status: NightOut['status'];
  decided_bar_id: string | null;
  owner_handle: string | null;
  owner_display_name: string | null;
  share_token: string;
  caller_role: NightOut['callerRole'];
  caller_status: NightOut['callerStatus'];
};

/** Member-scoped plan read. Null = error OR the caller is not a member. */
export async function getNightOut(
  supabase: SupabaseClient,
  nightOutId: string,
): Promise<NightOut | null> {
  if (!UUID_RE.test(nightOutId)) return null;
  const { data, error } = await supabase.rpc('get_night_out', {
    p_night_out: nightOutId,
  });
  if (error || !Array.isArray(data) || data.length === 0) return null;
  const row = data[0] as NightOutRow;
  return {
    id: row.id,
    night: row.night,
    title: row.title,
    status: row.status,
    decidedBarId: row.decided_bar_id,
    ownerHandle: row.owner_handle,
    ownerDisplayName: row.owner_display_name,
    shareToken: row.share_token,
    callerRole: row.caller_role,
    callerStatus: row.caller_status,
  };
}

type MemberRow = {
  user_id: string;
  handle: string | null;
  display_name: string | null;
  role: NightOutMember['role'];
  invite_status: NightOutMember['inviteStatus'];
};

export async function getNightOutMembers(
  supabase: SupabaseClient,
  nightOutId: string,
): Promise<NightOutMember[] | null> {
  if (!UUID_RE.test(nightOutId)) return null;
  const { data, error } = await supabase.rpc('get_night_out_members', {
    p_night_out: nightOutId,
  });
  if (error || !Array.isArray(data)) return null;
  return (data as MemberRow[]).map((r) => ({
    userId: r.user_id,
    handle: r.handle,
    displayName: r.display_name,
    role: r.role,
    inviteStatus: r.invite_status,
  }));
}

type BoardRow = {
  bar_id: string;
  suggested_by_handle: string | null;
  votes: number | string;
  caller_voted: boolean | null;
};

export async function getNightOutBoard(
  supabase: SupabaseClient,
  nightOutId: string,
): Promise<NightOutBoardEntry[] | null> {
  if (!UUID_RE.test(nightOutId)) return null;
  const { data, error } = await supabase.rpc('get_night_out_board', {
    p_night_out: nightOutId,
  });
  if (error || !Array.isArray(data)) return null;
  return (data as BoardRow[]).map((r) => ({
    barId: r.bar_id,
    suggestedByHandle: r.suggested_by_handle,
    votes: Number(r.votes) || 0,
    callerVoted: r.caller_voted === true,
  }));
}

type PreviewRow = {
  night: string;
  title: string | null;
  status: string;
  owner_handle: string | null;
  owner_display_name: string | null;
  accepted_count: number | string;
};

/**
 * The ONE anonymous read — bearer token is the whole authorization
 * (criterion 5). Null = error, revoked link, or cancelled plan.
 */
export async function previewNightOut(
  supabase: SupabaseClient,
  token: string,
): Promise<NightOutPreview | null> {
  if (!UUID_RE.test(token)) return null;
  const { data, error } = await supabase.rpc('preview_night_out', {
    p_token: token,
  });
  if (error || !Array.isArray(data) || data.length === 0) return null;
  const row = data[0] as PreviewRow;
  return {
    night: row.night,
    title: row.title,
    status: row.status,
    ownerHandle: row.owner_handle,
    ownerDisplayName: row.owner_display_name,
    acceptedCount: Number(row.accepted_count) || 0,
  };
}
