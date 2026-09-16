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

/**
 * V8-R-NO-005: the voting deadline as a PARTICIPANT sees it — they read it and
 * cannot change it, and once it passes their plan is read-only.
 *
 * `votingOpen` is the SERVER's answer, from the same predicate the writers ask,
 * so the controls disappear at the instant the RPCs start refusing rather than
 * whenever the device's clock happens to agree. Null means we could not read
 * it, which is not the same as "voting is closed" and must not be rendered as
 * one.
 */
export type NightOutVoting = {
  votingClosesAt: string | null;
  votingOpen: boolean;
};

export async function fetchNightOutVoting(
  supabase: SupabaseClient,
  nightOutId: string,
): Promise<NightOutVoting | null> {
  if (!UUID_RE.test(nightOutId)) return null;
  const { data, error } = await callRpc(supabase, 'get_night_out_voting', {
    p_night_out: nightOutId,
  });
  if (error) return null;
  const row = (Array.isArray(data) ? data[0] : data) as
    | { voting_closes_at?: unknown; voting_open?: unknown }
    | null
    | undefined;
  // A non-boolean answer is a row we could not read, not a closed vote: a
  // coerced value here would withdraw every participant control on a guess.
  if (!row || typeof row.voting_open !== 'boolean') return null;
  return {
    votingClosesAt:
      typeof row.voting_closes_at === 'string' && row.voting_closes_at.length > 0
        ? row.voting_closes_at
        : null,
    votingOpen: row.voting_open,
  };
}

/**
 * G-01 / R-04: one share-link reply, as members see it. `guestName` is null for
 * a nameless one (a "can't make it", or a Going/Maybe written before 0080).
 */
export type AnonGuest = { guestName: string | null; response: 'going' | 'maybe' | 'declined' };

const ANON_RESPONSES: ReadonlySet<string> = new Set(['going', 'maybe', 'declined']);

/**
 * G-01 / R-04: EVERY reply on a plan, members only (`get_night_out_anon_guests`,
 * widened in 0081 to carry the nameless rows). One read, one snapshot — the
 * board derives the named rows and the nameless remainder from this alone, so
 * a guest can never be a Maybe row and a Going count at once (R-04 item 3).
 * Null = the read failed or the database predates 0080 — a failed read says
 * nothing rather than reporting zero replies.
 */
export async function fetchAnonGuests(
  supabase: SupabaseClient,
  nightOutId: string,
): Promise<AnonGuest[] | null> {
  try {
    const { data, error } = await supabase.rpc('get_night_out_anon_guests', {
      p_night_out: nightOutId,
    });
    if (error || !Array.isArray(data)) return null;
    return (data as Array<{ guest_name?: unknown; response?: unknown }>)
      .filter((row) => typeof row.response === 'string' && ANON_RESPONSES.has(row.response))
      .map((row) => ({
        guestName: typeof row.guest_name === 'string' && row.guest_name !== '' ? row.guest_name : null,
        response: row.response as AnonGuest['response'],
      }));
  } catch {
    return null;
  }
}
