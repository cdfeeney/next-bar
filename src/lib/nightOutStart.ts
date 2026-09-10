import type { SupabaseClient } from '@supabase/supabase-js';
import { inviteOneToNightOut, suggestNightOutBar } from '@/lib/nightOuts.server';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Invite everyone the owner selected, one server call per person, in order.
 *
 * Every call goes through `invite_one_to_night_out` (0067): it refuses a pair
 * that has blocked either way, and when the person was picked THROUGH a group
 * (`groupByUser[id]`) the server re-checks that they are a current member of
 * that group, so a client-cached roster can never reach someone the caller may
 * not. The inherited `invite_to_night_out` (0050) has no block check and is not
 * used here (round-1 panel, Codex). Sequential on purpose: the RPC serialises
 * on a per-plan advisory lock, so parallel calls would only queue on it.
 * Duplicates in `inviteeIds` are preserved as given — dedupe is the picker's job.
 */
export async function inviteAll(
  supabase: SupabaseClient,
  planId: string,
  inviteeIds: readonly string[],
  groupByUser: Readonly<Record<string, string | null>> = {},
): Promise<{ invited: string[]; failed: string[] }> {
  const accounts = inviteeIds.filter((id) => UUID_RE.test(id));
  const invited: string[] = [];
  const failed: string[] = [];
  for (const id of accounts) {
    if (await inviteOneToNightOut(supabase, planId, id, groupByUser[id] ?? null)) invited.push(id);
    else failed.push(id);
  }
  return { invited, failed };
}

/**
 * V9-05: put the organizer's shortlist on the plan's board, one
 * `suggest_night_out_bar` per bar, in order. The owner is an accepted member
 * from `create_night_out` (0044:265-268), so the RPC accepts them; it is
 * idempotent per (plan, bar) and capped at three live suggestions per member,
 * so a retry of a failed bar can never double-post. Duplicates are collapsed
 * here because a bar is on the shortlist once, whatever the picker sent.
 */
export async function suggestAll(
  supabase: SupabaseClient,
  planId: string,
  barIds: readonly string[],
): Promise<{ suggested: string[]; failed: string[] }> {
  const suggested: string[] = [];
  const failed: string[] = [];
  for (const barId of [...new Set(barIds)]) {
    if (await suggestNightOutBar(supabase, planId, barId)) suggested.push(barId);
    else failed.push(barId);
  }
  return { suggested, failed };
}

export function startOutcome({
  refusedEdits,
  failedInvites,
  failedSuggestions = 0,
  nightMoved,
  editsTimedOut,
}: {
  refusedEdits: readonly string[];
  failedInvites: number;
  /** V9-05: shortlist bars the board refused — held like a failed invite. */
  failedSuggestions?: number;
  nightMoved: string | null;
  editsTimedOut: boolean;
}): 'navigate' | 'hold' {
  return refusedEdits.length > 0
    || failedInvites > 0
    || failedSuggestions > 0
    || nightMoved !== null
    || editsTimedOut === true
    ? 'hold'
    : 'navigate';
}
