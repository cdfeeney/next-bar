'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { getBrowserSupabase } from '@/lib/supabase/client';
import { AUTH_COPY, authErrorMessage } from '@/lib/authErrors';
import {
  classifyCallbackError,
  type CallbackErrorKind,
} from '@/lib/authCallbackErrors';

/**
 * /auth — conventional email + password sign-in (operator call 2026-07-23:
 * the earlier magic-link tab read as confusing; people expect
 * username/password + "forgot password").
 *
 * Flows:
 *   - Sign in: signInWithPassword → land on /settings.
 *   - Create account: signUp → verification email → tap → signed in.
 *   - Forgot password: resetPasswordForEmail → recovery email → tap → the
 *     callback signs them in and lands on /settings, where the account
 *     card's "Set a password" mints the new one. (Reuses the existing
 *     pieces instead of a dedicated reset page.)
 *
 * Phone-number OTP sign-in is escalated — it needs an SMS provider
 * (Twilio) configured in the Supabase dashboard. Wire it here once the
 * operator supplies credentials (see nightlog escalation queue).
 */

type View = 'form' | 'forgot';
type Intent = 'signin' | 'signup';

type Status =
  | { kind: 'idle' }
  | { kind: 'sending' }
  /** Account created — check inbox to verify before first sign-in. */
  | { kind: 'confirm'; email: string }
  /** Reset email sent — tap it, then set a new password in Settings. */
  | { kind: 'reset-sent'; email: string }
  | { kind: 'error'; message: string };

// Supabase's server-side default minimum; keep the client check in sync so
// users get our copy, not a raw API error.
const MIN_PASSWORD_LENGTH = 6;

/** Where every successful auth path lands — the account card makes the
 *  signed-in state visible immediately (vs. the anonymous-looking home). */
const AFTER_AUTH_PATH = '/settings';

const UNCONFIGURED_MESSAGE =
  'Sign-in is unavailable — Supabase env vars are missing on this build.';

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/**
 * `/auth/callback` and `/auth/confirm` redirect failures here as `?error=...`
 * carrying a stable sentinel. Classification lives in `@/lib/authCallbackErrors`
 * so it is unit-testable independently of this component — the PKCE-vs-expired
 * ordering it encodes is a P0 fix, not an implementation detail.
 */

