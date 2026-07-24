'use client';

import Link from 'next/link';
import { useRatings } from '@/hooks/useRatings';
import { useAuth } from '@/hooks/useAuth';
import { loadProfile, clearProfile } from '@/lib/storedProfile';
import { useEffect, useState } from 'react';
import InstallPrompt from '@/components/InstallPrompt';
import SetPassword from '@/components/SetPassword';
import ClaimHandle from '@/components/ClaimHandle';
import { fetchOwnProfile, setOwnPrivacy } from '@/lib/profile.server';
import { fetchOutgoingRequests } from '@/lib/follows.server';
import { getCacheEpoch } from '@/lib/accountCache';
import { requestAccountDeletion } from '@/lib/accountDeletion';
import { seedSampleNight, clearSampleNight, isDemoSeeded } from '@/lib/demo';
import { deleteAllServerRatings } from '@/lib/ratings.server';
import { deleteAllServerComparisons } from '@/lib/pairwise.server';
import { getBrowserSupabase } from '@/lib/supabase/client';
import { deriveTasteProfile } from '@/lib/tasteProfile';
import { deriveBadges } from '@/lib/badges';
import { useBars } from '@/lib/useBars';

// Dismissal flag for the claim-your-username nudge. UI preference only —
// deliberately NOT in accountCache ALL_KEYS (it holds no account data; a
// shared browser leaking "nudge was dismissed" is harmless).
const HANDLE_NUDGE_DISMISSED_KEY = 'next-bar:handle-nudge-dismissed:v1';

