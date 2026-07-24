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

const CHARSET_HINT = '3–20 characters: letters, numbers, underscores.';

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
      if (profile !== null && profile.handle !== null) {
        router.replace('/');
        return;
      }
      // Prefill a previously saved name (e.g. an earlier partial attempt).
      if (profile?.displayName) setName(profile.displayName);
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [auth.status, router]);

  const skip = (): void => {
    setPromptedFlag();
    router.replace('/');
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
    // fresh identity.
    window.location.assign('/');
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
                  disabled={status.kind === 'submitting'}
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
                  disabled={status.kind === 'submitting'}
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
                  disabled={
                    status.kind === 'submitting' ||
                    !isValidHandle(desired) ||
                    !isValidDisplayName(name)
                  }
                  className="bg-accent text-bg font-display text-sm px-6 py-2.5 rounded-full min-h-[44px] touch-manipulation disabled:opacity-50"
                >
                  {status.kind === 'submitting' ? 'Setting up…' : "Let's go →"}
                </button>
                <button
                  type="button"
                  onClick={skip}
                  disabled={status.kind === 'submitting'}
                  className="text-muted text-sm underline-offset-4 hover:underline min-h-[44px] touch-manipulation"
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