export default function AuthPage() {
  const router = useRouter();
  const [view, setView] = useState<View>('form');
  const [intent, setIntent] = useState<Intent>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [callbackError, setCallbackError] = useState<CallbackErrorKind | null>(
    null,
  );

  useEffect(() => {
    // Read via window.location (not useSearchParams) so the page keeps its
    // current no-Suspense structure; this only runs client-side anyway.
    const raw = new URLSearchParams(window.location.search).get('error');
    if (!raw) return;
    setCallbackError(classifyCallbackError(raw));
    // Strip the param so a refresh doesn't re-show a stale error.
    router.replace('/auth', { scroll: false });
  }, [router]);

  const callbackUrl = (): string =>
    `${window.location.origin}/auth/callback?redirect_to=${AFTER_AUTH_PATH}`;

  const handleForgotSubmit = async (): Promise<void> => {
    const supabase = getBrowserSupabase();
    if (!supabase) {
      setStatus({ kind: 'error', message: UNCONFIGURED_MESSAGE });
      return;
    }
    setStatus({ kind: 'sending' });
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: callbackUrl(),
    });
    if (error) {
      setStatus({ kind: 'error', message: authErrorMessage(error, 'reset') });
      return;
    }
    setStatus({ kind: 'reset-sent', email: email.trim() });
  };

  const handlePasswordSubmit = async (): Promise<void> => {
    if (password.length < MIN_PASSWORD_LENGTH) {
      setStatus({
        kind: 'error',
        message: `Password needs at least ${MIN_PASSWORD_LENGTH} characters.`,
      });
      return;
    }
    const supabase = getBrowserSupabase();
    if (!supabase) {
      setStatus({ kind: 'error', message: UNCONFIGURED_MESSAGE });
      return;
    }
    setStatus({ kind: 'sending' });

    if (intent === 'signup') {
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: { emailRedirectTo: callbackUrl() },
      });
      if (error) {
        setStatus({ kind: 'error', message: authErrorMessage(error, 'signup') });
        return;
      }
      // With email confirmation on, Supabase signals "this email already
      // has an account" via an obfuscated user with zero identities.
      if (data.user && (data.user.identities?.length ?? 0) === 0) {
        setStatus({ kind: 'error', message: AUTH_COPY.emailExists });
        setIntent('signin');
        return;
      }
      setStatus({ kind: 'confirm', email: email.trim() });
      return;
    }

    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (error) {
      // Account-existence hints are an accepted UX tradeoff (signup already
      // says when an email is taken). What we never do is surface a raw
      // Supabase message — including the fallback branch, which is how
      // "Load failed" reached users before the 2026-08-06 audit.
      setStatus({ kind: 'error', message: authErrorMessage(error, 'signin') });
      return;
    }
    // Full navigation (not router.push) so every useAuth consumer boots
    // from the fresh session.
    window.location.assign(AFTER_AUTH_PATH);
  };

  const handleSubmit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (!isEmail(email.trim())) {
      setStatus({ kind: 'error', message: "That email doesn't look right." });
      return;
    }
    if (view === 'forgot') await handleForgotSubmit();
    else await handlePasswordSubmit();
  };

  const isBusy = status.kind === 'sending';
  const inboxState =
    status.kind === 'confirm' || status.kind === 'reset-sent' ? status : null;

  return (
    /*
     * LAYOUT NOTE (g-4e72a0c5, visual only). `dvh` not `vh`: under collapsing
     * mobile browser chrome `100vh` is the LARGE viewport, so a `100vh` box is
     * taller than what the user can actually see and the submit button sits
     * below the fold on first paint. `min-h-dvh` tracks the live viewport.
     * Heights stay `min-h-*` rather than `h-*` so nothing here can ever
     * suppress the vertical scrolling a keyboard, a short screen, or enlarged
     * accessibility text requires.
     *
     * The `min-h-screen` underneath is a real fallback, not redundancy: on an
     * engine without `dvh` (iOS Safari < 15.4, Chrome < 108) the `dvh`
     * declaration is dropped at parse time and `main` would lose its
     * min-height entirely, collapsing the short states to content height. The
     * override is gated on `@supports` rather than written as a bare
     * `min-h-screen min-h-dvh` pair because that pair depends on the ORDER
     * Tailwind happens to emit two same-specificity utilities in, which is a
     * build artifact and not a contract. (santa: GLM + DeepSeek, adjudicated
     * by Kimi.)
     */
    <main className="min-h-screen supports-[min-height:100dvh]:min-h-dvh flex flex-col">
      <header className="px-6 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3 flex items-center justify-between border-b border-border">
        <Link
          href="/"
          className="font-display text-accent text-sm uppercase tracking-[0.3em] min-h-[44px] inline-flex items-center touch-manipulation"
        >
          Next Bar
        </Link>
        <Link
          href="/"
          className="text-muted hover:text-text underline-offset-4 hover:underline text-sm min-h-[44px] inline-flex items-center touch-manipulation"
        >
          Skip for now
        </Link>
      </header>

      {/* Phone gutters are the minimum, not the look: centring already supplies
          breathing room whenever the form is shorter than the viewport, so the
          old `py-12` bought nothing but 96px of scroll on a 390x664 screen.
          Desktop keeps the generous spacing.

          Centring is `m-auto` on the card rather than `items-center` here on
          purpose. With `items-center`, content taller than the section
          overflows SYMMETRICALLY and the top half scrolls into unreachable
          negative space. Today that never fires, because a flex item's
          automatic minimum size keeps this section at least content-tall — but
          that protection silently disappears the moment anyone adds an
          `overflow-*` class here, which is the ordinary way people clip a
          decoration. Auto margins are specified to resolve to zero when free
          space is negative, so overflow can only ever go downward, where it
          stays scrollable. (santa: GLM + DeepSeek, endorsed by Kimi.) */}
      <section className="flex-1 flex px-6 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] md:py-12">
        <div className="max-w-md w-full m-auto">
          <p className="text-accent uppercase tracking-[0.25em] text-xs mb-2 md:mb-3 text-center">
            Save your nights
          </p>
          <h1 className="font-display text-3xl md:text-5xl text-center leading-tight mb-3 md:mb-4">
            {view === 'forgot'
              ? 'Reset your password.'
              : intent === 'signup'
                ? 'Create your account.'
                : 'Sign in to Next Bar.'}
          </h1>
          <p className="text-muted text-sm text-center mb-6 md:mb-8 leading-relaxed">
            {view === 'forgot'
              ? "Enter your email and we'll send a reset link."
              : 'Your ratings, lists, and profile follow you to any device.'}
          </p>

          {callbackError ? (
            <div
              role="alert"
              className="bg-surface border border-border rounded-2xl p-4 mb-6 text-center"
            >
              {callbackError === 'pkce-mismatch' ? (
                <>
                  {/*
                    The link is FINE — it was opened somewhere other than
                    where it was requested (TestFlight WebView → Safari, or
                    phone → laptop). Telling these users the link "expired"
                    sent them to request another one, which failed the same
                    way; the resend button here works because finishing in
                    THIS window satisfies the same-browser requirement.
                  */}
                  <p className="text-sm mb-1">
                    Finish on the same device and browser you started from.
                  </p>
                  <p className="text-muted text-xs mb-1 leading-relaxed">
                    For your security, that link only completes where it was
                    requested. Ask for a fresh one here and it will work in
                    this window.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setCallbackError(null);
                      setStatus({ kind: 'idle' });
                      setView('forgot');
                    }}
                    className="text-accent text-sm underline-offset-4 hover:underline min-h-[44px] touch-manipulation"
                  >
                    Send a new link
                  </button>
                </>
              ) : callbackError === 'expired-link' ? (
                <>
                  <p className="text-sm mb-1">
                    That link has expired or was already used.
                  </p>
                  <p className="text-muted text-xs mb-1 leading-relaxed">
                    Email links only work once. Enter your email and
                    we&apos;ll send you a fresh one.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setCallbackError(null);
                      setStatus({ kind: 'idle' });
                      setView('forgot');
                    }}
                    className="text-accent text-sm underline-offset-4 hover:underline min-h-[44px] touch-manipulation"
                  >
                    Send a new link
                  </button>
                </>
              ) : (
                <p className="text-sm">
                  {callbackError === 'unconfigured'
                    ? UNCONFIGURED_MESSAGE
                    : "Sign-in didn't complete. Please try again."}
                </p>
              )}
            </div>
          ) : null}

          {inboxState ? (
            <div className="bg-surface border border-border rounded-3xl p-6 text-center">
              <p className="font-display text-2xl mb-2 leading-snug">
                Check your inbox.
              </p>
              <p className="text-muted text-sm mb-4">
                {inboxState.kind === 'confirm' ? (
                  <>
                    We sent a verification link to{' '}
                    <strong className="text-text">{inboxState.email}</strong>.
                    Tap it to activate your account — then your password
                    works everywhere.
                  </>
                ) : (
                  <>
                    We sent a reset link to{' '}
                    <strong className="text-text">{inboxState.email}</strong>.
                    Tap it and you&apos;ll be signed in — then set your new
                    password from Settings.
                  </>
                )}
              </p>
              <button
                type="button"
                onClick={() => {
                  setStatus({ kind: 'idle' });
                  setView('form');
                }}
                className="text-accent text-sm underline-offset-4 hover:underline min-h-[44px] touch-manipulation"
              >
                Back to sign in
              </button>
            </div>
          ) : (
            <>
              <form onSubmit={handleSubmit} className="space-y-3 md:space-y-4">
                <label className="block">
                  <span className="sr-only">Email</span>
                  <input
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="w-full bg-surface border border-border focus:border-accent outline-none rounded-2xl px-5 py-3 md:py-4 text-base min-h-[44px]"
                    disabled={isBusy}
                  />
                </label>

                {view === 'form' ? (
                  <label className="block">
                    <span className="sr-only">Password</span>
                    <input
                      type="password"
                      autoComplete={
                        intent === 'signup'
                          ? 'new-password'
                          : 'current-password'
                      }
                      required
                      minLength={MIN_PASSWORD_LENGTH}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder={
                        intent === 'signup'
                          ? `Choose a password (${MIN_PASSWORD_LENGTH}+ characters)`
                          : 'Password'
                      }
                      className="w-full bg-surface border border-border focus:border-accent outline-none rounded-2xl px-5 py-3 md:py-4 text-base min-h-[44px]"
                      disabled={isBusy}
                    />
                  </label>
                ) : null}

                {status.kind === 'error' ? (
                  <p className="text-accent text-sm text-center" role="alert">
                    {status.message}
                  </p>
                ) : null}

                <button
                  type="submit"
                  disabled={isBusy}
                  className="w-full bg-accent text-bg hover:bg-accentDim transition-colors font-display text-lg px-6 py-3 md:py-4 rounded-full min-h-[44px] touch-manipulation disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isBusy
                    ? 'One sec…'
                    : view === 'forgot'
                      ? 'Send reset link →'
                      : intent === 'signup'
                        ? 'Create account →'
                        : 'Sign in →'}
                </button>
              </form>

              <div className="mt-3 md:mt-4 space-y-1 text-center">
                {view === 'form' ? (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        setIntent(intent === 'signup' ? 'signin' : 'signup');
                        if (status.kind === 'error')
                          setStatus({ kind: 'idle' });
                      }}
                      className="block mx-auto text-accent text-sm underline-offset-4 hover:underline min-h-[44px] touch-manipulation"
                    >
                      {intent === 'signup'
                        ? 'Have an account? Sign in'
                        : 'New here? Create an account'}
                    </button>
                    {intent === 'signin' ? (
                      <button
                        type="button"
                        onClick={() => {
                          setView('forgot');
                          if (status.kind === 'error')
                            setStatus({ kind: 'idle' });
                        }}
                        className="block mx-auto text-muted text-sm underline-offset-4 hover:underline min-h-[44px] touch-manipulation"
                      >
                        Forgot your password?
                      </button>
                    ) : null}
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setView('form');
                      if (status.kind === 'error') setStatus({ kind: 'idle' });
                    }}
                    className="block mx-auto text-accent text-sm underline-offset-4 hover:underline min-h-[44px] touch-manipulation"
                  >
                    ← Back to sign in
                  </button>
                )}
              </div>
            </>
          )}

          <p className="text-muted text-xs text-center mt-6 md:mt-8 leading-relaxed">
            Signed in, your ratings sync across devices. Signed out, they
            stay on this one.
          </p>
        </div>
      </section>
    </main>
  );
}
