import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * The two plan actions migration 0068 section 8c/8d adds, wrapped in the same
 * shape `src/lib/nightOuts.server.ts` uses for the rest of the plan surface.
 *
 * They live here rather than there because 0068 is this lane's migration and
 * `nightOuts.server.ts` belongs to another; the wrappers are three lines each
 * and duplicating the module's conventions is cheaper than reaching across a
 * write boundary for them.
 *
 * Both are authorized SERVER-SIDE and neither repeats that authorization here.
 * The UI uses the same predicates only to decide what to RENDER — offering a
 * control that cannot succeed reads as a bug in the app, and hiding one the
 * server would honour is a feature nobody can reach — but the decision is the
 * database's in both cases.
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BAR_ID_RE = /^[a-z0-9-]{1,60}$/;

async function callRpc(
  supabase: SupabaseClient,
  fn: string,
  args: Record<string, unknown>,
): Promise<{ data: unknown; error: unknown }> {
  try {
    return await supabase.rpc(fn, args);
  } catch (thrown) {
    return { data: null, error: thrown ?? new Error(`${fn} threw`) };
  }
}

/**
 * V8-R-SOC-007: close voting and take the TOP bar.
 *
 * The bar is not a parameter. "Lock the plan" has one object — the leader — and
 * the leader is read inside the same serialized section that decides it, so a
 * vote landing while the owner's thumb is moving cannot leave the plan locked to
 * a bar that was not on top when the lock landed.
 *
 * Returns the locked bar id, or null when the lock did not happen: not the
 * owner, the plan is not open, the shortlist is empty, or the call failed. "A
 * failed lock leaves voting open and says so" — a null must be reported, never
 * treated as a lock whose answer went missing.
 */
export async function lockNightOut(
  supabase: SupabaseClient,
  nightOutId: string,
): Promise<string | null> {
  if (!UUID_RE.test(nightOutId)) return null;
  const { data, error } = await callRpc(supabase, 'lock_night_out', {
    p_night_out: nightOutId,
  });
  if (error) return null;
  return typeof data === 'string' && BAR_ID_RE.test(data) ? data : null;
}

/**
 * V8-R-SOC-008: remove one shortlist entry, and the votes cast for it.
 *
 * Authorized to the entry's own suggester or to the plan owner, decided by the
 * RPC. False on any refusal.
 */
export async function removeNightOutSuggestion(
  supabase: SupabaseClient,
  nightOutId: string,
  barId: string,
): Promise<boolean> {
  if (!UUID_RE.test(nightOutId) || !BAR_ID_RE.test(barId)) return false;
  const { data, error } = await callRpc(
    supabase,
    'remove_night_out_suggestion',
    { p_night_out: nightOutId, p_bar: barId },
  );
  return !error && data === true;
}
