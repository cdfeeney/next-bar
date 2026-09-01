'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import {
  AGE_ACK_KEY,
  AGE_EXIT_PATH,
  AGE_STEP_PATH,
  clearAgeAck,
  readAgeAnswer,
  writeAgeAck,
  type AgeAnswer,
} from '@/app/onboarding/_ageAck';

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
 *     has to be visible to be read.
 *
 * AND THE "NO" IS NOW REMEMBERED, which is what makes this a gate on account
 * creation rather than a speed bump. Operator ruling 2026-09-01: "we should
 * just have it be where they can't make an account if they are under 21", the
 * age check moved AHEAD of account creation so nothing is created that would
 * then have to be deleted. The exit used to WITHDRAW the acknowledgement,
 * leaving the device in the state a brand-new one is in — so this overlay
 * asked again on the very next route and offered "I'm 21 or older" as a
 * one-tap route to `/auth`. The refusal blocked nothing.
 *
 * A recorded refusal renders the closed state instead of the question. The
 * only way back is the explicit "I answered that by mistake", which returns
 * the device to UNANSWERED rather than to 21+ — a mistap has a remedy, and
 * the remedy is to be asked again, not to be admitted.
 */

type AckState = 'unknown' | 'acked' | 'unacked' | 'declined';

/** One mapping from the stored answer to what this overlay does about it, so
 *  the two readers below cannot drift. */
function stateFor(answer: AgeAnswer): AckState {
  if (answer === 'yes') return 'acked';
  if (answer === 'no') return 'declined';
  return 'unacked';
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * The overlay's shell — and the part that makes it a GATE rather than a
 * picture of one.
 *
 * `aria-modal` is a promise to assistive technology, not an enforcement: it
 * does not move focus and it does not stop the page underneath. So a form that
 * was already focused stayed focused when this appeared, and Enter still
 * submitted it — the case the panel found is a `/auth` sign-up form focused in
 * one tab while another tab records an under-21 answer. The dialog painted
 * over it and the account was still creatable, which is the one thing the
 * refusal exists to stop.
 *
 * Two things close that, and both are small: take focus when the dialog
 * appears, and keep Tab inside it. Nothing else on the page can then be
 * reached by keyboard, and a pointer cannot reach it either because the
 * backdrop covers the viewport.
 */
function GateDialog({ children }: { children: ReactNode }): JSX.Element {
  const panel = useRef<HTMLDivElement>(null);

  /**
   * Take focus when this dialog appears — and again whenever its CONTENT is
   * replaced under a shell React keeps mounted.
   *
   * A mount-only effect was not enough, and the way it failed is the reason
   * both listeners below are on `document` rather than on the dialog. The two
   * states render the same element type at the same position, so swapping
   * between them (the retraction, or a storage event from another tab) reuses
   * the instance: the effect does not re-run, the focused button is unmounted,
   * and `document.activeElement` falls back to `<body>`. From `<body>` the
   * next Tab is not a keydown inside the dialog at all — it never reached a
   * handler bound here — and sequential navigation resumes in the page
   * underneath, which `layout.tsx` renders BEFORE this overlay.
   *
   * `children` as the dependency is deliberate: React gives a new element
   * object per render, so this re-runs on every content change without the
   * caller having to remember a key.
   */
  useEffect(() => {
    const first = panel.current?.querySelector<HTMLElement>(FOCUSABLE);
    // `preventScroll` so an input the user was typing in is not scrolled into
    // view behind the backdrop.
    (first ?? panel.current)?.focus({ preventScroll: true });
  }, [children]);

  /**
   * The trap, on `document` for the reason above: a keypress that starts
   * outside the dialog is exactly the one that must not be allowed through,
   * and a handler on the dialog cannot see it.
   */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Tab') return;
      const container = panel.current;
      if (container === null) return;
      const focusable = Array.from(
        container.querySelectorAll<HTMLElement>(FOCUSABLE),
      );
      // Nothing to hold focus with: still refuse to hand Tab to the page.
      if (focusable.length === 0) {
        event.preventDefault();
        container.focus({ preventScroll: true });
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      const inside = container.contains(active);
      // Wrap at both ends, and treat focus that is already outside — including
      // `<body>` after a content swap — as "pull it back".
      if (!inside) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
        return;
      }
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
        return;
      }
      if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, []);

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
      <div
        ref={panel}
        tabIndex={-1}
        className="max-w-sm w-full bg-surface border border-border rounded-3xl p-8 text-center outline-none"
      >
        {children}
      </div>
    </div>
  );
}

