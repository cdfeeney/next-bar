'use client';

/**
 * G-01 split: the module-level RSVP in-flight registry, lifted out of
 * InvitePreview so the component file stays under the 800-line cap. Pure move —
 * the comments below travelled with their code, and the store is still module
 * scoped, which is the whole point of it (a hold must outlive any one instance).
 */
import type { RsvpChoice } from '../bearer';

/**
 * Invite tokens with an RSVP write outstanding, MODULE-scoped on purpose.
 *
 * A component ref dies with the instance, and leaving the night-out route
 * unmounts this one — so a returning recipient got an empty lock and could
 * start a second write for an invite whose first was still in the air
 * (round-10 round 7, Claude). The span that must be covered is the JS context.
 *
 * Not persisted: a reload genuinely ends the JS context, and a request that
 * cannot outlive the page cannot race the next one either.
 */
export const rsvpWritesInFlight = new Set<string>();

/**
 * The answer this JS context has SEEN LAND, per invite.
 *
 * Round-10 round 9, Claude gate — and this is the half of round 8's fix that
 * was missing rather than a new defect. `epoch` is a per-instance ref and an
 * UNMOUNT never moves it, so a write settling after the recipient left and came
 * back compares equal and takes the LIVE branch, where every `setState` belongs
 * to the dead instance and does nothing. Round 8 taught the STALE branch to
 * paint the answer and mark it answered; a remount never reaches that branch.
 * The listener set restored `rsvpBusy` and nothing else, so the recipient got
 * their controls back with every choice unpressed while the server held
 * `going` — and the remounted instance's own mount read, carrying a pre-commit
 * snapshot, then confirmed the lie.
 *
 * A settled answer belongs to the invite, not to whichever instance happened to
 * ask for it, so it lives beside the lock at the same scope. Every live
 * instance adopts it through the same notification the lock uses; there is one
 * mechanism, not two that must agree.
 *
 * Bounded by the invites visited in one page life, exactly like the lock above,
 * and cleared for the same reason by `resetRsvpWritesInFlight`.
 */
export const rsvpSettled = new Map<string, RsvpChoice>();

/**
 * Live instances have to be TOLD when a hold is taken or released.
 *
 * Round-10 round 8, BOTH lanes. Moving the lock to module scope fixed the
 * writes racing, but it moved the lock's span past the span of the thing that
 * paints from it. Tap Going, leave the route (this instance UNMOUNTS), come
 * back: the fresh instance derives `rsvpBusy` from the set at mount and is
 * never told anything again, because the write settles inside the DEAD
 * instance's closure — its epoch never moved, so it takes the non-stale path,
 * deletes the hold, and calls `setRsvpBusy(false)` on a component that no
 * longer exists. The live instance's token-change effect cannot help: the token
 * did not change. Three disabled buttons and no message, until a reload.
 *
 * `StartNightOutButton` hit the identical shape one cycle earlier and its
 * `creatingListeners` is the answer that was already written down: a
 * module-level version read through `useSyncExternalStore`, which is React 18's
 * own contract for state that lives outside the tree. Same problem, same
 * mechanism — inventing a third one here would just be a second thing to keep
 * in step.
 *
 * Every mutation of the set goes through `holdRsvpWrite` / `releaseRsvpWrite`
 * so there is no path that changes it without saying so.
 */
let rsvpFlightVersion = 0;
const rsvpFlightListeners = new Set<() => void>();

export function subscribeRsvpFlight(listener: () => void): () => void {
  rsvpFlightListeners.add(listener);
  return () => {
    rsvpFlightListeners.delete(listener);
  };
}

export function getRsvpFlightVersion(): number {
  return rsvpFlightVersion;
}

export function markRsvpFlightChanged(): void {
  rsvpFlightVersion += 1;
  for (const listener of rsvpFlightListeners) listener();
}

export function holdRsvpWrite(inviteToken: string): void {
  rsvpWritesInFlight.add(inviteToken);
  markRsvpFlightChanged();
}

export function releaseRsvpWrite(inviteToken: string): void {
  if (rsvpWritesInFlight.delete(inviteToken)) markRsvpFlightChanged();
}

/**
 * Record what actually landed, and wake whoever is on screen to adopt it.
 * Called from every branch that learns a write was accepted — live or stale,
 * tap or automatic delivery — because which branch runs depends only on where
 * the recipient happens to be standing, and the answer does not.
 */
export function noteRsvpLanded(inviteToken: string, choice: RsvpChoice): void {
  rsvpSettled.set(inviteToken, choice);
  markRsvpFlightChanged();
}

/**
 * Empty the lock. For TESTS, and the reason it has to exist is the same reason
 * the lock is module-scoped: a hold is released when its write settles, and a
 * suite that deliberately leaves a write hanging — which is most of the ones
 * that matter here — leaves the hold behind for every case after it. Instance
 * state got cleared by unmount for free; module state does not, and pretending
 * otherwise made eight tests fail the moment the scope changed.
 */
export function resetRsvpWritesInFlight(): void {
  rsvpWritesInFlight.clear();
  rsvpSettled.clear();
  markRsvpFlightChanged();
}
