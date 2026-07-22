'use client';

import Link from 'next/link';
import { useRatings } from '@/hooks/useRatings';
import { useAuth } from '@/hooks/useAuth';
import { loadProfile, clearProfile } from '@/lib/storedProfile';
import { useEffect, useState } from 'react';
import InstallPrompt from '@/components/InstallPrompt';
import { seedSampleNight, clearSampleNight, isDemoSeeded } from '@/lib/demo';

export default function SettingsPage(): JSX.Element {
  const { ratings } = useRatings();
  const auth = useAuth();
  const [hasProfile, setHasProfile] = useState(false);
  const [seeded, setSeeded] = useState(false);

  useEffect(() => {
    setHasProfile(loadProfile() !== null);
    setSeeded(isDemoSeeded());
  }, [ratings.length]);

  const handleSeed = () => {
    seedSampleNight();
    setSeeded(true);
  };

  const handleUnseed = () => {
    clearSampleNight();
    setSeeded(false);
  };

  const lovedCount = ratings.filter((r) => r.rating === 'loved').length;
  const likedCount = ratings.filter((r) => r.rating === 'liked').length;
  const passCount = ratings.filter((r) => r.rating === 'pass').length;

  const handleClearProfile = () => {
    if (typeof window === 'undefined') return;
    if (!window.confirm('Clear your saved vibe profile? You can retake the quiz anytime.')) return;
    clearProfile();
    setHasProfile(false);
  };

  const handleClearRatings = () => {
    if (typeof window === 'undefined') return;
    if (!window.confirm('Clear ALL bar ratings? This cannot be undone.')) return;
    window.localStorage.removeItem('next-bar:ratings:v1');
    // Clearing all ratings also clears the sample night, so reset the demo-seeded flags — otherwise the
    // Settings "Demo" section still shows "Remove sample night" while Rankings is empty (Codex review).
    window.localStorage.removeItem('next-bar:demo:seeded:v1');
    window.localStorage.removeItem('next-bar:demo:seeded-ids:v1');
    // useRatings reads on next mount; a hard reload is the simplest correct refresh.
    window.location.reload();
  };

  return (
    <main className="min-h-screen">
      <header className="px-6 pt-8 pb-4 text-center">
        <p className="text-accent uppercase tracking-[0.25em] text-xs mb-3">
          Your account
        </p>
        <h1 className="font-display text-3xl md:text-4xl mb-2">Settings</h1>
      </header>

      <section className="max-w-md mx-auto px-6 mt-8 mb-24 space-y-8">
        <div>
          <h2 className="font-display text-xs uppercase tracking-[0.25em] text-muted mb-3">
            Account
          </h2>
          <div className="bg-surface border border-border rounded-3xl p-5">
            {auth.status === 'loading' ? (
              <p className="text-muted text-sm">Loading…</p>
            ) : auth.status === 'signed-in' ? (
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-xs text-muted uppercase tracking-widest mb-1">
                    Signed in as
                  </p>
                  <p className="font-display text-base truncate">
                    {auth.user.email}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => auth.signOut()}
                  className="text-muted text-sm underline-offset-4 hover:underline min-h-[44px] touch-manipulation shrink-0"
                >
                  Sign out
                </button>
              </div>
            ) : auth.status === 'unavailable' ? (
              <p className="text-muted text-xs leading-relaxed">
                Sign-in is unavailable on this build — Supabase env vars are
                missing. Ratings stay on this device only.
              </p>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-muted leading-relaxed">
                  Sign in to keep your ratings across devices and unlock Friends
                  + Rankings.
                </p>
                <Link
                  href="/auth"
                  className="inline-flex items-center justify-center bg-accent text-bg font-display text-sm px-5 py-2 rounded-full min-h-[44px] touch-manipulation"
                >
                  Sign in →
                </Link>
              </div>
            )}
          </div>
        </div>

        <div>
          <h2 className="font-display text-xs uppercase tracking-[0.25em] text-muted mb-3">
            Your nights
          </h2>
          <div className="bg-surface border border-border rounded-3xl p-5 flex justify-around items-center text-center">
            <Stat label="Loved" value={lovedCount} accent />
            <div className="w-px h-10 bg-border" />
            <Stat label="Liked" value={likedCount} />
            <div className="w-px h-10 bg-border" />
            <Stat label="Passed" value={passCount} />
          </div>
        </div>

        <div>
          <h2 className="font-display text-xs uppercase tracking-[0.25em] text-muted mb-3">
            Install
          </h2>
          <div className="bg-surface border border-border rounded-3xl p-5 flex items-center justify-between gap-4">
            <p className="text-sm text-muted leading-relaxed">
              Add Next Bar to your home screen for the full app experience.
            </p>
            <InstallPrompt />
          </div>
        </div>

        <div>
          <h2 className="font-display text-xs uppercase tracking-[0.25em] text-muted mb-3">
            Vibe profile
          </h2>
          <div className="bg-surface border border-border rounded-3xl p-5 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm">
                {hasProfile ? 'Your quiz answers are saved.' : 'No vibe profile yet.'}
              </p>
              {hasProfile ? (
                <button
                  type="button"
                  onClick={handleClearProfile}
                  className="text-muted text-xs underline-offset-4 hover:underline min-h-[44px] touch-manipulation"
                >
                  Clear
                </button>
              ) : null}
            </div>
            <Link
              href="/quiz"
              className="inline-flex items-center justify-center bg-accent text-bg font-display text-sm px-5 py-2 rounded-full min-h-[44px] touch-manipulation"
            >
              {hasProfile ? 'Retake the quiz →' : 'Take the quiz →'}
            </Link>
          </div>
        </div>

        <div>
          <h2 className="font-display text-xs uppercase tracking-[0.25em] text-muted mb-3">
            Demo
          </h2>
          <div className="bg-surface border border-border rounded-3xl p-5 space-y-3">
            <p className="text-xs text-muted leading-relaxed">
              Load a sample night of ratings to see Rankings and the group
              &ldquo;Where should we go?&rdquo; picks come alive — no sign-in
              needed.
            </p>
            {seeded ? (
              <div className="flex items-center gap-4 flex-wrap">
                <Link
                  href="/rankings"
                  className="inline-flex items-center justify-center bg-accent text-bg font-display text-sm px-5 py-2 rounded-full min-h-[44px] touch-manipulation"
                >
                  View rankings →
                </Link>
                <button
                  type="button"
                  onClick={handleUnseed}
                  className="text-muted text-sm underline-offset-4 hover:underline min-h-[44px] touch-manipulation"
                >
                  Remove sample night
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={handleSeed}
                className="inline-flex items-center justify-center bg-accent text-bg font-display text-sm px-5 py-2 rounded-full min-h-[44px] touch-manipulation"
              >
                Load sample night →
              </button>
            )}
          </div>
        </div>

        <div>
          <h2 className="font-display text-xs uppercase tracking-[0.25em] text-muted mb-3">
            Data
          </h2>
          <div className="bg-surface border border-border rounded-3xl p-5 space-y-3">
            <p className="text-xs text-muted leading-relaxed">
              Everything you&apos;ve rated lives only on this device until cross-device
              sync ships with the native app.
            </p>
            <button
              type="button"
              onClick={handleClearRatings}
              disabled={ratings.length === 0}
              className="text-sm text-accent underline-offset-4 hover:underline min-h-[44px] touch-manipulation disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Clear all ratings
            </button>
          </div>
        </div>

        <div>
          <h2 className="font-display text-xs uppercase tracking-[0.25em] text-muted mb-3">
            About
          </h2>
          <div className="text-xs text-muted space-y-2 pl-1">
            <p>Next Bar · NYC · 2026</p>
            <p>
              Coverage: Manhattan and parts of Brooklyn. More neighborhoods
              rolling out.
            </p>
            <p>
              Hours and specials are best-effort.{' '}
              <Link
                href="mailto:hi@next-bar.app?subject=Bar+correction"
                className="text-accent underline-offset-4 hover:underline"
              >
                Tell us if something&apos;s wrong.
              </Link>
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}

function Stat({ label, value, accent = false }: { label: string; value: number; accent?: boolean }) {
  return (
    <div>
      <p
        className={[
          'font-display text-3xl tabular-nums leading-none',
          accent ? 'text-accent' : 'text-text',
        ].join(' ')}
      >
        {value}
      </p>
      <p className="text-[10px] uppercase tracking-widest text-muted mt-1">
        {label}
      </p>
    </div>
  );
}
