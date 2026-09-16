import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * The BEARER half of a Night Out invitation (V8-R-INV-001 … V8-R-INV-004,
 * D-C-23) — everything a recipient may do while holding only the link.
 *
 * These wrap the anon-executable RPCs migration 0068 section 8 adds. They live
 * here rather than in `src/lib/nightOuts.server.ts` because that module is the
 * MEMBER surface: every function in it assumes an authenticated caller, and the
 * one rule this file must not blur is which calls need an account and which do
 * not.
 *
 * House pattern, unchanged: pure async functions, null/false on refusal or
 * transport error, never throw. A Supabase call can reject as well as return an
 * `error`, so every call is wrapped — an escaping rejection leaves the surface
 * stuck on its loading state, which is the one state that never resolves into an
 * honest message.
 *
 * WHAT IS STILL BEHIND THE AUTH WALL, and is not here: voting, suggesting, and
 * every private read. V8-R-INV-001's exclusions are "no voting, no suggesting,
 * no browsing private application data", and nothing in this file grants any of
 * them.
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The three choices, exactly as V8-R-INV-003 (D-C-22) names them. */
export type RsvpChoice = 'going' | 'maybe' | 'declined';

/**
 * The labels, in the contract's order. "Not tonight" is deliberately absent:
 * V8-R-INV-003 excludes the phrase by name — it belongs to neither RSVP nor
 * presence (D-C-21, D-C-22).
 */
export const RSVP_LABELS: Readonly<Record<RsvpChoice, string>> = {
  going: 'Going',
  maybe: 'Maybe',
  declined: "Can't make it",
};

export const RSVP_ORDER: readonly RsvpChoice[] = ['going', 'maybe', 'declined'];

function isRsvpChoice(value: unknown): value is RsvpChoice {
  return value === 'going' || value === 'maybe' || value === 'declined';
}

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

/* -------------------------------------------------------------------------- */
/* The recipient's own key                                                    */
/* -------------------------------------------------------------------------- */

const RSVP_KEY_STORAGE_PREFIX = 'next-bar:night-out-rsvp:';

/**
 * The capability that identifies ONE recipient's RSVP without an account.
 *
 * `night_out_members` keys on a profile id and a token-scoped recipient has
 * none, so their answer is keyed on a uuid their own device mints and keeps.
 * Holding the share token lets you RSVP; only this key lets you read back or
 * change the answer already stored under it. It is per plan, so forwarding a
 * link never hands anyone else your answer.
 *
 * localStorage, not a cookie: it never needs to reach the server on its own, and
 * a cookie would ride every request to every route. A private window or cleared
 * storage simply means the next RSVP is a new one — the recipient is not locked
 * out, and the server's per-plan cap is what bounds that.
 *
 * Returns null when storage is unavailable (Safari private mode throws on
 * write, and SSR has no window at all). Callers treat that as "we cannot
 * remember this", not as an error worth showing.
 */
export function readRsvpKey(token: string): string | null {
  try {
    const stored = window.localStorage.getItem(RSVP_KEY_STORAGE_PREFIX + token);
    return stored !== null && UUID_RE.test(stored) ? stored : null;
  } catch {
    return null;
  }
}

/**
 * The key for this plan, minting and storing one if there is none.
 *
 * Null when we can neither read nor persist a key: RSVPing under a key that
 * cannot be saved would produce an answer the recipient could never see or
 * change again, and silently rewriting a stranger's row on the next visit is
 * worse than saying we could not do it.
 */
