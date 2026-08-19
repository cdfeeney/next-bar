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
  // Null unless the caller is an ACCEPTED member: 0046's get_night_out gates
  // share_token on invite_status, so pending/declined callers receive SQL NULL.
  shareToken: string | null;
  callerRole: 'owner' | 'member' | null;
  callerStatus: 'pending' | 'accepted' | 'declined' | null;
  /**
   * Monotonic version of the caller's own response (0059). Pass THIS value back
   * to `respondNightOut` — the one that was rendered, never one fetched at click
   * time, because fetching at click time re-creates the replay window inside the
   * client. Null only when the caller has no membership row.
   */
  callerRevision: number | null;
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
/**
 * `idempotencyKey` makes a retry identifiable as the SAME attempt. Mint it once
 * before the first call and reuse it: a dropped connection after COMMIT is
 * indistinguishable from a failure, and retrying without a key creates a second
 * plan for the same night (cold panel, Codex).
 */
export async function createNightOut(
  supabase: SupabaseClient,
  night: string,
  title?: string,
  idempotencyKey?: string,
): Promise<string | null> {
  if (!NIGHT_RE.test(night)) return null;
  if (idempotencyKey !== undefined && !UUID_RE.test(idempotencyKey)) return null;
  const { data, error } = await supabase.rpc('create_night_out', {
    p_night: night,
    p_title: title ?? null,
    p_idempotency_key: idempotencyKey ?? null,
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
/**
 * `expectedStatus` and `expectedRevision` are the state the UI was showing when
 * the user acted. Pass BOTH, and pass what was RENDERED.
 *
 * This signature is not a preference — it is the only `respond_night_out` the
 * serving database has. 0057 dropped the 2-argument overload this module used to
 * call and 0059 dropped the 3-argument one, leaving
 * `(uuid, boolean, text, integer)` alone. Both review lanes filed the 2-argument
 * call as a HIGH: Accept and Decline resolved no function and failed live.
 *
 * Without the status, a replayed accept — a retried fetch, a double tap, a
 * request that sat in a queue — reversed a LATER decline and recorded the person
 * as coming when they had said no (cold panel, Codex, HIGH).
 *
 * The status alone was not enough, because a status is not a version: a row can
 * return to a status it already held, and the stale request then matches again
 * (reproduced 2026-08-17). The revision cannot come back — it only ever
 * increases — so comparing it is what actually makes a replay identifiable.
 *
 * `expectedRevision` is deliberately REQUIRED with no "skip the check" value. A
 * nullable revision would reopen the hole for every caller that forgot, which is
 * exactly how 0057's 2-argument overload became a problem; 0059 drops the
 * 3-argument form for the same reason.
 */
export async function respondNightOut(
  supabase: SupabaseClient,
  nightOutId: string,
  accept: boolean,
  expectedStatus: 'pending' | 'accepted' | 'declined',
  expectedRevision: number,
): Promise<boolean> {
  if (!UUID_RE.test(nightOutId)) return false;
  // A non-integer or negative revision can only come from a caller that never
  // rendered one. Refuse locally rather than sending a value the RPC will
  // reject, so the failure is attributable here.
  if (!Number.isInteger(expectedRevision) || expectedRevision < 0) return false;
  const { data, error } = await supabase.rpc('respond_night_out', {
    p_night_out: nightOutId,
    p_accept: accept,
    p_expected_status: expectedStatus,
    p_expected_revision: expectedRevision,
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
/**
 * Is this plan at the member cap? Asked only on a FAILURE path, so the UI can
 * say "full" instead of "the link may have expired" — join_night_out_by_token
 * returns null for both, and respond_night_out returns false for both
 * (round-3 review, Claude: retrying is advice that can never succeed).
 */
export async function isNightOutFullByToken(
  supabase: SupabaseClient,
  token: string,
): Promise<boolean> {
  if (!UUID_RE.test(token)) return false;
  const { data, error } = await supabase.rpc('night_out_is_full_by_token', {
    p_token: token,
  });
  return !error && data === true;
}

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
  share_token: string | null;
  caller_role: NightOut['callerRole'];
  caller_status: NightOut['callerStatus'];
  caller_revision?: number | null;
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
    // Normalised to null, never left undefined: a row without the column at
    // all must take the same "no revision was rendered" branch in callers as an
    // explicit null, instead of slipping past a null check and reaching the RPC
    // as undefined.
    callerRevision: row.caller_revision ?? null,
  };
}

type MemberRow = {
  user_id: string;
  handle: string | null;
  display_name: string | null;
  role: NightOutMember['role'];
  invite_status: NightOutMember['inviteStatus'];
};


/**
 * One row of Social → Plans. Everything the approved invitation card needs and
 * nothing else: no other members' identities, no ratings, no scores.
 */
export type MyNightOut = {
  nightOutId: string;
  night: string;
  title: string | null;
  status: NightOut['status'];
  ownerHandle: string | null;
  ownerDisplayName: string | null;
  myStatus: 'pending' | 'accepted' | 'declined';
  respondedAt: string | null;
  acceptedCount: number;
  /** Null unless the caller is ACCEPTED — the rule 0047 set at the grant. */
  shareToken: string | null;
  planUpdated: boolean;
  isPast: boolean;
  /** Monotonic version of this response (0059) — pass it back as rendered. */
  myRevision: number;
};

type MyNightOutRow = {
  night_out_id: string;
  night: string;
  title: string | null;
  status: NightOut['status'];
  owner_handle: string | null;
  owner_display_name: string | null;
  my_status: MyNightOut['myStatus'];
  responded_at: string | null;
  accepted_count: number;
  share_token: string | null;
  plan_updated: boolean;
  is_past: boolean;
  my_revision: number;
};

/**
 * "What am I invited to?" — the query that did not exist until 0052, which is
 * why account-targeted invitations were invisible to their recipients.
 *
 * The columns read here are the SERVING function's, which is 0059's revision of
 * it, not the 0052 body in this tree. 0052 is applied and checksum-recorded, so
 * it is immutable; 0053 and 0059 corrected it additively (NYC rollover for
 * `is_past`, owner rows excluded, soonest-night ordering, and `my_revision`).
 * Reading this file alone will understate the live shape by one column.
 */
export async function getMyNightOuts(
  supabase: SupabaseClient,
): Promise<MyNightOut[] | null> {
  const { data, error } = await supabase.rpc('get_my_night_outs');
  if (error || !Array.isArray(data)) return null;
  return (data as MyNightOutRow[]).map((r) => ({
    nightOutId: r.night_out_id,
    night: r.night,
    title: r.title,
    status: r.status,
    ownerHandle: r.owner_handle,
    ownerDisplayName: r.owner_display_name,
    myStatus: r.my_status,
    respondedAt: r.responded_at,
    acceptedCount: r.accepted_count,
    shareToken: r.share_token,
    planUpdated: r.plan_updated,
    isPast: r.is_past,
    myRevision: r.my_revision,
  }));
}

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
