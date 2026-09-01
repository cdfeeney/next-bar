'use client';

/**
 * Onboarding step 2 — 21+ confirmation (V8-R-ONB-003).
 *
 * Approved canvas `next-bar-onboarding-v1`, screen 2 plus its "Under-21 exit"
 * branch state.
 *
 * One tap, no birthdate. "I'm 21 or older" writes the same DEVICE-level ack
 * the global AgeGate overlay owns — one key, one reader, one writer, all in
 * `../_ageAck`.
 *
 * NEVER ASKED TWICE. A device that already answered — the overlay on `/`, or
 * an earlier pass through this step — gets the `confirmed` view rather than a
 * silent redirect to the next step. Both halves matter and earlier review
 * rounds of this screen only ever held one of them at a time:
 *
 *   - Asking a device that had already answered the global overlay was the
 *     same question twice. So `confirmed` asks nothing: no yes, no no, one
 *     Continue.
 *   - Advancing SILENTLY deleted screen 2 from the approved sequence for
 *     everyone who met the app at `/` first, where the overlay gates the route
 *     before authentication because the App-Store pack requires it. The
 *     confirmed view puts the screen back on every entry path.
 *
 * `?under21=1` opens the exit directly, so the overlay can hand that answer to
 * the one screen that owns the exit instead of growing a second copy of it.
 * Read from `window.location` rather than `useSearchParams()`, which is this
 * repo's standing rule for a browser-only read (see `/onboarding` and
 * `/auth`): the hook would force this page under a Suspense boundary for
 * nothing.
 *
 * The under-21 exit persists no ANSWERS — the sequence keeps those in React
 * state until a step has something worth storing — but it does CLEAR the
 * device ack. An earlier version kept the ack on the reasoning that it was a
 * statement made by whoever was at the keyboard before; that left a device
 * which confirmed 21+ at the overlay able to answer "under 21" here and then
 * walk back into the app, since the overlay stays down for an acknowledged
 * device. The most recent answer is the one that counts, and it is a NO.
 */

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { signOutAndRevokePush } from '@/app/settings/_signOut';
import { AGE_EXIT_PATH, clearAgeAck, readAgeAck, writeAgeAck } from '../_ageAck';
import { LOCATION_STEP, returnDestination, stepHref } from '../_sequence';

/** The next step, carrying the destination the sequence must end on. */
function nextStep(): string {
  return stepHref(LOCATION_STEP, returnDestination(window.location.search));
}

/** The one address the rest of the app already gives people. */
const SUPPORT_EMAIL = 'hi@next-bar.app';

/**
 * How long a RESOLVED sign-out gets to be reflected in `auth.status` before
 * this screen calls it failed.
 *
 * It cannot be zero. `supabase.auth.signOut()` resolves before the
 * `onAuthStateChange` listener behind `useAuth` fires, so a successful
 * sign-out is briefly a resolved promise sitting next to a `signed-in`
 * status; checking on resolution would report a false failure every time.
 * A session still signed-in this long after a resolved call is not coming
 * down on its own — the provider returned `{ error }` and swallowed it.
 */
const SIGN_OUT_SETTLE_MS = 3_000;

/** 'reading' is the pre-read frame only — render nothing until the ack read
 * resolves. */
type View = 'reading' | 'ask' | 'confirmed' | 'exited';

/**
 * What the exit can HONESTLY say about the session it just tried to end.
 * `none` = no sign-out was attempted, so the screen says nothing about one.
 * `pending` holds until the session is OBSERVED to be gone — see below.
 */
type SignOut = 'none' | 'pending' | 'done' | 'failed';

