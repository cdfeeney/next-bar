/**
 * Presence — the V8 model of "who is out tonight" (V8-R-PRE-001..005,
 * V8-R-SOC-001).
 *
 * Four rules the contract states and this module encodes, so that no surface
 * has to re-derive them:
 *
 *  1. MANUAL. A status is something a person set. There is no device-derived
 *     presence and no GPS anywhere in this feature — `night_presence` has no
 *     location column at all, so it is a schema property rather than a
 *     convention (V8-R-PRE-001).
 *  2. ATTRIBUTED TO A PERSON. Every row names who set it. Nobody is described
 *     by an invented venue: when there is no pinned bar the surface says so
 *     rather than guessing one (V8-R-SOC-001).
 *  3. A PIN SETS GOING OUT. Pinning a bar is not a fourth state; it is Going
 *     out plus a place (V8-R-PRE-004). Both the SQL check constraint and
 *     `describePresence` below refuse the "at a bar, not going out" pair.
 *  4. IT ENDS AT 4:00 AM AMERICA/NEW_YORK. The pin is scoped to one night and
 *     the night is `nycNightKey()` — the single DST-aware definition in
 *     src/lib/nightKey.ts, mirrored by `public.nyc_night_key()` in migration
 *     0068 (V8-R-PRE-005 / D-C-39). Expiry is structural: reads filter on the
 *     current night key, so last night's rows stop matching on their own. No
 *     sweeper exists to fall behind.
 *
 * Pure module — no React, no Supabase. The RPC wrappers live in ./server.
 */

/** The three manual states. There is no fourth, and no "here" (V8-R-PRE-004). */
export type PresenceStatus = 'going' | 'maybe' | 'not-going';

/**
 * Who sees the pin (V8-R-PRE-002 / D-C-37).
 *   'friends' — everyone who follows you.
 *   'close'   — only a mutual follow.
 * Enforced server-side in `get_circle_presence`; this type is the vocabulary,
 * not the gate.
 */
export type PresenceAudience = 'friends' | 'close';

/** One person's presence tonight, as the viewer is allowed to see it. */
export type CirclePresence = {
  /** The pinner's profile id. The Stories rail keys its cells on this. */
  userId: string;
  handle: string;
  displayName: string | null;
  status: PresenceStatus;
  /** The bar they pinned, or null when they set a status without a place. */
  barId: string | null;
  /** When they last set or changed it. ISO instant. */
  updatedAt: string;
};

/** The viewer's own presence tonight, or null when they have set none. */
export type MyPresence = {
  status: PresenceStatus;
  barId: string | null;
  audience: PresenceAudience;
  updatedAt: string;
};

const STATUSES: ReadonlySet<string> = new Set<PresenceStatus>([
  'going',
  'maybe',
  'not-going',
]);

const AUDIENCES: ReadonlySet<string> = new Set<PresenceAudience>([
  'friends',
  'close',
]);

/** Same shape the migration's check constraint enforces. */
const BAR_ID_RE = /^[a-z0-9-]{1,60}$/;

export function isPresenceStatus(value: unknown): value is PresenceStatus {
  return typeof value === 'string' && STATUSES.has(value);
}

export function isPresenceAudience(value: unknown): value is PresenceAudience {
  return typeof value === 'string' && AUDIENCES.has(value);
}

export function isBarId(value: unknown): value is string {
  return typeof value === 'string' && BAR_ID_RE.test(value);
}

/**
 * Rule 3, as a predicate: a pinned bar is only valid alongside Going out.
 *
 * Checked on the way OUT (before the RPC, so a bad pair never travels) and on
 * the way IN (in ./server, so a row that somehow holds the invalid pair is
 * dropped rather than rendered). The database refuses it too — three layers
 * because this is the pair that would put someone at a bar they said they were
 * not going to.
 */
export function isValidPin(
  status: PresenceStatus,
  barId: string | null,
): boolean {
  if (barId === null) return true;
  return status === 'going' && isBarId(barId);
}

/** The user-facing label for each state (V8-R-PRE-004's exact wording). */
export const PRESENCE_LABELS: Readonly<Record<PresenceStatus, string>> = {
  going: 'Going out',
  maybe: 'Maybe later',
  'not-going': 'Not going out',
};

export type PresenceDescription = {
  /** The bar id to lead with, or null when there is no place to name. */
  barId: string | null;
  /**
   * The words beneath: 'Pinned' when they named a bar, otherwise the plain
   * status. V8-R-SOC-001 requires the state to be carried IN WORDS alongside
   * the timestamp, never by colour alone.
   */
  note: string;
};

/**
 * How one person's presence should read.
 *
 * The single place that decides "lead with the bar, carry the state in words
 * underneath". Returning data rather than JSX keeps the rule testable and
 * keeps two surfaces (Tonight, and anything later) from drifting apart.
 *
 * An invalid pin — a bar attached to anything but Going out — is treated as
 * having NO bar. That is the honest reading: the person said Maybe, and the
 * one thing this feature must never do is describe somebody by a venue they
 * did not claim.
 */
export function describePresence(presence: {
  status: PresenceStatus;
  barId: string | null;
}): PresenceDescription {
  const pinned = isValidPin(presence.status, presence.barId)
    ? presence.barId
    : null;
  return {
    barId: pinned,
    note: pinned === null ? PRESENCE_LABELS[presence.status] : 'Pinned',
  };
}
