import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * The three OWNER edits on a Night Out plan — When, Area and Voting closes
 * (V8-R-NO-002, V8-R-NO-003, V8-R-NO-005).
 *
 * Migration 0068 added the columns and the three writers in round 4, and every
 * round since shipped them with NO CALLER: `set_night_out_start`,
 * `set_night_out_area` and `set_night_out_voting_deadline` appeared nowhere in
 * `src`, so all three requirements were unreachable from the product. This
 * module is the client half.
 *
 * AUTHORIZATION IS THE DATABASE'S. Each RPC checks owner, plan status and — for
 * the deadline — that voting is still open. Nothing here repeats those checks;
 * a `false` is the server declining, and it is reported rather than swallowed.
 *
 * NULL IS A REAL VALUE IN ALL THREE. Clearing an edit returns the plan to its
 * default (9:00 PM for the start, unset for the area, "No deadline" for the
 * vote) and is not the same as failing to set one.
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function setOne(
  supabase: SupabaseClient,
  fn: string,
  nightOutId: string,
  args: Record<string, unknown>,
): Promise<boolean> {
  if (!UUID_RE.test(nightOutId)) return false;
  try {
    const { data, error } = await supabase.rpc(fn, {
      p_night_out: nightOutId,
      ...args,
    });
    return !error && data === true;
  } catch {
    // A throw is a refusal we could not read, never a success.
    return false;
  }
}

/** V8-R-NO-002. `startsAt` is an ISO instant, or null for the 9:00 PM default. */
export function setNightOutStart(
  supabase: SupabaseClient,
  nightOutId: string,
  startsAt: string | null,
): Promise<boolean> {
  return setOne(supabase, 'set_night_out_start', nightOutId, {
    p_starts_at: startsAt,
  });
}

/** V8-R-NO-003. `area` is free text (≤60 chars), or null to clear it. */
export function setNightOutArea(
  supabase: SupabaseClient,
  nightOutId: string,
  area: string | null,
): Promise<boolean> {
  return setOne(supabase, 'set_night_out_area', nightOutId, { p_area: area });
}

/** V8-R-NO-005. `closesAt` is an ISO instant, or null for "No deadline". */
export function setNightOutVotingDeadline(
  supabase: SupabaseClient,
  nightOutId: string,
  closesAt: string | null,
): Promise<boolean> {
  return setOne(supabase, 'set_night_out_voting_deadline', nightOutId, {
    p_closes_at: closesAt,
  });
}