export default function SettingsPage(): JSX.Element {
  const { ratings } = useRatings();
  const bars = useBars();
  const auth = useAuth();
  const [hasProfile, setHasProfile] = useState(false);
  const [seeded, setSeeded] = useState(false);
  // null = unknown/unclaimed until the profile fetch lands; the claim UI
  // only renders once the fetch confirms handle IS NULL (handleKnown).
  const [handle, setHandle] = useState<string | null>(null);
  const [handleKnown, setHandleKnown] = useState(false);
  const [nudgeDismissed, setNudgeDismissed] = useState(true);
  // null = unknown until the profile fetch lands; the privacy toggle only
  // renders once the real value is known (no flash of a wrong default).
  const [isPrivate, setIsPrivate] = useState<boolean | null>(null);
  const [privacyBusy, setPrivacyBusy] = useState(false);
  // Consent enforcement lives in migration 0008's follow_user. Until that
  // is live, flipping "private" would DISPLAY a promise ("you approve new
  // followers") the backend cannot honor — pre-0008 follow_user creates
  // edges directly (Opus review HIGH). Feature-detect by probing the 0008
  // read RPC: null (missing RPC or transport failure) hides the toggle —
  // fail-closed is correct for a consent promise.
  const [consentLive, setConsentLive] = useState(false);
  // Account deletion (H2): idle → armed (type-to-confirm visible) →
  // deleting. 'failed' shows an inline error and returns to armed.
  const [deleteState, setDeleteState] = useState<
    'idle' | 'armed' | 'deleting' | 'failed'
  >('idle');
  const [deleteConfirmText, setDeleteConfirmText] = useState('');

  useEffect(() => {
    setHasProfile(loadProfile() !== null);
    setSeeded(isDemoSeeded());
  }, [ratings.length]);

  useEffect(() => {
    if (auth.status !== 'signed-in') return;
    setNudgeDismissed(
      window.localStorage.getItem(HANDLE_NUDGE_DISMISSED_KEY) === '1',
    );
    const supabase = getBrowserSupabase();
    if (!supabase) return;
    let cancelled = false;
    // Epoch guard (accountCache convention — Opus review): a sign-out wipe
    // mid-fetch must abandon the hydrate, not repopulate the next identity.
    const epoch = getCacheEpoch();
    fetchOwnProfile(supabase).then((profile) => {
      if (cancelled || getCacheEpoch() !== epoch || profile === null) return;
      setHandle(profile.handle);
      setHandleKnown(true);
      setIsPrivate(profile.isPrivate);
    });
    void fetchOutgoingRequests(supabase).then((outgoing) => {
      if (cancelled || getCacheEpoch() !== epoch) return;
      setConsentLive(outgoing !== null);
    });
    return () => {
      cancelled = true;
    };
  }, [auth.status]);

  const handleDismissNudge = () => {
    window.localStorage.setItem(HANDLE_NUDGE_DISMISSED_KEY, '1');
    setNudgeDismissed(true);
  };

  const handleTogglePrivacy = async () => {
    if (auth.status !== 'signed-in' || isPrivate === null || privacyBusy) return;
    const supabase = getBrowserSupabase();
    if (!supabase) return;
    const next = !isPrivate;
    // Optimistic flip with revert — the server response is authoritative.
    // Epoch guard (Opus review): an identity change while the write is in
    // flight must not revert-write user A's value into user B's view.
    const epoch = getCacheEpoch();
    setIsPrivate(next);
    setPrivacyBusy(true);
    const ok = await setOwnPrivacy(supabase, auth.user.id, next);
    if (getCacheEpoch() !== epoch) return;
    setPrivacyBusy(false);
    if (!ok) setIsPrivate(!next);
  };

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

  const taste = deriveTasteProfile(ratings, bars);
  const badgeReport = deriveBadges(ratings, bars, new Date());

  const handleClearProfile = () => {
    if (typeof window === 'undefined') return;
    if (!window.confirm('Clear your saved vibe profile? You can retake the quiz anytime.')) return;
    clearProfile();
    setHasProfile(false);
  };

  const handleDeleteAccount = async () => {
    if (auth.status !== 'signed-in' || deleteState === 'deleting') return;
    if (deleteConfirmText.trim().toLowerCase() !== 'delete') return;
    setDeleteState('deleting');
    const ok = await requestAccountDeletion(auth.session.access_token);
    if (!ok) {
      // Nothing was deleted (the route is all-or-nothing) — say so and let
      // the user retry or bail.
      setDeleteState('failed');
      return;
    }
    // The auth user is gone server-side. signOut() clears the local
    // session AND the account cache (useAuth owns that coupling), then a
    // hard redirect lands on a clean signed-out home. try/finally (Opus
    // review): the redirect must happen even if signOut throws — the
    // account no longer exists, staying on a signed-in-looking page lies.
    try {
      await auth.signOut();
    } finally {
      window.location.assign('/');
    }
  };

  const handleClearRatings = async () => {
    if (typeof window === 'undefined') return;
    if (!window.confirm('Clear ALL bar ratings? This cannot be undone.')) return;
    // Signed-in: server rows are the source of truth — delete them BEFORE the
    // reload, or useRatings re-fetches them and everything reappears.
    if (auth.status === 'signed-in') {
      const supabase = getBrowserSupabase();
      if (supabase) {
        // supabase-js resolves with { error } instead of throwing, so the
        // helpers return success booleans — a try/catch alone here was dead
        // code (Codex review). try/catch kept for genuine transport throws.
        let ok = false;
        try {
          const ratingsOk = await deleteAllServerRatings(supabase, auth.user.id);
          // The server comparison transcript must die with the ratings it
          // ranked — orphaned judgments would re-derive stale scores onto
          // re-rated bars on the next mount (santa-loop round-1 finding).
          const comparisonsOk = await deleteAllServerComparisons(
            supabase,
            auth.user.id,
          );
          ok = ratingsOk && comparisonsOk;
        } catch {
          ok = false;
        }
        if (!ok) {
          // Surface the failure instead of a silent no-op: clearing only
          // locally would just re-fetch everything after the reload.
          window.alert(
            "Couldn't reach the server, so your ratings were NOT cleared. Try again in a moment.",
          );
          return;
        }
      }
    }
    window.localStorage.removeItem('next-bar:ratings:v1');
    // Stale pairwise comparisons would silently re-derive scores onto freshly
    // re-rated bars — clear them together with the ratings they came from.
    window.localStorage.removeItem('next-bar:pairwise:v1');
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
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-xs text-muted uppercase tracking-widest mb-1">
                      Signed in as
                    </p>
                    <p className="font-display text-base truncate">
                      {auth.user.email}
                    </p>
                    {handle !== null ? (
                      <p className="text-accent text-sm mt-1 truncate">@{handle}</p>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    onClick={() => auth.signOut()}
                    className="text-muted text-sm underline-offset-4 hover:underline min-h-[44px] touch-manipulation shrink-0"
                  >
                    Sign out
                  </button>
                </div>
                {handleKnown && handle === null ? (
                  <div className="pt-3 border-t border-border space-y-3">
                    {!nudgeDismissed ? (
                      <div className="flex items-start justify-between gap-3">
                        <p className="text-xs text-muted leading-relaxed">
                          Usernames are here — claim yours so friends can find
                          you.
                        </p>
                        <button
                          type="button"
                          onClick={handleDismissNudge}
                          aria-label="Dismiss username nudge"
                          className="text-muted text-xs underline-offset-4 hover:underline min-h-[44px] touch-manipulation shrink-0"
                        >
                          Dismiss
                        </button>
                      </div>
                    ) : null}
                    <ClaimHandle onClaimed={setHandle} />
                  </div>
                ) : null}
                <div className="pt-3 border-t border-border">
                  <SetPassword />
                </div>
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

        {auth.status === 'signed-in' && isPrivate !== null && consentLive ? (
          <div>
            <h2 className="font-display text-xs uppercase tracking-[0.25em] text-muted mb-3">
              Privacy
            </h2>
            <div className="bg-surface border border-border rounded-3xl p-5 flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="text-sm mb-1">Private account</p>
                <p className="text-xs text-muted leading-relaxed">
                  {isPrivate
                    ? 'New followers must send a request you approve. People who already follow you keep access.'
                    : 'Anyone can follow you and your username appears in search.'}
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={isPrivate}
                aria-label="Private account"
                disabled={privacyBusy}
                onClick={handleTogglePrivacy}
                className={[
                  'shrink-0 relative w-12 h-7 rounded-full border transition-colors touch-manipulation disabled:opacity-50',
                  isPrivate ? 'bg-accent border-accent' : 'bg-surface border-border',
                ].join(' ')}
              >
                <span
                  aria-hidden
                  className={[
                    'absolute top-0.5 w-5 h-5 rounded-full transition-all',
                    isPrivate ? 'right-0.5 bg-bg' : 'left-0.5 bg-muted',
                  ].join(' ')}
                />
              </button>
            </div>
          </div>
        ) : null}

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

        {ratings.length > 0 ? (
          <div>
            <h2 className="font-display text-xs uppercase tracking-[0.25em] text-muted mb-3">
              Badges
            </h2>
            <div className="bg-surface border border-border rounded-3xl p-5 space-y-4">
              <p className="text-xs text-muted">
                Explorer score{' '}
                <span className="text-accent font-display tabular-nums">
                  {badgeReport.explorerScore}
                </span>
                {badgeReport.weekendStreakCount >= 2
                  ? ` · ${badgeReport.weekendStreakCount}-weekend streak`
                  : null}
              </p>
              <ul className="flex flex-wrap gap-2">
                {badgeReport.badges.map((b) => (
                  <li
                    key={b.id}
                    title={b.description}
                    className={[
                      'text-xs rounded-full px-3 py-1 border',
                      b.earned
                        ? 'border-accent text-accent'
                        : 'border-border text-muted opacity-60',
                    ].join(' ')}
                  >
                    {b.label}
                    {b.earned
                      ? ''
                      : ` ${b.progress.current}/${b.progress.target}`}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : null}

        {taste.archetype !== null ? (
          <div>
            <h2 className="font-display text-xs uppercase tracking-[0.25em] text-muted mb-3">
              Your taste
            </h2>
            <div className="bg-surface border border-border rounded-3xl p-5 space-y-4">
              <p className="font-display text-xl text-accent">{taste.archetype}</p>
              <div className="flex flex-wrap gap-2">
                {taste.topTags.map((t) => (
                  <span
                    key={t.tag}
                    className="text-xs border border-border rounded-full px-3 py-1 text-muted"
                  >
                    {t.tag}
                  </span>
                ))}
              </div>
              {taste.neighborhoods.length > 0 ? (
                <p className="text-xs text-muted leading-relaxed">
                  Home turf:{' '}
                  {taste.neighborhoods
                    .slice(0, 3)
                    .map((n) => `${n.neighborhood} (${n.count})`)
                    .join(' · ')}
                </p>
              ) : null}
            </div>
          </div>
        ) : null}

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

        {auth.status === 'signed-in' ? (
          <div>
            <h2 className="font-display text-xs uppercase tracking-[0.25em] text-muted mb-3">
              Danger zone
            </h2>
            <div className="bg-surface border border-border rounded-3xl p-5 space-y-3">
              <p className="text-xs text-muted leading-relaxed">
                Deleting your account removes your login, profile, username,
                ratings, rankings, and follows — permanently. There is no
                undo.
              </p>
              {deleteState === 'idle' ? (
                <button
                  type="button"
                  onClick={() => setDeleteState('armed')}
                  className="text-sm text-red-400 underline-offset-4 hover:underline min-h-[44px] touch-manipulation"
                >
                  Delete account
                </button>
              ) : (
                <div className="space-y-3">
                  <label
                    htmlFor="delete-confirm"
                    className="block text-xs text-muted"
                  >
                    Type <span className="text-text font-display">delete</span>{' '}
                    to confirm:
                  </label>
                  <input
                    id="delete-confirm"
                    type="text"
                    inputMode="text"
                    autoComplete="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    // Arming unmounts the trigger button — move focus here
                    // so keyboard/screen-reader users aren't dropped to
                    // <body> (Opus a11y review).
                    autoFocus
                    value={deleteConfirmText}
                    onChange={(e) => setDeleteConfirmText(e.target.value)}
                    className="w-full bg-bg border border-border rounded-2xl px-4 py-3 text-base text-text placeholder:text-muted focus:outline-none focus:border-red-400 min-h-[44px]"
                  />
                  {deleteState === 'failed' ? (
                    <p className="text-red-400 text-xs" role="status">
                      Couldn&apos;t delete your account — nothing was removed.
                      Try again in a moment, or email hi@next-bar.app.
                    </p>
                  ) : null}
                  <div className="flex items-center gap-4">
                    <button
                      type="button"
                      onClick={handleDeleteAccount}
                      disabled={
                        deleteConfirmText.trim().toLowerCase() !== 'delete' ||
                        deleteState === 'deleting'
                      }
                      className="bg-red-500/90 hover:bg-red-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors text-white font-display text-sm px-5 py-2 rounded-full min-h-[44px] touch-manipulation"
                    >
                      {deleteState === 'deleting'
                        ? 'Deleting…'
                        : 'Permanently delete'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setDeleteState('idle');
                        setDeleteConfirmText('');
                      }}
                      disabled={deleteState === 'deleting'}
                      className="text-muted text-sm underline-offset-4 hover:underline min-h-[44px] touch-manipulation disabled:opacity-40"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : null}

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
            <p>
              <Link
                href="/privacy"
                className="text-accent underline-offset-4 hover:underline"
              >
                Privacy Policy
              </Link>
              {' · '}
              <Link
                href="/terms"
                className="text-accent underline-offset-4 hover:underline"
              >
                Terms of Use
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
