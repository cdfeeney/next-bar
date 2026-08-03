'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import BarVisualTile from '@/components/BarVisualTile';
import { RatingBadgeView } from '@/components/RatingBadge';
import ShareNightButton from '@/components/ShareNightButton';
import type { Rating } from '@/types/ratings';
import { useAuth } from '@/hooks/useAuth';
import { useBars } from '@/lib/useBars';
import { composeRecap, type Recap } from '@/lib/recap';
import {
  NIGHT_ARCHIVE_STORAGE_KEY,
  listArchivedNights,
} from '@/lib/nightArchive';
import {
  NIGHT_LOG_STORAGE_KEY,
  loadCurrentLog,
  nightRatings,
} from '@/lib/nightLog';
import { RATINGS_STORAGE_KEY } from '@/lib/ratings';
import { PROFILE_KEY } from '@/lib/storedProfile';
import {
  SHARED_NIGHTS_STORAGE_KEY,
  forgetSharedNight,
  listSharedNights,
} from '@/lib/sharedNightsLocal';
import { getCacheEpoch } from '@/lib/accountCache';
import { unshareNight } from '@/lib/nights.server';
import { getBrowserSupabase } from '@/lib/supabase/client';

const BarMap = dynamic(() => import('@/components/BarMap'), { ssr: false });

/**
 * /nights — the Nights Out history surface (goal g-919dae84, acceptance
 * 3/4/5/6/7). Every night the app captured — the live log's night plus the
 * archive that rollovers now feed — rendered newest-first, each expandable
 * to its route, its map (the RecapCard treatment), and the share controls.
 *
 * Sharing here is what makes next-day sharing DISCOVERABLE (crit 7): the
 * recap card only exists during the morning-after phase window, but a
 * night on this page can be shared (or unshared) whenever.
 *
 * Hydration rule (santa: Claude + Codex convergent, bf5d7f4f panel): rows
 * start EMPTY and populate in an effect — SSR has no storage, so reading
 * localStorage during render would hydrate "No nights yet." into a
 * populated list and throw a mismatch (same pattern as src/app/page.tsx).
 *
 * A night whose bars have ALL left the catalog cannot compose a recap —
 * but if it was SHARED it still gets a row (date + explanation + Stop
 * sharing), or the owner could never revoke the public page (santa:
 * Claude HIGH, bf5d7f4f panel).
 *
 * Nav decision, recorded: /nights gets NO bottom-nav tab — it's reached
 * from Friends ("Nights Out") and the recap card, and the standard 5-tab
 * nav still renders on it (only /install, /join, /api hide the nav).
 *
 * Device-local honesty: visits never leave this device unless a night is
 * explicitly shared, and the footer says so.
 */

/** '2026-07-25' → 'Friday, July 25' — calendar parts, timezone-proof
 *  (same rule as the shared-night page's label). */