export default function OnboardingAgePage(): JSX.Element | null {
  const router = useRouter();
  const auth = useAuth();
  const [view, setView] = useState<View>('reading');
  const [signOutState, setSignOutState] = useState<SignOut>('none');
  /**
   * Whether this tab has ever OBSERVED a real session. The tap can land while
   * `auth` is still `loading`, and signing out a session that is not there
   * resolves perfectly happily — so a resolved sign-out is not on its own
   * evidence that there was anything to sign out of.
   */
  const [sawSession, setSawSession] = useState(false);
  /** Whether the current sign-out CALL has settled, however it settled. */
  const [signOutSettled, setSignOutSettled] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (auth.status === 'signed-in') setSawSession(true);
  }, [auth.status]);

  /**
   * THE SIGN-OUT IS CLAIMED FROM THE SESSION, NOT FROM THE PROMISE.
   *
   * `supabase.auth.signOut()` RESOLVES with `{ error }` rather than throwing,
   * and `useAuth().signOut()` returns `Promise<void>` — so awaiting it proves
   * nothing about whether the session actually ended, and painting "we've
   * signed you out" on resolution put a false sentence over a live session.
   * The only honest evidence available to this screen is the auth status
   * itself leaving `signed-in`.
   *
   * BUT "PENDING" IS NOT A RESTING PLACE. Waiting on the status alone meant a
   * sign-out that RESOLVED with a swallowed `{ error }` — the common provider
   * failure, and the one `useAuth`'s `Promise<void>` cannot report — left this
   * screen saying "Signing you out…" forever, beside a live authenticated
   * session, with no retry offered and Close still available. An indefinite
   * "in progress" over a session that is still there is the same false
   * assurance as a premature success, just quieter. So a settled call whose
   * session is still `signed-in` after `SIGN_OUT_SETTLE_MS` is FAILED, which
   * is what surfaces "Try signing out again".
   */
  useEffect(() => {
    if (signOutState !== 'pending') return;
    if (auth.status === 'signed-out' || auth.status === 'unavailable') {
      setSignOutState('done');
      return;
    }
    if (!signOutSettled || auth.status !== 'signed-in') return;
    const timer = setTimeout(() => setSignOutState('failed'), SIGN_OUT_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [signOutState, signOutSettled, auth.status]);

  // An in-page swap removes the button that was focused, which drops focus to
  // <body> and announces nothing. Put it on the new heading instead.
  useEffect(() => {
    if (view === 'exited') heading.current?.focus();
  }, [view]);

  const confirm = (): void => {
    writeAgeAck();
    router.push(nextStep());
  };

  const attemptSignOut = (): void => {
    setSignOutState('pending');
    setSignOutSettled(false);
    // A throw is immediate evidence of failure. A clean resolution is not
    // evidence of SUCCESS — only that the call is over, which is what starts
    // the settle window in the effect above.
    void signOutAndRevokePush(auth.signOut).then(
      () => setSignOutSettled(true),
      () => setSignOutState('failed'),
    );
  };

  /**
   * Under 21. Every sentence on the exit screen has to be TRUE at the moment
   * it is on screen, and two things this screen cannot control make that
   * harder than it looks:
   *
   *   - "No information you entered is stored" is false once a signup
   *     confirmation link has run `supabase.auth.signUp`. The account exists,
   *     a browser cannot delete it, and the promise is therefore scoped to
   *     what this step controls, with the account that may already exist
   *     DISCLOSED alongside the one route to removing it.
   *   - "We've signed you out" must track the real session, not the call.
   */
  const exit = (): void => {
    setView('exited');
    // WITHDRAW THE DEVICE ACK. Without this, a device that confirmed 21+
    // earlier — through the global AgeGate overlay on `/` — could answer
    // "under 21" here and then reach the app anyway, because the overlay stays
    // down for an acknowledged device. The sign-out is the other half of the
    // exit and it can fail (see below); this half cannot, so it is what keeps
    // the answer binding.
    clearAgeAck();
    // 'loading' counts as "attempt it": the status may not have settled by the
    // time the tap lands, signing out a session that is not there is a no-op,
    // and leaving a real one alive is the failure this branch exists to avoid.
    if (auth.status === 'signed-out' || auth.status === 'unavailable') {
      setSignOutState('none');
      return;
    }
    attemptSignOut();
  };

  useEffect(() => {
    // The deep-linked exit is honoured BEFORE the ack read: a device that
    // acknowledged 21+ earlier is exactly the device the overlay hands over,
    // and redirecting it to the next step would swallow the answer it just
    // gave.
    if (new URLSearchParams(window.location.search).get('under21') === '1') {
      exit();
      return;
    }
    setView(readAgeAck() ? 'confirmed' : 'ask');
    // `exit` is recreated every render and this must run once per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  if (view === 'reading') return null;

  if (view === 'exited') {
    return (
      <main className="min-h-screen flex items-center justify-center px-6">
        <div className="max-w-sm w-full text-center">
          <div
            aria-hidden="true"
            className="w-20 h-20 rounded-3xl bg-surface border border-border mx-auto mb-8"
          />
          <h1
            ref={heading}
            tabIndex={-1}
            className="font-display text-2xl md:text-3xl mb-3 leading-snug outline-none"
          >
            Next Bar is for ages 21+
          </h1>
          <p className="text-muted text-sm leading-relaxed mb-4">
            We can&apos;t set up a Next Bar account for anyone under 21.
            Nothing you entered on this screen is stored.
          </p>
          {signOutState !== 'none' && sawSession ? (
            <p role="status" className="text-muted text-sm leading-relaxed mb-4">
              {signOutState === 'pending'
                ? 'Signing you out of this device…'
                : signOutState === 'done'
                  ? 'We’ve signed you out of this device.'
                  : 'We couldn’t sign you out — you’re still signed in on this device.'}
            </p>
          ) : null}
          {/* The failed branch does NOT tell people to close the tab to end
              the session: supabase-js persists the session in browser storage
              and returns the error WITHOUT removing it, so the tab reopens
              signed in. The only thing that actually ends it is another
              sign-out call, so that is what this offers instead of advice that
              is false. */}
          {signOutState === 'failed' && sawSession ? (
            <button
              type="button"
              onClick={attemptSignOut}
              className="w-full mt-2 bg-surface border border-border font-display text-base py-3 rounded-full min-h-[44px] touch-manipulation"
            >
              Try signing out again
            </button>
          ) : null}
          {/* Unconditional because it is true either way: it discloses the
              account this screen cannot delete, without asserting that one
              exists. Guessing that from auth.status would put a false sentence
              on screen in whichever direction the guess went wrong. */}
          <p className="text-muted text-sm leading-relaxed mb-4">
            If you already created an account, it still exists — email{' '}
            <a
              href={`mailto:${SUPPORT_EMAIL}?subject=Delete%20my%20account`}
              className="text-accent underline-offset-4 hover:underline"
            >
              {SUPPORT_EMAIL}
            </a>{' '}
            and we&apos;ll delete it.
          </p>
          <button
            type="button"
            onClick={() => router.push(AGE_EXIT_PATH)}
            className="w-full mt-4 bg-surface border border-border font-display text-base py-3 rounded-full min-h-[44px] touch-manipulation"
          >
            Close
          </button>
        </div>
      </main>
    );
  }

  if (view === 'confirmed') {
    return (
      <main className="min-h-screen flex items-center justify-center px-6">
        <div className="max-w-sm w-full text-center">
          <div
            aria-hidden="true"
            className="w-20 h-20 rounded-3xl bg-surface border border-border mx-auto mb-8"
          />
          <h1 className="font-display text-2xl md:text-3xl mb-3 leading-snug">
            This app is for bars and nightlife
          </h1>
          <p className="text-muted text-sm leading-relaxed mb-8">
            You already confirmed you’re 21 or older on this device.
          </p>
          <button
            type="button"
            onClick={() => router.push(nextStep())}
            className="w-full bg-accent hover:bg-accentDim transition-colors text-bg font-display text-base py-3 rounded-full min-h-[44px] touch-manipulation"
          >
            Continue
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-6">
      <div className="max-w-sm w-full text-center">
        <div
          aria-hidden="true"
          className="w-20 h-20 rounded-3xl bg-surface border border-border mx-auto mb-8"
        />
        <h1 className="font-display text-2xl md:text-3xl mb-3 leading-snug">
          This app is for bars and nightlife
        </h1>
        <p className="text-muted text-sm leading-relaxed mb-8">
          We just need to confirm your age — no birthdate required.
        </p>
        <button
          type="button"
          onClick={confirm}
          className="w-full bg-accent hover:bg-accentDim transition-colors text-bg font-display text-base py-3 rounded-full min-h-[44px] touch-manipulation"
        >
          I&apos;m 21 or older
        </button>
        <button
          type="button"
          onClick={exit}
          className="block mx-auto mt-4 text-muted text-sm underline-offset-4 hover:underline min-h-[44px] touch-manipulation"
        >
          I&apos;m under 21
        </button>
      </div>
    </main>
  );
}
