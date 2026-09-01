'use client';

import { isSafeReturnPath } from '@/components/OnboardingGate';

/**
 * The onboarding SEQUENCE — the order of the approved canvas
 * `next-bar-onboarding-v1`, and the one thing that was missing from it.
 *
 * The four screens all existed and none of them was reachable. `/onboarding`
 * (the identity step) went straight to the return destination on submit and on
 * skip, and nothing anywhere linked to `/onboarding/age`, so age (V8-R-ONB-003),
 * location (V8-R-ONB-004) and the optional quiz (V8-R-ONB-005) could only be
 * opened by typing their URLs.
 *
 * THE ORDER, and why the identity step is last rather than first: the quiz step
 * already ends by handing a signed-in account to `/onboarding`, because an
 * account with no handle gets pulled back there by `OnboardingGate` one render
 * after it reaches the home. So the sequence is
 *
 *     /onboarding  →  age  →  location  →  quiz  →  /onboarding  →  destination
 *     (enters)                                      (identity form)
 *
 * and `/onboarding` is visited twice: once as the door in, once as the last
 * step. `SEQUENCE_DONE_PARAM` is what tells those two visits apart. Without it
 * the second visit would walk back into the sequence, which is a loop.
 *
 * WHY A URL MARKER AND NOT THE AGE ACK. Keying entry off `readAgeAck()` was the
 * smaller change and it is wrong: a device that met the app at `/` has already
 * acknowledged 21+ through the global AgeGate overlay, so it would test as
 * "sequence done" and skip location and the quiz entirely — silently dropping
 * two owned requirements for every user who arrived that way. The marker
 * describes the run, not the device.
 *
 * Every route here is under `/onboarding`, which `OnboardingGate` excludes, so
 * the gate cannot interrupt the sequence it started.
 */

export const SEQUENCE_DONE_PARAM = 'seq';
const DONE = 'done';

export const AGE_STEP = '/onboarding/age';
export const LOCATION_STEP = '/onboarding/location';
export const QUIZ_STEP = '/onboarding/quiz';
export const IDENTITY_STEP = '/onboarding';

/** The approved Next Bar? home. There is no second home. */
export const HOME = '/';

/**
 * Where the sequence should end.
 *
 * `?next=` is what `OnboardingGate` records when it interrupts a route — a
 * brand-new account that arrived on an invite link has to land back on THAT
 * plan. It is validated with the gate's own `isSafeReturnPath`, so an
 * attacker-shaped value degrades to the home rather than riding through four
 * screens of redirects.
 */
export function returnDestination(search: string): string {
  const next = new URLSearchParams(search).get('next');
  return isSafeReturnPath(next) ? (next as string) : HOME;
}

/** Has this visit to `/onboarding` already come through the sequence? */
export function hasCompletedSequence(search: string): boolean {
  return new URLSearchParams(search).get(SEQUENCE_DONE_PARAM) === DONE;
}

/** A sequence step, carrying the destination forward. */
export function stepHref(step: string, destination: string): string {
  return `${step}?next=${encodeURIComponent(destination)}`;
}

/** The identity step, marked so it renders the form instead of re-entering. */
export function identityHref(destination: string): string {
  return `${IDENTITY_STEP}?next=${encodeURIComponent(destination)}`
    + `&${SEQUENCE_DONE_PARAM}=${DONE}`;
}
