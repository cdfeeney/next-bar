'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import Avatar from '@/components/Avatar';
import { useAuth } from '@/hooks/useAuth';
import { useFollowRequests } from '@/hooks/useFollowRequests';
import { useFollows } from '@/hooks/useFollows';
import { useRatings } from '@/hooks/useRatings';
import { assembleNight, lastNightKey } from '@/lib/nightLog';
import { nycNightKey } from '@/lib/nightKey';
import { composeRecap, type Recap } from '@/lib/recap';
import { useBars } from '@/lib/useBars';
import { useOwnProfile } from './_useOwnProfile';

/**
 * Account — the profile ROOT (approved/next-bar-account-a-tabs.png).
 *
 * This route used to serve the legacy Settings page under a renamed tab. It is
 * now the profile: a fixed identity header (photo, name, @username, connection
 * counts, gear) with the Nights Out content below it. The gear is the single
 * entry to Settings, which is a separate hierarchical stack at
 * /settings/preferences — no settings rows live here (V8-R-ACC-001).
 *
 * NO BADGES TAB AND NO PERSONA CARD. Both are drawn in full on the approved
 * canvas and both are DEFERRED TO V9 by V8-R-ACC-003, whose exclusions are
 * "no Badges tab in V8" and "no Persona card in V8". The segmented control
 * went with them: a tablist with one tab is chrome around nothing. The tab
 * this surface would have swapped to is a V9 build, not a hidden V8 one.
 *
 * MECE, per the reference: Nights Out = this device's current-or-previous
 * night recap, Rankings (its own tab) = bar taste. Neither repeats the other.
 *
 * V8 SCOPE (operator amendment, 2026-08-22): the durable multi-night archive
 * with tappable saved recaps is V9. Nights Out shows only what the device
 * actually holds, and no copy on this surface may promise saved past nights.
 */

export default function AccountPage(): JSX.Element {
  const auth = useAuth();
  const { ratings } = useRatings();
  const bars = useBars();
  const { follows, mutuals } = useFollows();
  const { requests } = useFollowRequests();
  const profile = useOwnProfile();
  const [nights, setNights] = useState<Recap[]>([]);

  // The night log is localStorage-only, so compose after mount. The device
  // holds ONE night at a time (nightLog is night-scoped by comparison), so
  // this is tonight's route if it has started, else last night's.
  useEffect(() => {
    const now = new Date();
    const composed = [nycNightKey(now), lastNightKey(now)]
      .map((key) => composeRecap(assembleNight(key), bars))
      .filter((recap): recap is Recap => recap !== null);
    setNights(composed);
  }, [bars, ratings.length]);

  const seed = profile.handle ?? 'account';

  return (
    <main className="min-h-screen">
      <header className="px-5 pt-[max(1.5rem,env(safe-area-inset-top))] pb-2 max-w-md mx-auto flex items-center justify-between gap-3">
        <h1 className="font-display text-3xl">Account</h1>
        {/* The gear is an ENTRY, not an overlay — it pushes the Settings
            stack, which has its own back arrow and no bottom nav. */}
        <Link
          href="/settings/preferences"
          aria-label="Settings"
          className="w-11 h-11 shrink-0 inline-flex items-center justify-center rounded-full bg-surface border border-border text-text touch-manipulation"
        >
          <GearIcon />
        </Link>
      </header>

      <div className="max-w-md mx-auto px-5 pb-28 space-y-5">
        <IdentityHeader
          displayName={profile.displayName}
          handle={profile.handle}
          seed={seed}
          authStatus={auth.status}
        />

        <dl className="grid grid-cols-3 border-y border-border py-4 text-center">
          <CountStat label="Friends" value={mutuals.length} />
          <CountStat label="Following" value={follows.length} />
          <CountStat label="Requests" value={requests.length} accent />
        </dl>

        <section aria-labelledby="account-nights-heading" className="space-y-3">
          <h2
            id="account-nights-heading"
            className="font-display text-[11px] uppercase tracking-[0.2em] text-muted px-1"
          >
            Nights Out
          </h2>
          <NightsPanel nights={nights} />
        </section>
      </div>
    </main>
  );
}

