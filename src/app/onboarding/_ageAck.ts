'use client';

/**
 * The 21+ device acknowledgement — one key, one reader, one writer.
 *
 * WHY IT LIVES UNDER THE ROUTE AND NOT IN `src/lib`. The obvious home is a
 * shared `src/lib/ageAck.ts`, but `src/lib` belongs to another lane; this
 * lane's write scope is the onboarding/settings/states surface plus
 * `src/components/AgeGate.tsx`. So the module sits under the route that owns
 * the age question, and the overlay imports it from here.
 *
 * IT USED TO BE COPIED RATHER THAN IMPORTED. `AgeGate` held its own private
 * `KEY` with a comment requiring the two to stay identical by hand, because
 * that file was outside this lane at the time. It no longer is, so the copy
 * is gone and there is exactly one definition — a constant two files must
 * keep equal by discipline is a drift waiting to happen.
 *
 * The ack is a DEVICE-level statement, deliberately NOT registered in
 * accountCache ALL_KEYS: it is not account data, and a sign-out must not
 * un-acknowledge the age gate — the person at the keyboard did not change.
 */

export const AGE_ACK_KEY = 'next-bar:age-ack:v1';

/**
 * The onboarding step that owns the 21+ question AND its "no" branch.
 *
 * Exported so the global overlay can hand an under-21 answer here (with
 * `?under21=1`) and stand down on this route, rather than growing a second
 * copy of the exit. One route, one exit.
 */
export const AGE_STEP_PATH = '/onboarding/age';

/**
 * Where an under-21 visitor is sent when they close the exit: the marketing
 * landing, not the app.
 *
 * THE OVERLAY HAS TO STAND DOWN HERE TOO, and that is why the constant lives
 * beside `AGE_STEP_PATH` rather than privately in the exit screen. The exit
 * WITHDRAWS the device ack (`clearAgeAck`) and then leaves, so the device
 * arrives at this route unacknowledged — and an overlay that covers every
 * unacknowledged route covered the destination with the same 21+ dialog,
 * whose "I'm under 21" pushed straight back to the exit. The terminal screen
 * was a loop. One under-21 answer, one exit, one place it lands.
 */
export const AGE_EXIT_PATH = '/install';

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

/**
 * Withdraw the confirmation.
 *
 * Called when someone answers "I'm under 21". Leaving the ack in place is what
 * let a device that had confirmed 21+ earlier — through the global AgeGate
 * overlay on `/` — declare itself under 21 here and then walk straight back
 * into the app, because the overlay reads this key and stays down for an
 * acknowledged device. The most recent answer from the person at the keyboard
 * is the one that counts, and it is a NO.
 *
 * A storage failure fails toward asking: `readAgeAck` already treats an
 * unreadable store as unacknowledged.
 */
export function clearAgeAck(): void {
  try {
    window.localStorage.removeItem(AGE_ACK_KEY);
  } catch {
    // Non-fatal: an unreadable store already reads as NOT acknowledged.
  }
}
