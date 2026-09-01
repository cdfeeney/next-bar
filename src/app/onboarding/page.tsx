'use client';

/**
 * Onboarding — the post-signup identity step (TikTok-style): collect the
 * account name (display name, optional) and @username (required) together.
 * Reached via OnboardingGate right after sign-up, or by any signed-in
 * account that still has no handle.
 *
 * Ordering on submit: the display name saves FIRST (own-row column write,
 * reliable and idempotent), then the handle claim (can fail: taken / lost
 * race). A failed claim keeps the saved name — the retry just re-runs both,
 * and re-saving the same name is a no-op-shaped write.
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/hooks/useAuth';
import { getBrowserSupabase } from '@/lib/supabase/client';
import { getCacheEpoch } from '@/lib/accountCache';
import {
  claimHandle,
  DISPLAY_NAME_MAX,
  fetchOwnProfile,
  isValidDisplayName,
  isValidHandle,
  setOwnDisplayName,
} from '@/lib/profile.server';
import { useHandleAvailability } from '@/hooks/useHandleAvailability';
import { setPromptedFlag } from '@/components/OnboardingGate';
import { OperationalState } from '@/components/states/OperationalState';
import {
  AGE_STEP,
  HOME,
  hasCompletedSequence,
  returnDestination as destinationFrom,
  stepHref,
} from './_sequence';

const CHARSET_HINT = '3–20 characters: letters, numbers, underscores.';

/**
 * Where onboarding ends. OnboardingGate records the route it interrupted as
 * `?next=` — criterion 1: a brand-new account that arrived on an invite link
 * must land back on THAT plan once onboarding completes, not on `/`.
 *
 * Read from `window.location` rather than `useSearchParams()`: every caller is
 * already browser-only, and the hook would force this page under a Suspense
 * boundary for a value used exactly at navigation time.
 */
function returnDestination(): string {
  if (typeof window === 'undefined') return HOME;
  return destinationFrom(window.location.search);
}

type SubmitStatus =
  | { kind: 'idle' }
  | { kind: 'submitting' }
  | { kind: 'error'; message: string };