export default function AgeGate(): JSX.Element | null {
  const router = useRouter();
  const pathname = usePathname();
  const [state, setState] = useState<AckState>('unknown');

  useEffect(() => {
    // Fail toward asking: an unreadable store (private mode) reads as
    // unacknowledged, which `readAgeAck` already guarantees.
    //
    // RE-READ ON EVERY ROUTE CHANGE, not once on mount. This overlay is
    // mounted by the ROOT LAYOUT, so it outlives every client-side
    // navigation — but the ack it reads is written by another screen. A
    // mount-once read went stale the moment `/onboarding/age` confirmed 21+
    // and pushed onward: the overlay still held `unacked`, the next route is
    // not a stand-down route, and it covered that step with the question the
    // device had just answered. Re-reading per route is the cheap half of
    // "one key, one reader": the key is the state, and this is the component
    // that has to keep looking at it.
    setState(stateFor(readAgeAnswer()));
  }, [pathname]);

  /**
   * AND RE-READ WHEN ANOTHER TAB ANSWERS. Route changes are not the only way
   * the stored answer moves: this overlay is mounted per tab, and the answer
   * is a property of the DEVICE.
   *
   * The case that made this necessary (cycle-5 panel, Codex): two tabs on an
   * unanswered device. Tab B answers 21+, so `/auth` is reachable there. Tab A
   * then answers "I'm under 21", which records the refusal — but B never
   * navigates, so it keeps the `acked` it computed minutes ago and its sign-up
   * form stays usable. The newest answer is the one that counts, and B was
   * showing an older one.
   *
   * `storage` fires only in the OTHER tabs, which is exactly the gap; the
   * writing tab already updates its own state. Filtering on the key keeps an
   * unrelated write from re-rendering the gate.
   */
  useEffect(() => {
    const onStorage = (event: StorageEvent): void => {
      if (event.key !== null && event.key !== AGE_ACK_KEY) return;
      setState(stateFor(readAgeAnswer()));
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  if (state === 'unknown' || state === 'acked') return null;
  // The age step owns this question AND its "no" branch. Never cover it.
  //
  // AND NEVER COVER WHERE THAT BRANCH ENDS. The exit withdraws the ack and
  // then sends the visitor to `AGE_EXIT_PATH`, so they arrive there
  // unacknowledged by construction. Covering it re-asked the question they
  // had just answered and whose "I'm under 21" pushed them back to the exit —
  // a terminal screen that was a loop. Both routes are stand-down routes for
  // the same reason: this overlay must not sit on top of the one flow that
  // owns the "no".
  if (pathname === AGE_STEP_PATH || pathname === AGE_EXIT_PATH) return null;

  const acknowledge = (): void => {
    writeAgeAck();
    setState('acked');
  };

  // Deliberately does NOT write, clear, or infer anything about the answer:
  // the step it hands to records the refusal itself, and duplicating that here
  // is how the two copies drift apart.
  const decline = (): void => {
    router.push(`${AGE_STEP_PATH}?under21=1`);
  };

  // The one way back from a recorded refusal. It returns the device to
  // UNANSWERED, not to 21+ — correcting a mistap means being asked again, and
  // a control that admitted you outright would be the refusal undoing itself.
  const retract = (): void => {
    clearAgeAck();
    setState('unacked');
  };

  if (state === 'declined') {
    return (
      <GateDialog>
        <p className="text-accent uppercase tracking-[0.25em] text-xs mb-3">
          Come back at 21
        </p>
        <h2 id="age-gate-title" className="font-display text-2xl mb-3">
          Next Bar is for ages 21+
        </h2>
        {/* Says only what this overlay KNOWS. It deliberately does not add
            "nothing was created": for the edge the exit screen exists for —
            a pre-V8 account, or an invite link that landed past the gate —
            that sentence would be false, and the exit screen is the one
            place that discloses the account and how to have it removed. */}
        <p className="text-muted text-sm leading-relaxed mb-6">
          You told us you&apos;re under 21, so we can&apos;t set up a Next Bar
          account.
        </p>
        <button
          type="button"
          onClick={retract}
          className="block mx-auto text-muted text-sm underline-offset-4 hover:underline min-h-[44px] touch-manipulation"
        >
          I answered that by mistake
        </button>
      </GateDialog>
    );
  }

  return (
    <GateDialog>
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
    </GateDialog>
  );
}
