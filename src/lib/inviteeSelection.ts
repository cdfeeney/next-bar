/**
 * Who gets invited when a Night Out is started.
 *
 * This lives outside the consensus page so it can be tested as the SAME code
 * that ships. The defect it exists to prevent (cold panel, Codex, HIGH) was
 * invisible to the previous tests precisely because they passed a hand-made
 * array of ids straight to the button and never exercised the step that builds
 * it — the step that was wrong.
 *
 * Two rules, both learned from that finding:
 *   - Invitees come from the FULL followed circle, not the rating-qualified
 *     subset used for consensus picks. Being invited out and having ranked bars
 *     are unrelated ("someone might not be into that and just use it as a
 *     social lens" — operator, 2026-08-16).
 *   - Only real account ids are ever returned. The picker mixes profile UUIDs
 *     with demo entries keyed by HANDLE and the literal 'you', and
 *     night_out_members is FK-bound to profiles, so a non-uuid fails at the
 *     database — silently, because the invite RPC returns false rather than
 *     throwing.
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const YOU_ID = 'you';

export function mergeSelection({ direct, groupMembers }: {
  direct: Iterable<string>;
  groupMembers: readonly Iterable<string>[];
}): Set<string> {
  return new Set([...direct, ...groupMembers.flatMap((members) => [...members])]);
}

export function deriveInviteeIds({
  isServer,
  circleIds,
  selected,
}: {
  /** Demo/local mode has no accounts to invite. */
  isServer: boolean;
  /** Every account you follow — NOT filtered by whether they have ratings. */
  circleIds: readonly string[];
  /** Currently selected chips. */
  selected: ReadonlySet<string>;
}): string[] {
  if (!isServer) return [];
  return circleIds.filter(
    (id) => id !== YOU_ID && UUID_RE.test(id) && selected.has(id),
  );
}