function IdentityHeader({
  displayName,
  handle,
  seed,
  authStatus,
}: {
  displayName: string | null;
  handle: string | null;
  seed: string;
  authStatus: ReturnType<typeof useAuth>['status'];
}): JSX.Element {
  if (authStatus === 'signed-in') {
    // Identity convention: display name on top, grey @handle under it. A
    // handle-only profile has no display name, so the handle IS the top line
    // and the secondary line is dropped — it was printing @handle twice.
    const primary = displayName ?? (handle !== null ? `@${handle}` : null);
    const showHandleLine = displayName !== null && handle !== null;
    return (
      <div className="flex items-center gap-4">
        <span className="rounded-full border-2 border-accent p-0.5">
          <Avatar initials={initialsFor(primary ?? '?')} seed={seed} size="lg" />
        </span>
        <div className="min-w-0">
          <p className="font-display text-2xl truncate">{primary ?? '…'}</p>
          {showHandleLine ? (
            <p className="text-muted text-sm truncate">@{handle}</p>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-4">
      <span className="rounded-full border-2 border-border p-0.5">
        <Avatar initials="NB" seed="guest" size="lg" />
      </span>
      <div className="min-w-0 space-y-2">
        <p className="font-display text-xl">Not signed in</p>
        {authStatus === 'unavailable' ? (
          <p className="text-muted text-xs leading-relaxed">
            Sign-in is unavailable on this build — Supabase env vars are
            missing. Ratings stay on this device only.
          </p>
        ) : (
          <Link
            href="/auth"
            className="inline-flex items-center justify-center bg-accent text-bg font-display text-sm px-5 py-2 rounded-full min-h-[44px] touch-manipulation"
          >
            Sign in →
          </Link>
        )}
      </div>
    </div>
  );
}

function CountStat({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: number;
  accent?: boolean;
}): JSX.Element {
  return (
    <div>
      <dd
        className={[
          'font-display text-2xl tabular-nums leading-none',
          accent && value > 0 ? 'text-accent' : 'text-text',
        ].join(' ')}
      >
        {value}
      </dd>
      <dt className="text-[10px] uppercase tracking-widest text-muted mt-1">
        {label}
      </dt>
    </div>
  );
}

function NightsPanel({ nights }: { nights: Recap[] }): JSX.Element {
  return (
    <div className="space-y-3">
      {nights.length === 0 ? (
        <p className="text-muted text-sm leading-relaxed bg-surface border border-border rounded-2xl p-5">
          No nights out yet. Pick a bar on Next Bar? and tonight&apos;s route
          shows up here — the bars you hit and what you rated.
        </p>
      ) : (
        nights.map((night) => <NightCard key={night.nightKey} night={night} />)
      )}
    </div>
  );
}

function NightCard({ night }: { night: Recap }): JSX.Element {
  const hood = night.bars[0]?.neighborhood ?? null;
  const stops = night.bars.length;
  return (
    <article
      data-testid="account-night-card"
      className="bg-surface border border-border rounded-2xl p-4"
    >
      <h3 className="font-display text-base">
        {hood !== null ? `${hood} ${weekdayOf(night.nightKey)}` : weekdayOf(night.nightKey)}
      </h3>
      <p className="text-xs text-muted mt-1">
        {formatNightDate(night.nightKey)} · {stops} {stops === 1 ? 'bar' : 'bars'}
        {night.loved !== null ? ` · loved ${night.loved.name}` : ''}
      </p>
      <ol className="mt-3 space-y-1">
        {night.bars.map((bar, index) => (
          <li key={`${bar.id}-${index}`} className="text-sm text-muted truncate">
            <span className="text-accent tabular-nums mr-2">{index + 1}</span>
            {bar.name}
          </li>
        ))}
      </ol>
    </article>
  );
}

function initialsFor(source: string): string {
  const words = source.replace(/^@/, '').trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return (words[0] ?? '?').slice(0, 2).toUpperCase();
}

/** Night keys are `YYYY-MM-DD` NYC night dates — parse as UTC so the label
 *  never slides a day on a machine east or west of New York. */
function nightDate(nightKey: string): Date {
  const [y, m, d] = nightKey.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function weekdayOf(nightKey: string): string {
  return nightDate(nightKey).toLocaleDateString('en-US', {
    weekday: 'long',
    timeZone: 'UTC',
  });
}

function formatNightDate(nightKey: string): string {
  return nightDate(nightKey).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

function GearIcon(): JSX.Element {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="w-5 h-5"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1.08-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1.08 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}