export function ensureRsvpKey(token: string): string | null {
  const existing = readRsvpKey(token);
  if (existing !== null) return existing;
  try {
    const minted = crypto.randomUUID();
    window.localStorage.setItem(RSVP_KEY_STORAGE_PREFIX + token, minted);
    // Read it back: a quota-exceeded write can fail without throwing in some
    // browsers, and a key we did not actually persist is the case above.
    return readRsvpKey(token);
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* The bearer reads (V8-R-INV-002)                                            */
/* -------------------------------------------------------------------------- */

/** The plan's when and where, as a bearer is allowed to see them. */
export type BearerDetail = {
  /** ISO instant. The SERVER's scheduled start — never computed here. */
  startsAt: string;
  /**
   * V8-R-NO-003's optional Area. Round 4 answered V8-R-INV-002's "area" with
   * the DECIDED BAR, which is a different and later decision — null for
   * exactly as long as the plan is still choosing, which is when a recipient
   * most needs to know roughly where.
   */
  area: string | null;
  decidedBarId: string | null;
  /** V8-R-NO-005. ISO instant, or null for "No deadline". */
  votingClosesAt: string | null;
};

export async function fetchBearerDetail(
  supabase: SupabaseClient,
  token: string,
): Promise<BearerDetail | null> {
  if (!UUID_RE.test(token)) return null;
  const { data, error } = await callRpc(supabase, 'preview_night_out_detail', {
    p_token: token,
  });
  if (error) return null;
  const row = (Array.isArray(data) ? data[0] : data) as
    | {
        starts_at?: unknown;
        area?: unknown;
        decided_bar_id?: unknown;
        voting_closes_at?: unknown;
      }
    | null
    | undefined;
  if (!row || typeof row.starts_at !== 'string' || row.starts_at.length === 0) {
    return null;
  }
  return {
    startsAt: row.starts_at,
    area: nonEmpty(row.area),
    decidedBarId: nonEmpty(row.decided_bar_id),
    votingClosesAt: nonEmpty(row.voting_closes_at),
  };
}

function nonEmpty(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** One accepted member, as a bearer is allowed to see them: display only. */
export type BearerAttendee = {
  displayName: string | null;
  handle: string | null;
};

/** G-01: the name a share-link guest typed, stored on their own RSVP row. */
export const GUEST_NAME_MAX = 40;

/** G-01: Going and Maybe carry a name; "Can't make it" may be anonymous. */
export function rsvpNeedsName(choice: RsvpChoice): boolean {
  return choice === 'going' || choice === 'maybe';
}

/**
 * Who is going. NULL means the read failed and [] means nobody has accepted —
 * the same distinction the rest of this codebase keeps, because "nobody is
 * coming" is a claim about the plan and a failed read is not.
 */
export async function fetchBearerAttendees(
  supabase: SupabaseClient,
  token: string,
): Promise<BearerAttendee[] | null> {
  if (!UUID_RE.test(token)) return null;
  const { data, error } = await callRpc(
    supabase,
    'preview_night_out_attendees',
    { p_token: token },
  );
  if (error || !Array.isArray(data)) return null;
  return (data as Array<{ display_name?: unknown; handle?: unknown }>).map(
    (row) => ({
      displayName:
        typeof row?.display_name === 'string' && row.display_name.length > 0
          ? row.display_name
          : null,
      handle:
        typeof row?.handle === 'string' && row.handle.length > 0
          ? row.handle
          : null,
    }),
  );
}

/** One shortlist row, as a bearer sees it: the bar and how many want it. */
export type BearerShortlistEntry = { barId: string; votes: number };

export async function fetchBearerShortlist(
  supabase: SupabaseClient,
  token: string,
): Promise<BearerShortlistEntry[] | null> {
  if (!UUID_RE.test(token)) return null;
  const { data, error } = await callRpc(
    supabase,
    'preview_night_out_shortlist',
    { p_token: token },
  );
  if (error || !Array.isArray(data)) return null;
  return (data as Array<{ bar_id?: unknown; votes?: unknown }>).flatMap(
    (row) => {
      if (typeof row?.bar_id !== 'string' || row.bar_id.length === 0) return [];
      const votes = Number(row?.votes);
      return [
        {
          barId: row.bar_id,
          votes: Number.isFinite(votes) && votes >= 0 ? Math.trunc(votes) : 0,
        },
      ];
    },
  );
}

/* -------------------------------------------------------------------------- */
/* The bearer write (V8-R-INV-001, V8-R-INV-003)                              */
/* -------------------------------------------------------------------------- */

/**
 * The answer already stored under this recipient's key, if any.
 *
 * Three outcomes on purpose: 'ok' with the choice, 'none' when this key has not
 * answered, and 'failed' when we could not ask. Rendering the un-answered state
 * for a failed read would ask a recipient to RSVP again to a plan they already
 * replied to.
 */
export type RsvpRead =
  | { kind: 'ok'; choice: RsvpChoice }
  | { kind: 'none' }
  | { kind: 'failed' };

export async function fetchAnonRsvp(
  supabase: SupabaseClient,
  token: string,
  key: string,
): Promise<RsvpRead> {
  if (!UUID_RE.test(token) || !UUID_RE.test(key)) return { kind: 'none' };
  const { data, error } = await callRpc(supabase, 'get_anon_rsvp_by_token', {
    p_token: token,
    p_key: key,
  });
  if (error) return { kind: 'failed' };
  // A scalar-returning RPC answers with the value, or with null for zero rows.
  const value = Array.isArray(data) ? (data[0] ?? null) : data;
  if (value === null || value === undefined) return { kind: 'none' };
  return isRsvpChoice(value) ? { kind: 'ok', choice: value } : { kind: 'failed' };
}

/**
 * What happened to an RSVP, in the three outcomes the contract distinguishes.
 *
 * Round 3 (Codex gate): this used to be a boolean, and V8-R-INV-003's failure
 * clause needs the difference. "An offline response is QUEUED and explicitly
 * labelled as not yet sent" applies to a response that never reached the server;
 * a response the server REFUSED — a cancelled plan, a dead token — must not be
 * queued, because retrying it forever cannot make it land.
 */
export type RsvpSubmitResult =
  /** The server took it. */
  | 'sent'
  /** The server answered, and said no. Retrying changes nothing. */
  | 'refused'
  /** We never reached the server. This is the one that gets queued. */
  | 'unreachable';

/**
 * Submit or change this recipient's RSVP without signing up (D-C-23).
 *
 * HOW "UNREACHABLE" IS ACTUALLY DETECTED (round-4 panel, Claude gate, HIGH).
 * Round 4 detected it by catching a throw, and supabase-js does not throw:
 * unless `.throwOnError()` was called — nothing in this repo calls it —
 * postgrest-js catches its own fetch rejection and RESOLVES with an error
 * object (dist/index.mjs:291-331). So the offline branch, the queue behind it,
 * and the whole V8-R-INV-003 failure-recovery feature were dead code under
 * their own triggering condition: an offline recipient got "that hasn't been
 * sent" and nothing was held.
 *
 * The discriminator is `status`, which that same catch sets to 0 because no
 * response ever arrived. Every PostgREST refusal — a raise, an RLS denial, a
 * bad argument — comes back with a real HTTP status and a `code`. Matching on
 * the status is exact and does not depend on the wording of a message.
 *
 * The thrown branch is kept as well: a client object that is not a client at
 * all still rejects, and that is also "we never reached the server".
 */
export async function submitAnonRsvp(
  supabase: SupabaseClient,
  token: string,
  key: string,
  choice: RsvpChoice,
  /**
   * G-01: what the guest typed. The server requires one for Going and Maybe —
   * either sent now or already on their row — and accepts a nameless
   * "Can't make it". Trimmed here as well as there so an all-spaces name is
   * refused in the field rather than by the RPC.
   */
  guestName?: string | null,
): Promise<RsvpSubmitResult> {
  if (!UUID_RE.test(token) || !UUID_RE.test(key)) return 'refused';
  const name = typeof guestName === 'string' ? guestName.trim() : '';
  try {
    const result = await supabase.rpc('rsvp_night_out_by_token', {
      p_token: token,
      p_key: key,
      p_response: choice,
      p_guest_name: name === '' ? null : name,
    });
    if (isUnreachable(result)) return 'unreachable';
    return !result.error && result.data === true ? 'sent' : 'refused';
  } catch {
    return 'unreachable';
  }
}

/**
 * Did this call reach the server at all?
 *
 * `status: 0` is postgrest-js's own marker for a fetch that never produced a
 * response. A missing `status` is treated the same way only when there is an
 * error to explain: a successful call always carries 200.
 */
function isUnreachable(result: {
  error?: unknown;
  status?: unknown;
}): boolean {
  if (!result.error) return false;
  return result.status === 0 || result.status === undefined;
}

/* -------------------------------------------------------------------------- */
/* The offline queue (V8-R-INV-003 failure recovery)                          */
/* -------------------------------------------------------------------------- */

const QUEUED_RSVP_STORAGE_PREFIX = 'next-bar:night-out-rsvp-queued:';
/**
 * G-01: the NAME that belongs to a queued answer. Kept beside the choice
 * rather than inside it so the existing queued value stays a bare choice and
 * an older queue still replays; without it a Going queued offline would be
 * resent nameless and the server would refuse it.
 */
const QUEUED_RSVP_NAME_STORAGE_PREFIX = 'next-bar:night-out-rsvp-queued-name:';

/**
 * "An offline response is queued and explicitly labelled as not yet sent."
 *
 * ONE choice per plan, overwritten rather than appended: an RSVP is a current
 * answer, not a log, so a recipient who taps Maybe and then Going while offline
 * should send Going once — not both, in whatever order a queue drains.
 *
 * The same localStorage caveats as the key above: a browser that refuses to
 * store simply has no queue, and the surface says the answer was not sent
 * rather than pretending it was held.
 */
export function queueRsvp(
  token: string,
  choice: RsvpChoice,
  /** G-01: sent with the answer when it replays. */
  guestName?: string | null,
): boolean {
  try {
    window.localStorage.setItem(QUEUED_RSVP_STORAGE_PREFIX + token, choice);
    const name = typeof guestName === 'string' ? guestName.trim() : '';
    if (name === '') window.localStorage.removeItem(QUEUED_RSVP_NAME_STORAGE_PREFIX + token);
    else window.localStorage.setItem(QUEUED_RSVP_NAME_STORAGE_PREFIX + token, name);
    return readQueuedRsvp(token) === choice;
  } catch {
    return false;
  }
}

/** G-01: the name stored with a queued answer, or null. */
export function readQueuedRsvpName(token: string): string | null {
  try {
    const stored = window.localStorage.getItem(QUEUED_RSVP_NAME_STORAGE_PREFIX + token);
    const name = typeof stored === 'string' ? stored.trim() : '';
    return name === '' ? null : name;
  } catch {
    return null;
  }
}

export function readQueuedRsvp(token: string): RsvpChoice | null {
  try {
    const stored = window.localStorage.getItem(
      QUEUED_RSVP_STORAGE_PREFIX + token,
    );
    return isRsvpChoice(stored) ? stored : null;
  } catch {
    return null;
  }
}

export function clearQueuedRsvp(token: string): void {
  try {
    window.localStorage.removeItem(QUEUED_RSVP_STORAGE_PREFIX + token);
    window.localStorage.removeItem(QUEUED_RSVP_NAME_STORAGE_PREFIX + token);
  } catch {
    // A queue we cannot clear is a queue that will be retried, which is the
    // safe direction: the RPC is idempotent under the recipient's own key.
  }
}
