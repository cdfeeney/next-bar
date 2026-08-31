'use client';

/**
 * The 21+ device acknowledgement — one key, one reader, one writer.
 *
 * WHY IT LIVES UNDER THE ROUTE AND NOT IN `src/lib`. The value is the SAME
 * localStorage key `src/components/AgeGate.tsx` already owns, and the obvious
 * home for it is a shared `src/lib/ageAck.ts` both files import. This lane's
 * write scope is the onboarding/settings/states surface, and `src/lib` and
 * `src/components/AgeGate.tsx` belong to another lane that is running at the
 * same time — so the constant is repeated here deliberately rather than
 * silently edited into a file this lane does not own. `KEY` and `AgeGate`'s
 * `KEY` must stay identical; the confirmed-view test below is what fails if
 * they ever drift.
 *
 * The ack is a DEVICE-level statement, deliberately NOT registered in
 * accountCache ALL_KEYS: it is not account data, and a sign-out must not
 * un-acknowledge the age gate — the person at the keyboard did not change.
 */

/** Must equal `KEY` in src/components/AgeGate.tsx. */
export const AGE_ACK_KEY = 'next-bar:age-ack:v1';

/**
 * Has this device already confirmed 21+?
 *
 * Storage being unavailable (private mode) reads as NOT acknowledged: fail
 * toward asking, never toward skipping the question.
 */
export function readAgeAck(): boolean {
  try {
    return window.localStorage.getItem(AGE_ACK_KEY) === '1';
  } catch {
    return false;
  }
}

/** Record the confirmation. A storage failure is non-fatal — the sequence
 *  continues and the question returns on the next visit. */
export function writeAgeAck(): void {
  try {
    window.localStorage.setItem(AGE_ACK_KEY, '1');
  } catch {
    // Non-fatal: nothing here is account data.
  }
}
