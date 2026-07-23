'use client';

import { useState } from 'react';
import Link from 'next/link';
import { getBrowserSupabase } from '@/lib/supabase/client';

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

export default function AuthPage() {
  const [view, setView] = useState<View>('form');
  const [intent, setIntent] = useState<Intent>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

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
      setStatus({ kind: 'error', message: error.message });
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
        setStatus({ kind: 'error', message: error.message });
        return;
      }
      // With email confirmation on, Supabase signals "this email already
      // has an account" via an obfuscated user with zero identities.
      if (data.user && (data.user.identities?.length ?? 0) === 0) {
        setStatus({
          kind: 'error',
          message: 'That email already has an account — sign in instead.',
        });
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
      // Account-existence hints are an accepted UX tradeoff (signup
      // already says when an email is taken); what we DON'T do is surface
      // raw Supabase errors for the common cases.
      const friendly = /email not confirmed/i.test(error.message)
        ? 'Almost there — tap the verification link we emailed you, then sign in.'
        : /invalid login credentials/i.test(error.message)
          ? 'Wrong email or password. No password yet? Use "Forgot your password?" below.'
          : error.message;
      setStatus({ kind: 'error', message: friendly });
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
    <main className="min-h-screen flex flex-col">
      <header className="px-6 py-4 flex items-center justify-between border-b border-border">
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

      <section className="flex-1 flex items-center justify-center px-6 py-12">
        <div className="max-w-md w-full">
          <p className="text-accent uppercase tracking-[0.25em] text-xs mb-3 text-center">
            Save your nights
          </p>
          <h1 className="font-display text-4xl md:text-5xl text-center leading-tight mb-4">
            {view === 'forgot'
              ? 'Reset your password.'
              : intent === 'signup'
                ? 'Create your account.'
                : 'Sign in to Next Bar.'}
          </h1>
          <p className="text-muted text-sm text-center mb-8 leading-relaxed">
            {view === 'forgot'
              ? "Enter your email and we'll send a reset link."
              : 'Your ratings, lists, and profile follow you to any device.'}
          </p>

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
              <form onSubmit={handleSubmit} className="space-y-4">
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
                    className="w-full bg-surface border border-border focus:border-accent outline-none rounded-2xl px-5 py-4 text-base min-h-[44px]"
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
                      className="w-full bg-surface border border-border focus:border-accent outline-none rounded-2xl px-5 py-4 text-base min-h-[44px]"
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
                  className="w-full bg-accent text-bg hover:bg-accentDim transition-colors font-display text-lg px-6 py-4 rounded-full min-h-[44px] touch-manipulation disabled:opacity-50 disabled:cursor-not-allowed"
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

              <div className="mt-4 space-y-1 text-center">
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

          <p className="text-muted text-xs text-center mt-8 leading-relaxed">
            Signed in, your ratings sync across devices. Signed out, they
            stay on this one.
          </p>
        </div>
      </section>
    </main>
  );
}
