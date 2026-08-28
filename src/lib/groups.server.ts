import type { SupabaseClient } from '@supabase/supabase-js';

import { mediaFailure, mediaUnavailable, type MediaResult } from '@/lib/media/types';

/**
 * Server-mode Group operations (migration 0067).
 *
 * WHY `MediaResult` AND NOT THIS REPOSITORY'S OTHER HOUSE PATTERN.
 *
 * `nightOuts.server.ts` returns `null`/`false` on failure, and that is the right
 * shape there. It is the wrong shape here, because almost every Group
 * requirement carries an explicit clause about what a failure must SAY:
 *
 *   V8-R-GRP-001/002  "a failed send is stated and retryable; it never silently
 *                      drops" and "send state is stated in words".
 *   V8-R-GRP-005      "a failed administrative write must not report success".
 *   V8-R-GRP-006      "a failed leave must not report success".
 *   V8-R-GRP-007      "a failed deletion must not report success".
 *
 * A bare `false` cannot be stated in words — the caller has to invent the
 * sentence, and every call site invents a different one. `MediaResult` is the
 * discriminated union the WP1 boundary this module already crosses uses for
 * exactly that reason, so a failure arrives carrying its own message and a
 * caller cannot accidentally treat it as a success.
 *
 * EVERY WRITE IS A SECURITY DEFINER RPC. 0067 grants `authenticated` nothing but
 * SELECT on the four tables, so this module is the client surface and the
 * database is the authorization — not this file. The checks here are input
 * bounds, never the security boundary: an id that fails `UUID_RE` is refused
 * before a round trip, and one that passes is still judged by the server.
 *
 * THIS MODULE SENDS NO PUSH NOTIFICATION, and that omission is V8-R-GRP-008
 * rather than an oversight: "V8 DOES NOT SEND A PUSH NOTIFICATION FOR EVERY
 * ORDINARY GROUP MESSAGE." Unread state is something the app READS, through
 * {@link fetchUnreadCounts}.
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Matches 0067's `length(btrim(name)) between 1 and 60`. */
export const MAX_GROUP_NAME_LENGTH = 60;

/** Matches 0067's `length(body) <= 2000`. */
export const MAX_GROUP_MESSAGE_LENGTH = 2000;

/**
 * One page of a group thread. EXPORTED because the client needs it: a caller that marks a thread
 * read has to know whether the page it received was TRUNCATED, and a hardcoded 200 in two files
 * drifts. See the watermark note in GroupThread.
 */
export const GROUP_THREAD_PAGE = 200;

export type Group = {
  id: string;
  name: string;
  createdAt: string;
};

export type GroupMember = {
  profileId: string;
  handle: string | null;
  displayName: string | null;
  isAdmin: boolean;
  joinedAt: string;
};

export type GroupMessage = {
  id: string;
  groupId: string;
  senderId: string;
  senderHandle: string | null;
  senderDisplayName: string | null;
  body: string | null;
  /**
   * The media REGISTRY id, never a storage path. A photo is fetched through
   * `/api/media/:mediaId/url`, which is where the server decides the signed
   * lifetime (V8-R-STO-015). A path here would let a caller mint its own.
   */
  mediaId: string | null;
  createdAt: string;
};

/** One person's outcome from {@link inviteGroupToNightOut}. */
export type GroupInviteOutcome = {
  profileId: string;
  invited: boolean;
};

function isUuid(value: string | null | undefined): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

/**
 * A rejected input, phrased for a person.
 *
 * Separate from `'failed'` on purpose: 'rejected' is "that cannot work as
 * asked", which is not retryable, while 'failed' is "that did not complete",
 * which is. The UI shows a Retry on one and not the other.
 */
