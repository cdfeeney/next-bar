import type { SupabaseClient } from '@supabase/supabase-js';
import { inviteToNightOut } from '@/lib/nightOuts.server';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function inviteAll(
  supabase: SupabaseClient,
  planId: string,
  inviteeIds: readonly string[],
): Promise<{ invited: string[]; failed: string[] }> {
  const accounts = inviteeIds.filter((id) => UUID_RE.test(id));
  const invited: string[] = [];
  const failed: string[] = [];
  for (const id of accounts) {
    // Sequential on purpose: invite_to_night_out serialises on a per-plan
    // advisory lock, so firing them in parallel would just queue on the lock.
    if (await inviteToNightOut(supabase, planId, id)) invited.push(id);
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
