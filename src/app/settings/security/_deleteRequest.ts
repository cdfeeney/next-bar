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
 * WHY IT NO LONGER TAKES AN `afterUnknown` FLAG — the cycle-5 redesign, after
 * four rounds of findings against the client-side memory that flag required.
 *
 * The ambiguity was never the client's to resolve. A retry after a lost
 * response used to receive `unauthorized`, which means both "you were never
 * signed in" and "the account you are asking about is gone" — so the screen
 * kept a latch recording its own uncertainty, and that latch had to be correct
 * at every scope in turn: component state, view state that Cancel reset, a
 * mount that a reload discarded, a second tab, a storage that refused the
 * write, and the wipes that then had to reach it. Each fix was right and each
 * one moved the problem.
 *
 * `/api/account/delete` now answers `user_not_found` — a validly signed token
 * whose user no longer exists — with success, because the caller asked for the
 * account to be gone and it is gone. The endpoint is idempotent, the retry is
 * authoritative, and the client needs no memory at all: `unauthorized` means
 * exactly "not a valid token for a live user" again, which is a certain
 * refusal on every attempt, not just the first.
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
  /** The server confirmed the account is gone — deleted now, or already. */
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

export async function requestAccountDeletionOutcome(
  accessToken: string,
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
    return 'refused';
  }
  return 'unknown';
}