export default function OnboardingPage(): JSX.Element {
  const auth = useAuth();
  const router = useRouter();
  const [name, setName] = useState('');
  const [desired, setDesired] = useState('');
  const [status, setStatus] = useState<SubmitStatus>({ kind: 'idle' });
  // Only render the form once the profile fetch confirms handle IS NULL —
  // an already-onboarded visitor (back nav, old link) is bounced home.
  const [ready, setReady] = useState(false);
  /**
   * The profile read did not work. NOT the same as "no handle yet".
   *
   * `fetchOwnProfile` returns null for a read error as well as for a missing
   * row, and this page used to treat both as "this account needs to be set
   * up". Every auth user has a `profiles` row — 0001's `handle_new_user`
   * trigger creates it and 0004 backfilled the rest — so for a signed-in
   * visitor a null is a FAILED READ, and acting on it showed an already-
   * onboarded account a blank identity form. Submitting it overwrote a real
   * display name before `claim_handle` refused the username, which is a
   * destructive edit made on the strength of an error.
   */
  const [readFailed, setReadFailed] = useState(false);
  /** Bumped by Retry to re-run the read. */
  const [attempt, setAttempt] = useState(0);
  /**
   * Clearing `readFailed` belongs to the RETRY, not to the top of the effect.
   * The effect's identity depends on `router`, and clearing there made the
   * screen flicker back to "Loading…" on any re-render that produced a new
   * router — a failure that erases itself is the dead end this state exists to
   * replace.
   */
  const retryRead = (): void => {
    setReadFailed(false);
    setAttempt((n) => n + 1);
  };
  const availability = useHandleAvailability(desired);

  useEffect(() => {
    if (auth.status === 'signed-out') {
      router.replace('/auth');
      return;
    }
    if (auth.status !== 'signed-in') return;
    const supabase = getBrowserSupabase();
    if (!supabase) return;

    let cancelled = false;
    const epoch = getCacheEpoch();
    fetchOwnProfile(supabase).then((profile) => {
      if (cancelled || getCacheEpoch() !== epoch) return;
      // A null profile for a signed-in account is a failed read, not an
      // account without a handle — see `readFailed` above. Stop here rather
      // than offering a form that would overwrite identity we could not read.
      if (profile === null) {
        setReadFailed(true);
        return;
      }
      if (profile.handle !== null) {
        router.replace(returnDestination());
        return;
      }
      // THE DOOR INTO THE SEQUENCE (see ./_sequence). This route is both the
      // entry point OnboardingGate redirects to and the sequence's last step,
      // and the marker is what tells those two visits apart. Without this the
      // age, location and quiz screens are unreachable except by typed URL.
      // `replace`, not `push`: the door is not a place to come back to.
      if (!hasCompletedSequence(window.location.search)) {
        router.replace(stepHref(AGE_STEP, returnDestination()));
        return;
      }
      // Prefill a previously saved name (e.g. an earlier partial attempt).
      if (profile.displayName) setName(profile.displayName);
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [auth.status, router, attempt]);

  const skip = (): void => {
    setPromptedFlag();
    router.replace(returnDestination());
  };

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (auth.status !== 'signed-in' || status.kind === 'submitting') return;
    if (!isValidDisplayName(name)) {
      setStatus({
        kind: 'error',
        message: `Keep your name under ${DISPLAY_NAME_MAX} characters.`,
      });
      return;
    }
    const trimmedHandle = desired.trim();
    if (!isValidHandle(trimmedHandle)) {
      setStatus({ kind: 'error', message: `Username: ${CHARSET_HINT}` });
      return;
    }
    const supabase = getBrowserSupabase();
    if (!supabase) {
      setStatus({
        kind: 'error',
        message: 'Sign-in is unavailable on this build.',
      });
      return;
    }

    setStatus({ kind: 'submitting' });
    // Always write (empty clears to NULL): a retry after a failed claim
    // must persist whatever is in the field NOW — including a cleared name
    // undoing an earlier partial save (DeepSeek review).
    const nameOk = await setOwnDisplayName(supabase, auth.user.id, name);
    if (!nameOk) {
      setStatus({
        kind: 'error',
        message: "Couldn't save your name — try again in a moment.",
      });
      return;
    }
    const claimed = await claimHandle(supabase, trimmedHandle);
    if (claimed === null) {
      setStatus({
        kind: 'error',
        message: 'That username is taken (or just got claimed) — try another.',
      });
      return;
    }
    // Belt-and-braces: the gate keys off the now-set handle, but the flag
    // spares one profile fetch per session.
    setPromptedFlag();
    // Full navigation (auth-page pattern) so every consumer boots with the
    // fresh identity — and back to whatever the gate interrupted, which for an
    // invite signup is the plan itself.
    window.location.assign(returnDestination());
  };

  return (
    <main className="min-h-screen">
      <header className="px-6 pt-12 pb-4 text-center">
        <p className="text-accent uppercase tracking-[0.25em] text-xs mb-3">
          One last step
        </p>
        <h1 className="font-display text-3xl md:text-4xl mb-2">
          Pick how friends see you
        </h1>
        <p className="text-muted text-sm max-w-sm mx-auto leading-relaxed">
          Your name and username are your identity on Next Bar — that&apos;s
          what friends find and follow. Your email stays private.
        </p>
      </header>

      <section className="max-w-md mx-auto px-6 mt-6 mb-24">
        <div className="bg-surface border border-border rounded-3xl p-5">
          {auth.status === 'unavailable' ? (
            <p className="text-muted text-xs leading-relaxed">
              Sign-in is unavailable on this build — Supabase env vars are
              missing.{' '}
              <Link href="/" className="text-accent underline-offset-4 hover:underline">
                Back home
              </Link>
            </p>
          ) : readFailed ? (
            /* Says what went wrong and offers the one recovery, instead of a
               blank form built on a read that failed (V8-R-OPS-007). */
            <OperationalState
              kind="failed"
              message="We couldn't load your profile, so we can't set up your username yet. Check your connection and try again."
              recovery={{ label: 'Retry', onAction: retryRead }}
            />
          ) : !ready ? (
            <p className="text-muted text-sm">Loading…</p>
          ) : (
            <form onSubmit={submit} className="space-y-5">
              <label className="block">
                <span className="text-xs text-muted uppercase tracking-widest block mb-1.5">
                  Account name
                </span>
                <input
                  type="text"
                  autoComplete="name"
                  maxLength={DISPLAY_NAME_MAX + 1}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your name"
                  className="w-full bg-bg border border-border focus:border-accent outline-none rounded-2xl px-4 py-3 text-base min-h-[44px]"
                  // readOnly, not disabled: a `disabled` field the user is
                  // typing in loses focus to <body> mid-submission (the
                  // BarLightbox rule this flow's other steps already follow).
                  readOnly={status.kind === 'submitting'}
                />
                {!isValidDisplayName(name) ? (
                  <span className="text-xs text-accent block mt-1.5" role="alert">
                    Keep it under {DISPLAY_NAME_MAX} characters.
                  </span>
                ) : null}
              </label>

              <label className="block">
                <span className="text-xs text-muted uppercase tracking-widest block mb-1.5">
                  Username
                </span>
                <input
                  type="text"
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  value={desired}
                  onChange={(e) => setDesired(e.target.value)}
                  placeholder="username"
                  className="w-full bg-bg border border-border focus:border-accent outline-none rounded-2xl px-4 py-3 text-base min-h-[44px]"
                  // readOnly, not disabled: a `disabled` field the user is
                  // typing in loses focus to <body> mid-submission (the
                  // BarLightbox rule this flow's other steps already follow).
                  readOnly={status.kind === 'submitting'}
                />
                <span
                  className={[
                    'text-xs block mt-1.5',
                    availability === 'invalid' ? 'text-accent' : 'text-muted',
                  ].join(' ')}
                >
                  {CHARSET_HINT}
                </span>
                {availability === 'checking' ? (
                  <span className="text-xs text-muted block mt-1" role="status">
                    Checking availability…
                  </span>
                ) : availability === 'available' ? (
                  <span className="text-xs text-accent block mt-1" role="status">
                    @{desired.trim().toLowerCase()} looks available.
                  </span>
                ) : availability === 'taken' ? (
                  <span className="text-xs text-muted block mt-1" role="status">
                    That one&apos;s taken — try another.
                  </span>
                ) : null}
              </label>

              {status.kind === 'error' ? (
                <p className="text-accent text-sm" role="alert">
                  {status.message}
                </p>
              ) : null}

              <div className="flex items-center gap-4 flex-wrap">
                <button
                  type="submit"
                  // aria-disabled, not disabled: this button holds focus when
                  // the tap lands, and a focused control that becomes
                  // `disabled` drops focus to <body>. `submit()` already
                  // re-checks every one of these conditions, so the guard is
                  // real and this attribute is the announcement of it.
                  aria-disabled={
                    status.kind === 'submitting' ||
                    !isValidHandle(desired) ||
                    !isValidDisplayName(name)
                  }
                  className="bg-accent text-bg font-display text-sm px-6 py-2.5 rounded-full min-h-[44px] touch-manipulation aria-disabled:opacity-50"
                >
                  {status.kind === 'submitting' ? 'Setting up…' : "Let's go →"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (status.kind !== 'submitting') skip();
                  }}
                  aria-disabled={status.kind === 'submitting'}
                  className="text-muted text-sm underline-offset-4 hover:underline min-h-[44px] touch-manipulation aria-disabled:opacity-50"
                >
                  Skip for now
                </button>
              </div>
            </form>
          )}
        </div>
      </section>
    </main>
  );
}
