'use client';

/**
 * Ask `/api/account/delete` to destroy the caller's account, and report what
 * we actually KNOW about the outcome.
 *
 * WHY THIS IS NOT A BOOLEAN. `src/lib/accountDeletion.ts` collapses every
 * non-success onto `false`, and the danger zone then printed "nothing was
 * removed". For a refusal that is true. For a LOST RESPONSE it is a false
 * assurance about data that is in fact gone: the route deletes the auth user
 * and only then writes its reply, so a connection dropped in between leaves a
 * destroyed account and a browser telling its owner the account survived.
 * Being told your account still exists when it does not is worse than being
 * told nothing — you stop looking.
 *
 * WHY IT LIVES HERE and not beside the existing helper: `src/lib` is outside
 * this lane's write scope. This is the route's only caller, so the classifier
 * sits next to the screen that has to speak the outcome.
 *
 * THE CLASSIFICATION IS THE ROUTE'S OWN CONTRACT, not a guess about status
 * codes. `src/app/api/account/delete/route.ts` — this lane's file — answers
 * with a distinct `error` string per branch, and only three of them are
 * emitted BEFORE any delete is attempted. Those three are certain. Everything
 * else, `server_error` included, is not: that code covers both a refused
 * `deleteUser` (nothing removed) and a transport throw around it (unknown), so
 * it is reported as unknown rather than guessed.
 */

export type DeletionOutcome =
  /** The server confirmed the account is gone. */
  | 'deleted'
  /** The server answered before deleting anything. Nothing was removed. */
  | 'refused'
  /** No usable answer. The account may or may not have been deleted. */
  | 'unknown';

/** Route errors emitted on a path that returns BEFORE `deleteUser` runs. */
const REFUSED_BEFORE_DELETING = new Set([
  'unauthorized',
  'rate_limited',
  'unavailable',
]);

/**
 * `unauthorized` is certain only on a FIRST attempt.
 *
 * The route rejects with it when `getUser(token)` fails — which is exactly
 * what a token belonging to an ALREADY-DELETED user does. So after an attempt
 * that ended `unknown`, a retry's `unauthorized` has two readings: the request
 * was refused before deleting anything, or the earlier attempt already
 * succeeded and this token now names nobody. The screen prints "nothing was
 * removed" for `refused`, and on the second reading that sentence is false
 * about an account that is gone — the same false assurance the unknown state
 * exists to prevent, reached one tap later.
 *
 * `rate_limited` and `unavailable` carry no such ambiguity: neither is
 * something a deleted account causes, so both stay certain refusals.
 */
const AMBIGUOUS_AFTER_UNKNOWN = 'unauthorized';

export async function requestAccountDeletionOutcome(
  accessToken: string,
  /** Whether an earlier attempt in this session ended `unknown`, so the
   *  account may already be gone. */
  afterUnknown = false,
): Promise<DeletionOutcome> {
  let res: Response;
  try {
    res = await fetch('/api/account/delete', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch {
    // The request may have reached the server and committed. Say so.
    return 'unknown';
  }

  let body: { ok?: unknown; error?: unknown };
  try {
    body = (await res.json()) as { ok?: unknown; error?: unknown };
  } catch {
    // A reply that arrived but could not be read proves nothing either way.
    return 'unknown';
  }

  if (res.ok && body.ok === true) return 'deleted';
  if (typeof body.error === 'string' && REFUSED_BEFORE_DELETING.has(body.error)) {
    if (afterUnknown && body.error === AMBIGUOUS_AFTER_UNKNOWN) return 'unknown';
    return 'refused';
  }
  return 'unknown';
}
