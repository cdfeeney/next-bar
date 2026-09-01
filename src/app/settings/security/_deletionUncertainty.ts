'use client';

import { DELETION_UNCERTAIN_KEY } from '@/lib/accountCache';

/**
 * "An earlier deletion attempt for THIS account ended `unknown`" — stored, so
 * it survives the screen that learned it.
 *
 * WHY IT IS NOT COMPONENT STATE. The route deletes the auth user and only then
 * writes its reply, so a lost response is exactly the case where the account is
 * most likely already gone. From that moment the danger zone may never again
 * print "nothing was removed" about this account: a later `unauthorized` is
 * what a DELETED user's token produces, so reading it as a certain refusal
 * reprints the false assurance over destroyed data.
 *
 * Three earlier homes were all too short-lived, each caught by a separate
 * review round: no flag at all; a flag derived from view state that Cancel
 * resets; a latching `useState` that a remount — or the reload the unknown
 * message itself recommends — discards. The fact is about the account, not
 * about the mount, so it is written to storage.
 *
 * KEYED TO THE USER ID, and the id is the VALUE rather than part of the key
 * name: one account can be uncertain at a time (the flow ends by leaving), and
 * a single key is one registry entry rather than an unbounded family of them.
 * A latch left behind by a previous owner therefore reads as absent for the
 * next one instead of making their screen mysteriously cautious.
 *
 * The key is registered in `accountCache`'s `ALL_KEYS` (the confirmed-deletion
 * and foreign-sign-in wipes) AND removed explicitly by
 * `clearResidualAccountCache` (registration alone would miss it — that
 * function clears by explicit list). It is dropped only where the session is
 * demonstrably GONE: `useAuth` calls that function directly when
 * `getSession()` comes back empty or a `SIGNED_OUT` event arrives. The
 * sign-out SEAL keeps it, because a failed sign-out resolves with `{ error }`
 * and keeps the session, so sealing is not evidence that anything ended.
 *
 * Storage failing (private mode, quota) is NON-FATAL and deliberately fails
 * toward the in-memory latch the caller also keeps: within one mount the
 * screen still behaves correctly, and the honest outcome of an unreadable
 * store is that a NEW mount asks the server again rather than inventing
 * certainty it does not have.
 *
 * `sawDeletionUnknown` is called AT THE MOMENT OF EACH ATTEMPT, never cached
 * into component state on mount. A snapshot taken when the screen was built
 * cannot see an attempt another tab made afterwards, and a second tab on the
 * same account is exactly where the false "nothing was removed" came back.
 */

/** Has an attempt for `userId` already ended `unknown` on this device? */
export function sawDeletionUnknown(userId: string): boolean {
  try {
    return window.localStorage.getItem(DELETION_UNCERTAIN_KEY) === userId;
  } catch {
    return false;
  }
}

/** Record that an attempt for `userId` ended `unknown`. Latches; nothing in
 *  this lane clears it — only an account-cache wipe does. */
export function latchDeletionUnknown(userId: string): void {
  try {
    window.localStorage.setItem(DELETION_UNCERTAIN_KEY, userId);
  } catch {
    // Non-fatal: the caller's in-memory latch still covers this mount.
  }
}
