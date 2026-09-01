'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { AGE_STEP_PATH, readAgeAck, writeAgeAck } from '@/app/onboarding/_ageAck';

/**
 * 21+ age gate (H1 App-Store pack). Full-screen overlay on first visit;
 * a tap on "I'm 21 or older" acknowledges and never shows again on this
 * device.
 *
 * The ack is a DEVICE-level statement, deliberately NOT registered in
 * accountCache ALL_KEYS (nightlog N2 spec): it is not account data, and a
 * sign-out must not un-acknowledge the age gate — the person at the
 * keyboard did not change.
 *
 * Render contract: nothing until the localStorage read resolves (no flash
 * of the overlay for acked users, no flash of content for new ones — the
 * page underneath renders regardless, but the overlay mounts within the
 * first client frame).
 *
 * THE OVERLAY ASKED A QUESTION IT WOULD NOT ACCEPT "NO" TO. Until this
 * change it offered exactly one button — "I'm 21 or older" — so an under-21
 * visitor could only affirm falsely or sit on a screen with no way forward.
 * That was not merely an omission: `/onboarding/age` implements the full
 * under-21 exit required by V8-R-ONB-003, and this overlay renders from the
 * root layout on TOP of it, so the one screen that owns the exit was
 * covered by a dialog that had none. Two halves, both here:
 *
 *   - "I'm under 21" hands the answer to the screen that owns it, via the
 *     `?under21=1` flag that screen already honours. No second copy of the
 *     exit, its sign-out, or its ack withdrawal lives here.
 *   - The overlay STANDS DOWN on the age step itself. That step asks the
 *     same question with the same two answers, so covering it was asking
 *     twice and hiding the answer; and after the hand-off the exit screen
 *     has to be visible to be read. Stateless, so a visitor who navigates
 *     back off the step meets the gate again — the ack is the only thing
 *     that puts it down, and the under-21 exit withdraws it.
 */

type AckState = 'unknown' | 'acked' | 'unacked';

export default function AgeGate(): JSX.Element | null {
  const router = useRouter();
  const pathname = usePathname();
  const [state, setState] = useState<AckState>('unknown');

  useEffect(() => {
    // Fail toward asking: an unreadable store (private mode) reads as
    // unacknowledged, which `readAgeAck` already guarantees.
    setState(readAgeAck() ? 'acked' : 'unacked');
  }, []);

  if (state !== 'unacked') return null;
  // The age step owns this question AND its "no" branch. Never cover it.
  if (pathname === AGE_STEP_PATH) return null;

  const acknowledge = (): void => {
    writeAgeAck();
    setState('acked');
  };

  // Deliberately does NOT write, clear, or infer anything about the ack: the
  // step it hands to withdraws the ack itself, and duplicating that here is
  // how the two copies drift apart.
  const decline = (): void => {
    router.push(`${AGE_STEP_PATH}?under21=1`);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="age-gate-title"
      // z-[2000]: above BottomNav's z-[1000] — the gate must cover the nav
      // too, or an unacked user can browse right under it (caught by the
      // app-store-pack e2e blocking test).
      className="fixed inset-0 z-[2000] bg-bg/95 backdrop-blur-sm flex items-center justify-center px-6"
    >
      <div className="max-w-sm w-full bg-surface border border-border rounded-3xl p-8 text-center">
        <p className="text-accent uppercase tracking-[0.25em] text-xs mb-3">
          Before you head in
        </p>
        <h2 id="age-gate-title" className="font-display text-2xl mb-3">
          Are you 21 or older?
        </h2>
        <p className="text-muted text-sm leading-relaxed mb-6">
          Next Bar is a guide to NYC bars and nightlife. You need to be of
          legal drinking age in the US to use it.
        </p>
        <button
          type="button"
          onClick={acknowledge}
          className="w-full bg-accent hover:bg-accentDim transition-colors text-bg font-display text-lg py-3 rounded-xl min-h-[44px] touch-manipulation"
        >
          I&apos;m 21 or older
        </button>
        <button
          type="button"
          onClick={decline}
          className="block mx-auto mt-4 text-muted text-sm underline-offset-4 hover:underline min-h-[44px] touch-manipulation"
        >
          I&apos;m under 21
        </button>
        <p className="text-muted text-xs leading-relaxed mt-4">
          Please drink responsibly.
        </p>
      </div>
    </div>
  );
}
