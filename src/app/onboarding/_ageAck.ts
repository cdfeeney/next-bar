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
 * THE KEY HOLDS AN ANSWER, NOT A BOOLEAN — three states, not two.
 *
 * Operator ruling 2026-09-01, verbatim: "we should just have it be where they
 * can't make an account if they are under 21", with the age check moved AHEAD
 * of account creation. Until this change the under-21 branch only REMOVED the
 * acknowledgement, which left the device in exactly the state a brand-new one
 * is in: unanswered. The overlay then asked again on the very next route, so a
 * "no" bought one screen and blocked nothing — sign-up was one tap away, and
 * the answer that was supposed to stop it had been erased rather than
 * recorded.
 *
 * So a decline is now WRITTEN. `absent` still means never asked; `'1'` is the
 * existing 21+ confirmation, unchanged and still the only value `readAgeAck`
 * accepts, so an already-acknowledged device is untouched by this; `'under21'`
 * is a recorded refusal that the gate honours instead of re-asking.
 *
 * It stays ONE key because it is one question. Two keys would allow the
 * impossible state "confirmed and declined" and leave a reader to decide which
 * wins.
 */
const DECLINED = 'under21';

/** What this device has answered, if anything. */
export type AgeAnswer = 'yes' | 'no' | null;

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

/**
 * The full answer, for the one reader that has to tell "not asked yet" from
 * "asked and said no" — the overlay. Everything else only ever needs
 * `readAgeAck()`, which is deliberately still a boolean about 21+.
 *
 * An unreadable store reads as `null`: fail toward ASKING, never toward
 * letting an unanswered device through and never toward locking one out.
 */
export function readAgeAnswer(): AgeAnswer {
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(AGE_ACK_KEY);
  } catch {
    return null;
  }
  if (raw === '1') return 'yes';
  if (raw === DECLINED) return 'no';
  return null;
}

/**
 * Record "I'm under 21".
 *
 * This REPLACES the ack rather than clearing it, which is the whole point: a
 * cleared key is indistinguishable from never having been asked, so the gate
 * re-offered "I'm 21 or older" on the next route and the refusal blocked
 * nothing. Written by the age step's exit — the one place that owns the "no" —
 * so the overlay that hands the answer over never grows a second copy of it.
 *
 * A storage failure is non-fatal and fails toward asking again, which is the
 * same place the previous behaviour landed: worse than a recorded refusal,
 * never worse than a silent admission.
 */
export function writeAgeDenial(): void {
  try {
    window.localStorage.setItem(AGE_ACK_KEY, DECLINED);
  } catch {
    // Non-fatal: an unwritable store reads back as unanswered, so the gate
    // asks rather than admits.
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
 * Return the device to UNANSWERED.
 *
 * Answering "I'm under 21" no longer lands here — it calls `writeAgeDenial()`,
 * because clearing the key erases the answer instead of recording it and the
 * gate then simply asks again. What remains here is the RETRACTION: the gate's
 * "I answered that by mistake", the one way back from a recorded refusal that
 * does not require clearing site data. It is deliberately not a way to say
 * yes — it only puts the question back.
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
