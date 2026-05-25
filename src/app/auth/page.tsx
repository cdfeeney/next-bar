'use client';

import { useState } from 'react';
import Link from 'next/link';
import { getBrowserSupabase } from '@/lib/supabase/client';

type Status =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'sent'; email: string }
  | { kind: 'error'; message: string };

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export default function AuthPage() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = email.trim();
    if (!isEmail(trimmed)) {
      setStatus({ kind: 'error', message: "That email doesn't look right." });
      return;
    }

    const supabase = getBrowserSupabase();
    if (!supabase) {
      setStatus({
        kind: 'error',
        message:
          'Sign-in is unavailable — Supabase env vars are missing on this build.',
      });
      return;
    }

    setStatus({ kind: 'sending' });

    const { error } = await supabase.auth.signInWithOtp({
      email: trimmed,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
        shouldCreateUser: true,
      },
    });

    if (error) {
      setStatus({ kind: 'error', message: error.message });
      return;
    }

    setStatus({ kind: 'sent', email: trimmed });
  };

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
            Sign in to Next Bar.
          </h1>
          <p className="text-muted text-sm text-center mb-10 leading-relaxed">
            We&apos;ll email you a sign-in link. No password.
            Your ratings and saved profile follow you to any device.
          </p>

          {status.kind === 'sent' ? (
            <div className="bg-surface border border-border rounded-3xl p-6 text-center">
              <p className="font-display text-2xl mb-2 leading-snug">
                Check your inbox.
              </p>
              <p className="text-muted text-sm mb-4">
                We sent a sign-in link to <strong className="text-text">{status.email}</strong>.
                Tap it on this device to come back signed in.
              </p>
              <button
                type="button"
                onClick={() => setStatus({ kind: 'idle' })}
                className="text-accent text-sm underline-offset-4 hover:underline min-h-[44px] touch-manipulation"
              >
                Use a different email
              </button>
            </div>
          ) : (
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
                  disabled={status.kind === 'sending'}
                />
              </label>

              {status.kind === 'error' ? (
                <p className="text-accent text-sm text-center" role="alert">
                  {status.message}
                </p>
              ) : null}

              <button
                type="submit"
                disabled={status.kind === 'sending'}
                className="w-full bg-accent text-bg hover:bg-accentDim transition-colors font-display text-lg px-6 py-4 rounded-full min-h-[44px] touch-manipulation disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {status.kind === 'sending' ? 'Sending…' : 'Send sign-in link →'}
              </button>
            </form>
          )}

          <p className="text-muted text-xs text-center mt-8 leading-relaxed">
            By signing in you agree to keep your ratings on this device
            until cross-device sync ships in v0.5.0.
          </p>
        </div>
      </section>
    </main>
  );
}
