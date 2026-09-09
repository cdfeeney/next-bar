import type { SupabaseClient } from '@supabase/supabase-js';
import { inviteOneToNightOut } from '@/lib/nightOuts.server';

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

export function startOutcome({
  refusedEdits,
  failedInvites,
  nightMoved,
  editsTimedOut,
}: {
  refusedEdits: readonly string[];
  failedInvites: number;
  nightMoved: string | null;
  editsTimedOut: boolean;
}): 'navigate' | 'hold' {
  return refusedEdits.length > 0
    || failedInvites > 0
    || nightMoved !== null
    || editsTimedOut === true
    ? 'hold'
    : 'navigate';
}