function nightDateLabel(nightKey: string): string {
  const [y, m, d] = nightKey.split('-').map(Number);
  if (!y || !m || !d) return nightKey;
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

type NightRow = {
  nightKey: string;
  /** null = the night's bars all left the catalog (row exists only
   *  because it is still shared and must stay manageable). */
  recap: Recap | null;
  sharedToken: string | null;
  /** Per-bar tier from the ROW'S OWN ratings (archived snapshot, or the
   *  live join for the current night) — badges must not contradict the
   *  snapshot by reading mutable live ratings (santa verifier). */
  tierByBar: Record<string, Rating>;
};

export default function NightsPage(): JSX.Element {
  const bars = useBars();
  const auth = useAuth();
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  // Rows populate POST-MOUNT (hydration rule above); readEpoch is bumped
  // by storage events so they re-derive.
  const [rows, setRows] = useState<NightRow[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [readEpoch, setReadEpoch] = useState(0);
  // Busy is keyed PER NIGHT (santa: Opus, g-919 round 1): one shared slot
  // let a tap on row B re-enable row A's button while A's unshare was
  // still in flight — a second tap then fired a duplicate RPC.
  const [unshareBusy, setUnshareBusy] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [unshareError, setUnshareError] = useState<string | null>(null);

  useEffect(() => {
    const onStorage = (e: StorageEvent): void => {
      if (
        e.key === NIGHT_ARCHIVE_STORAGE_KEY ||
        e.key === NIGHT_LOG_STORAGE_KEY ||
        e.key === SHARED_NIGHTS_STORAGE_KEY ||
        // Ratings drive loved/badges on every row (santa: Claude+Codex).
        e.key === RATINGS_STORAGE_KEY ||
        // The account-cache wipe announces itself via the profile key —
        // shared-night tokens vanish in the same wipe.
        e.key === PROFILE_KEY ||
        e.key === null
      ) {
        setReadEpoch((n) => n + 1);
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  useEffect(() => {
    const live = loadCurrentLog();
    const archived = listArchivedNights().filter(
      (n) => n.nightKey !== live?.nightKey,
    );
    const records = [
      ...(live
        ? [
            {
              nightKey: live.nightKey,
              visits: live.visits,
              // The LIVE night keeps joining live ratings — it's still
              // in motion; archived nights use their rollover snapshot.
              ratings: nightRatings(live.nightKey),
            },
          ]
        : []),
      ...archived.map((n) => ({
        nightKey: n.nightKey,
        visits: n.visits,
        ratings: n.ratings ?? nightRatings(n.nightKey),
      })),
    ];
    const composed = new Map<string, Recap | null>();
    const tiers = new Map<string, Record<string, Rating>>();
    for (const record of records) {
      composed.set(record.nightKey, composeRecap(record, bars));
      tiers.set(
        record.nightKey,
        Object.fromEntries(record.ratings.map((r) => [r.barId, r.rating])),
      );
    }
    const shared = listSharedNights();
    // A shared night with no composable record still needs a row — but
    // ONLY signed-in (santa verifier): the token store is this account's
    // residue, and a recap-less row is pure share management, dead weight
    // for anyone who can't press its one button.
    if (auth.status === 'signed-in') {
      for (const nightKey of Object.keys(shared)) {
        if (!composed.has(nightKey)) composed.set(nightKey, null);
      }
    }
    const next: NightRow[] = Array.from(composed.entries())
      // Recap-less rows earn their place only by being shared (manageable);
      // an unshared night with no surviving bars has nothing to show.
      .filter(([nightKey, recap]) => recap !== null || shared[nightKey])
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([nightKey, recap]) => ({
        nightKey,
        recap,
        sharedToken: shared[nightKey] ?? null,
        tierByBar: tiers.get(nightKey) ?? {},
      }));
    setRows(next);
    setHydrated(true);
  }, [bars, readEpoch, auth.status]);

  const handleUnshare = useCallback(async (nightKey: string) => {
    setUnshareError(null);
    setUnshareBusy((prev) => new Set(prev).add(nightKey));
    try {
      const supabase = getBrowserSupabase();
      if (!supabase) {
        setUnshareError(nightKey);
        return;
      }
      // Epoch guard (santa: Codex): an unshare resolving after a sign-out
      // wipe must not touch the NEXT account's records.
      const epochBefore = getCacheEpoch();
      const ok = await unshareNight(supabase, nightKey);
      if (!ok) {
        setUnshareError(nightKey);
        return;
      }
      if (getCacheEpoch() === epochBefore) forgetSharedNight(nightKey);
      setReadEpoch((n) => n + 1);
    } finally {
      setUnshareBusy((prev) => {
        const next = new Set(prev);
        next.delete(nightKey);
        return next;
      });
    }
  }, []);

  return (
    <main className="min-h-screen pb-28" data-testid="nights-history">
      <header className="px-6 pt-8 pb-4">
        <h1 className="font-display text-3xl md:text-4xl">Nights Out</h1>
        <p className="text-muted text-sm mt-1">
          Every night the app logged, newest first.
        </p>
      </header>

      {rows.length === 0 ? (
        // Until the post-mount read runs this is also the SSR/hydration
        // frame — identical markup, so no mismatch (hydrated only gates
        // the copy swap below, never the structure).
        <section className="flex flex-col items-center justify-center text-center px-6 py-[100px]">
          <h2 className="font-display text-2xl mb-2">
            {hydrated ? 'No nights yet.' : 'Loading your nights…'}
          </h2>
          <p className="text-muted text-sm mb-6 max-w-sm">
            Pick &ldquo;I&apos;m at this bar&rdquo; during a night out and the
            night writes itself — stops, ratings, the map.
          </p>
          <Link
            href="/"
            className="bg-accent text-bg rounded-full px-6 py-3 min-h-[56px] touch-manipulation font-display inline-flex items-center justify-center"
          >
            Find your next bar →
          </Link>
        </section>
      ) : (
        <section className="max-w-md mx-auto px-6 flex flex-col gap-4">
          {rows.map(({ nightKey, recap, sharedToken, tierByBar }) => {
            const expanded = expandedKey === nightKey;
            const stops = recap?.bars.length ?? 0;
            return (
              <article
                key={nightKey}
                data-testid={`night-row-${nightKey}`}
                className="bg-surface border border-border rounded-3xl overflow-hidden"
              >
                <button
                  type="button"
                  aria-expanded={expanded}
                  onClick={() => setExpandedKey(expanded ? null : nightKey)}
                  className="w-full text-left p-5 min-h-[44px] touch-manipulation"
                >
                  <span className="flex items-baseline justify-between gap-3">
                    <span className="font-display text-lg leading-tight">
                      {nightDateLabel(nightKey)}
                    </span>
                    <span aria-hidden="true" className="text-muted text-sm">
                      {expanded ? '▴' : '▾'}
                    </span>
                  </span>
                  <span className="block text-muted text-xs mt-1">
                    {recap
                      ? `${stops === 1 ? 'One stop' : `${stops} stops`}${
                          recap.loved ? ` · loved ${recap.loved.name}` : ''
                        }`
                      : 'Bars no longer in the catalog'}
                    {sharedToken ? ' · Shared' : ''}
                  </span>
                </button>

                {expanded ? (
                  <div className="px-5 pb-5">
                    {recap ? (
                      <>
                        <ol className="flex flex-col gap-3 pb-4">
                          {recap.bars.map((bar, i) => (
                            <li
                              key={`${bar.id}-${i}`}
                              className="flex items-center gap-3"
                            >
                              <span className="text-muted text-xs font-display w-4 shrink-0">
                                {i + 1}
                              </span>
                              <BarVisualTile bar={bar} size={32} />
                              <span className="flex-1 min-w-0 truncate font-display text-sm">
                                {bar.name}
                                {recap.loved?.id === bar.id ? (
                                  <span
                                    className="text-accent"
                                    aria-hidden="true"
                                  >
                                    {' '}
                                    ♥
                                  </span>
                                ) : null}
                              </span>
                              <RatingBadgeView
                                rating={tierByBar[bar.id] ?? null}
                              />
                            </li>
                          ))}
                        </ol>

                        <div
                          className="h-48 rounded-2xl overflow-hidden"
                          data-testid="night-detail-map"
                        >
                          <BarMap
                            bars={recap.bars}
                            fitToBars
                            highlightIds={recap.loved ? [recap.loved.id] : []}
                          />
                        </div>
                      </>
                    ) : (
                      <p className="text-muted text-sm pb-1">
                        The bars from this night have left the catalog, but
                        the night is still shared — you can stop sharing it
                        below.
                      </p>
                    )}

                    <div className="flex items-center gap-3 flex-wrap pt-4">
                      {/* Signed-in + handle only (self-gating). Re-tapping a
                          shared night re-opens the sheet with the SAME link —
                          share_night keeps the token. */}
                      {recap ? <ShareNightButton recap={recap} /> : null}
                      {sharedToken && auth.status === 'signed-in' ? (
                        <button
                          type="button"
                          disabled={unshareBusy.has(nightKey)}
                          onClick={() => void handleUnshare(nightKey)}
                          className="min-h-[44px] touch-manipulation px-5 rounded-full border border-border text-muted font-display text-sm hover:text-text hover:border-accent transition-colors disabled:opacity-60"
                        >
                          {unshareBusy.has(nightKey)
                            ? 'Stopping…'
                            : 'Stop sharing'}
                        </button>
                      ) : null}
                    </div>
                    {unshareError === nightKey ? (
                      <p className="text-xs text-muted mt-2" role="status">
                        Couldn&apos;t stop sharing — try again in a moment.
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </article>
            );
          })}
        </section>
      )}

      <p className="text-muted text-xs text-center mt-8 px-6">
        Nights stay on this device — sharing one publishes just that night.
      </p>
    </main>
  );
}