function rejected<T>(message: string): MediaResult<T> {
  return mediaFailure('rejected', message);
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * The caller's groups.
 *
 * FAILS CLOSED as a FAILURE, never as an empty list. An empty array would render
 * "you have no groups" for someone whose groups exist and could not be loaded —
 * the same collapse `listReportedSubjects` refuses, and the same one Social's
 * feed states outright: an empty surface and an unreachable backend must never
 * look the same.
 */
export async function fetchMyGroups(
  client: SupabaseClient | null,
): Promise<MediaResult<Group[]>> {
  if (client === null) return mediaUnavailable();

  try {
    // Through the RLS SELECT policy, which admits exactly the caller's own
    // groups (`is_group_member`). No caller-side filter is needed and none is
    // added: a filter here would be a second, weaker copy of that rule.
    const { data, error } = await client
      .from('groups')
      .select('id, name, created_at')
      .order('created_at', { ascending: false });

    if (error) {
      return mediaFailure('failed', 'Your groups could not be loaded.');
    }

    const rows = (data ?? []) as { id: string; name: string; created_at: string }[];
    return {
      ok: true,
      value: rows.map((row) => ({
        id: row.id,
        name: row.name,
        createdAt: row.created_at,
      })),
    };
  } catch {
    return mediaUnavailable();
  }
}

type MemberRow = {
  profile_id: string;
  handle: string | null;
  display_name: string | null;
  is_admin: boolean;
  joined_at: string;
};

/**
 * A group's roster, in succession order.
 *
 * THROUGH THE RPC, NOT A POSTGREST EMBED, and the reason is structural rather
 * than stylistic. `public.profiles` carries NO client SELECT policy — 0006's
 * handle-enumeration guard, which 0010 restates in as many words. A
 * `group_members?select=...,profiles(handle,display_name)` embed therefore
 * resolves the membership rows and returns NULL for every embedded profile: the
 * roster renders nameless, with no error anywhere to explain it.
 * `get_group_members` is the definer join 0010 established for exactly this.
 *
 * The order is `joined_at, profile_id` — the same order D-C-38 succeeds in — so
 * the surface that names the administrator and the database that would choose
 * the next one agree about who is longest-standing.
 */
export async function fetchGroupMembers(
  client: SupabaseClient | null,
  groupId: string,
): Promise<MediaResult<GroupMember[]>> {
  if (client === null) return mediaUnavailable();
  if (!isUuid(groupId)) return rejected('That group could not be found.');

  try {
    const { data, error } = await client.rpc('get_group_members', {
      p_group: groupId,
    });

    if (error) {
      return mediaFailure('failed', 'That group could not be loaded.');
    }

    const rows = (data ?? []) as MemberRow[];
    return {
      ok: true,
      value: rows.map((row) => ({
        profileId: row.profile_id,
        handle: row.handle,
        displayName: row.display_name,
        isAdmin: row.is_admin === true,
        joinedAt: row.joined_at,
      })),
    };
  } catch {
    return mediaUnavailable();
  }
}

type MessageRow = {
  id: string;
  sender_id: string;
  sender_handle: string | null;
  sender_display_name: string | null;
  body: string | null;
  media_id: string | null;
  created_at: string;
};

/**
 * The thread, oldest first.
 *
 * NOTHING IS FILTERED HERE. Membership, the reporter's hide (V8-R-FEED-010) and
 * the block (V8-R-FEED-009) are all applied inside `get_group_thread`, through
 * the same `group_message_is_visible` the SELECT policy and the unread count
 * ask. Repeating any of them client-side would be a second definition of a
 * server rule — and a client-side hide is precisely what both of those
 * requirements refuse to accept as enforcement.
 *
 * Like the roster, this goes through the RPC rather than the table so the
 * sender's handle can be joined: `public.profiles` has no client SELECT.
 */
export async function fetchGroupMessages(
  client: SupabaseClient | null,
  groupId: string,
  limit = GROUP_THREAD_PAGE,
): Promise<MediaResult<GroupMessage[]>> {
  if (client === null) return mediaUnavailable();
  if (!isUuid(groupId)) return rejected('That group could not be found.');

  const bounded = Math.min(Math.max(Math.trunc(limit) || 0, 1), 500);

  try {
    const { data, error } = await client.rpc('get_group_thread', {
      p_group: groupId,
      p_limit: bounded,
    });

    if (error) {
      return mediaFailure('failed', 'That conversation could not be loaded.');
    }

    const rows = (data ?? []) as MessageRow[];
    return {
      ok: true,
      value: rows.map((row) => ({
        id: row.id,
        groupId,
        senderId: row.sender_id,
        senderHandle: row.sender_handle,
        senderDisplayName: row.sender_display_name,
        body: row.body,
        mediaId: row.media_id,
        createdAt: row.created_at,
      })),
    };
  } catch {
    return mediaUnavailable();
  }
}

/**
 * In-app unread counts, per group (V8-R-GRP-008).
 *
 * This is the WHOLE delivery mechanism for ordinary group messages. There is no
 * push here and none in 0067: "V8 DOES NOT SEND A PUSH NOTIFICATION FOR EVERY
 * ORDINARY GROUP MESSAGE."
 */
export async function fetchUnreadCounts(
  client: SupabaseClient | null,
): Promise<MediaResult<Map<string, number>>> {
  if (client === null) return mediaUnavailable();

  try {
    const { data, error } = await client.rpc('group_unread_counts');

    if (error) {
      return mediaFailure('failed', 'Unread counts could not be loaded.');
    }

    const rows = (data ?? []) as { group_id: string; unread_count: number }[];
    return {
      ok: true,
      value: new Map(rows.map((row) => [row.group_id, Number(row.unread_count) || 0])),
    };
  } catch {
    return mediaUnavailable();
  }
}

// ---------------------------------------------------------------------------
// Administration (V8-R-GRP-004, V8-R-GRP-005, V8-R-GRP-006)
// ---------------------------------------------------------------------------

/** Create a named group. The creator becomes the initial administrator. */
export async function createGroup(
  client: SupabaseClient | null,
  name: string,
): Promise<MediaResult<string>> {
  if (client === null) return mediaUnavailable();

  const trimmed = name.trim();
  if (trimmed.length === 0) return rejected('Give the group a name.');
  if (trimmed.length > MAX_GROUP_NAME_LENGTH) {
    return rejected(`Keep the name under ${MAX_GROUP_NAME_LENGTH} characters.`);
  }

  try {
    const { data, error } = await client.rpc('create_group', { p_name: trimmed });

    // A NON-STRING IS A FAILURE. The RPC returns the new group's uuid, so
    // anything else means no group was created — and "a failed creation keeps
    // the typed name" only works if the caller learns it failed.
    if (error || typeof data !== 'string' || data.length === 0) {
      return mediaFailure('failed', 'That group could not be created. Try again.');
    }

    return { ok: true, value: data };
  } catch {
    return mediaUnavailable();
  }
}

/** Rename a group. Administrator only, enforced by 0067. */
export async function renameGroup(
  client: SupabaseClient | null,
  groupId: string,
  name: string,
): Promise<MediaResult<true>> {
  if (client === null) return mediaUnavailable();
  if (!isUuid(groupId)) return rejected('That group could not be found.');

  const trimmed = name.trim();
  if (trimmed.length === 0) return rejected('Give the group a name.');
  if (trimmed.length > MAX_GROUP_NAME_LENGTH) {
    return rejected(`Keep the name under ${MAX_GROUP_NAME_LENGTH} characters.`);
  }

  try {
    const { data, error } = await client.rpc('rename_group', {
      p_group: groupId,
      p_name: trimmed,
    });

    if (error || data !== true) {
      return mediaFailure('failed', 'That group could not be renamed.');
    }
    return { ok: true, value: true };
  } catch {
    return mediaUnavailable();
  }
}

/**
 * Add a mutual friend to a group. Administrator only.
 *
 * The mutual-friend rule and the block (V8-R-FEED-009) are both enforced inside
 * 0067's `add_group_member`, which asks `is_mutual_friend` — the predicate 0066
 * put the block INSIDE precisely so no call site has to remember it.
 */
export async function addGroupMember(
  client: SupabaseClient | null,
  groupId: string,
  profileId: string,
): Promise<MediaResult<true>> {
  if (client === null) return mediaUnavailable();
  if (!isUuid(groupId)) return rejected('That group could not be found.');
  if (!isUuid(profileId)) return rejected('That person could not be found.');

  try {
    const { data, error } = await client.rpc('add_group_member', {
      p_group: groupId,
      p_profile: profileId,
    });

    if (error || data !== true) {
      return mediaFailure('failed', 'They could not be added to the group.');
    }
    return { ok: true, value: true };
  } catch {
    return mediaUnavailable();
  }
}

/** Remove a member. Administrator only; leaving yourself is {@link leaveGroup}. */
export async function removeGroupMember(
  client: SupabaseClient | null,
  groupId: string,
  profileId: string,
): Promise<MediaResult<true>> {
  if (client === null) return mediaUnavailable();
  if (!isUuid(groupId)) return rejected('That group could not be found.');
  if (!isUuid(profileId)) return rejected('That person could not be found.');

  try {
    const { data, error } = await client.rpc('remove_group_member', {
      p_group: groupId,
      p_profile: profileId,
    });

    // `false` means nothing was removed. Reported as a failure rather than
    // shrugged off, because the surface would otherwise drop a row for someone
    // who is still in the group.
    if (error || data !== true) {
      return mediaFailure('failed', 'They could not be removed from the group.');
    }
    return { ok: true, value: true };
  } catch {
    return mediaUnavailable();
  }
}

/**
 * Leave a group (V8-R-GRP-006).
 *
 * The consequences — administrator succession, and deletion of the group when
 * the last member leaves — are D-C-38's and are applied by 0067 inside the same
 * transaction. The requirement's failure clause is "a failed leave must not
 * report success; if succession cannot be computed the leave FAILS CLOSED", and
 * that assertion lives in `leave_group`, which raises and rolls the leave back.
 * Here a raise surfaces as `error`, so it becomes a stated failure rather than a
 * silent success.
 */
export async function leaveGroup(
  client: SupabaseClient | null,
  groupId: string,
): Promise<MediaResult<true>> {
  if (client === null) return mediaUnavailable();
  if (!isUuid(groupId)) return rejected('That group could not be found.');

  // THE 40P01 RETRY, and it is the SHIPPED answer to a ceiling the database cannot remove.
  //
  // Two departure routes reach D-C-38 succession in opposite lock orders — leave_group takes the
  // per-group advisory lock then the row, the profiles ON DELETE CASCADE route holds the row lock
  // first — so PostgreSQL can detect a cycle and abort one side with SQLSTATE 40P01. Round 2 tried
  // to remove that with a BEFORE DELETE trigger and could not: GetTupleForTrigger locks the tuple
  // before any BEFORE-ROW trigger body runs, so advisory-before-row is unreachable from a trigger
  // on that table. See the long note in 0067_groups.sql.
  //
  // A deadlock abort is FAIL-CLOSED, not corruption: Postgres rolls one transaction back whole, no
  // group is left administrator-less, and the competing transaction has finished by the time we
  // come back. So the honest handling is one retry here rather than a failure message for
  // something the user did nothing wrong to cause. ONE retry, not a loop: a second 40P01 means
  // sustained contention, which is a real condition to report rather than to hide behind spinning.
  const attempt = async (): Promise<{ deadlocked: boolean; ok: boolean }> => {
    const { data, error } = await client.rpc('leave_group', { p_group: groupId });
    if (error) {
      return { deadlocked: error.code === '40P01', ok: false };
    }
    return { deadlocked: false, ok: data === true };
  };

  try {
    let result = await attempt();
    if (result.deadlocked) result = await attempt();

    if (!result.ok) {
      return mediaFailure('failed', 'You could not be removed from that group.');
    }
    return { ok: true, value: true };
  } catch {
    return mediaUnavailable();
  }
}

// ---------------------------------------------------------------------------
// Messages (V8-R-GRP-002, V8-R-GRP-007, V8-R-GRP-008)
// ---------------------------------------------------------------------------

/**
 * Send text, a photo, or both (V8-R-GRP-002).
 *
 * `mediaId` IS THE BOUNDARY. It names a `media_objects` row, which only
 * `POST /api/media/upload` mints and only after decoding and re-encoding the
 * bytes — so a group photo cannot be uploaded any other way. Accepting a storage
 * path instead would accept a string a modified client can invent, which
 * V8-R-STO-014 rejects as a trust boundary by definition.
 *
 * "a failed send is stated and retryable and never silently dropped" — hence a
 * `MediaResult`, and hence no optimistic id: the caller has a message id only
 * when the server wrote one.
 */
export async function sendGroupMessage(
  client: SupabaseClient | null,
  groupId: string,
  body: string | null,
  mediaId: string | null = null,
): Promise<MediaResult<string>> {
  if (client === null) return mediaUnavailable();
  if (!isUuid(groupId)) return rejected('That group could not be found.');

  const trimmed = body?.trim() ?? '';
  if (mediaId !== null && !isUuid(mediaId)) {
    return rejected('That photo could not be sent.');
  }
  if (trimmed.length === 0 && mediaId === null) {
    return rejected('Write something, or add a photo.');
  }
  if (trimmed.length > MAX_GROUP_MESSAGE_LENGTH) {
    return rejected(`Keep it under ${MAX_GROUP_MESSAGE_LENGTH} characters.`);
  }

  try {
    const { data, error } = await client.rpc('send_group_message', {
      p_group: groupId,
      p_body: trimmed.length > 0 ? trimmed : null,
      p_media_id: mediaId,
    });

    if (error || typeof data !== 'string' || data.length === 0) {
      return mediaFailure('failed', 'That message was not sent. Try again.');
    }

    return { ok: true, value: data };
  } catch {
    return mediaUnavailable();
  }
}

/**
 * Delete a message (V8-R-GRP-007) — the sender for everyone, or an
 * administrator.
 *
 * 0067 also retires the message's `media_destinations` row, so a deleted photo
 * stops holding its bytes off reclamation. Nothing here removes bytes: that is
 * the reclamation sweep's job, under the row lock that makes it safe.
 */
export async function deleteGroupMessage(
  client: SupabaseClient | null,
  messageId: string,
): Promise<MediaResult<true>> {
  if (client === null) return mediaUnavailable();
  if (!isUuid(messageId)) return rejected('That message could not be found.');

  try {
    const { data, error } = await client.rpc('delete_group_message', {
      p_message: messageId,
    });

    if (error || data !== true) {
      return mediaFailure('failed', 'That message could not be deleted.');
    }
    return { ok: true, value: true };
  } catch {
    return mediaUnavailable();
  }
}

/** Mark a thread read (V8-R-GRP-008). In-app state; nothing is pushed. */
/**
 * Mark a thread read UP TO A WATERMARK — the newest message the viewer was actually shown.
 *
 * Round-3 finding: this used to let the database stamp `now()`, so read state advanced past any
 * message that landed between the thread fetch and this call. Those messages were never rendered,
 * yet they were marked read and dropped out of the unread badge with no way back. Only the caller
 * knows what was on screen, so the caller supplies the boundary. Omitting it preserves the old
 * behaviour for an empty thread, and the RPC refuses a watermark from the future.
 */
export async function markGroupRead(
  client: SupabaseClient | null,
  groupId: string,
  through?: string | null,
): Promise<MediaResult<true>> {
  if (client === null) return mediaUnavailable();
  if (!isUuid(groupId)) return rejected('That group could not be found.');

  try {
    const { data, error } = await client.rpc('mark_group_read', {
      p_group: groupId,
      p_through: through ?? null,
    });

    if (error || data !== true) {
      return mediaFailure('failed', 'That conversation could not be marked read.');
    }
    return { ok: true, value: true };
  } catch {
    return mediaUnavailable();
  }
}

// ---------------------------------------------------------------------------
// Night Out reuse (V8-R-GRP-003)
// ---------------------------------------------------------------------------

/**
 * Invite the group's CURRENT membership to a Night Out.
 *
 * ANY MEMBER may do this — not only the administrator — and the group's own
 * membership is untouched: 0067 writes nothing to `group_members` here.
 *
 * PER-PERSON OUTCOMES, because the requirement's failure clause is "a failed
 * invite shows a per-person Resend invite; other successful invites are
 * unaffected". A single boolean would have to round a mixed result to one
 * answer, and either answer would be a lie about somebody.
 */
/**
 * Re-invite ONE person to a Night Out, for V8-R-GRP-003's per-person Resend.
 *
 * Separate from {@link inviteGroupToNightOut} deliberately. The requirement says "a failed invite
 * shows a per-person Resend invite; other successful invites are unaffected" — re-running the
 * whole-group call to retry one person is what "unaffected" forbids, and it would also re-notify
 * (V8-R-GRP-008 is a notification-VOLUME requirement).
 *
 * IT CALLS THE SHARED DOOR, NOT `invite_to_night_out`. Round-2 finding, raised by both review
 * lanes: this path used to call `invite_to_night_out` directly, which skips the invitation
 * notification that only the group path recorded — so the people whose first invite failed, the
 * exact people this exists for, joined the plan silently. `invite_one_to_night_out` is the one
 * place newness, the invite and the notification live, and both paths go through it.
 *
 * It remains idempotent by design: a person already on the plan returns true and no seat is taken,
 * so a Resend racing an accepted invite is harmless and notifies nobody twice.
 */
export async function inviteNightOutMember(
  client: SupabaseClient | null,
  nightOutId: string,
  profileId: string,
): Promise<MediaResult<boolean>> {
  if (client === null) return mediaUnavailable();
  if (!isUuid(nightOutId)) return rejected('That plan could not be found.');
  if (!isUuid(profileId)) return rejected('That person could not be found.');

  try {
    const { data, error } = await client.rpc('invite_one_to_night_out', {
      p_night_out: nightOutId,
      p_user: profileId,
      p_group: null,
    });

    if (error) {
      return mediaFailure('failed', 'That invite could not be sent. Try again.');
    }

    return { ok: true, value: data === true };
  } catch {
    return mediaUnavailable();
  }
}

export async function inviteGroupToNightOut(
  client: SupabaseClient | null,
  nightOutId: string,
  groupId: string,
): Promise<MediaResult<GroupInviteOutcome[]>> {
  if (client === null) return mediaUnavailable();
  if (!isUuid(nightOutId)) return rejected('That plan could not be found.');
  if (!isUuid(groupId)) return rejected('That group could not be found.');

  try {
    const { data, error } = await client.rpc('invite_group_to_night_out', {
      p_night_out: nightOutId,
      p_group: groupId,
    });

    if (error) {
      return mediaFailure('failed', 'The group could not be invited. Try again.');
    }

    const rows = (data ?? []) as { profile_id: string; invited: boolean }[];
    return {
      ok: true,
      value: rows.map((row) => ({
        profileId: row.profile_id,
        invited: row.invited === true,
      })),
    };
  } catch {
    return mediaUnavailable();
  }
}
