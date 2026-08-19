'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRatings } from '@/hooks/useRatings';
import { useAuth } from '@/hooks/useAuth';
import { sortRatingsByScore, tierMidpoint } from '@/lib/pairwise';
import { seedSampleNight } from '@/lib/demo';
import { getBarById } from '@/lib/catalog';
import { useBars } from '@/lib/useBars';
import { displayHood } from '@/lib/hoodDisplay';
import QuickAddBar from '@/components/QuickAddBar';
import type { Bar } from '@/types';
import type { BarRating } from '@/types/ratings';

const DATE_FORMATTER = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
});

function formatRatedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return DATE_FORMATTER.format(date);
}

type RatedEntry = {
  rating: BarRating;
  bar: Bar;
};

export default function RankingsPage(): JSX.Element {
  // 0019 swap-day rule: getBarById reader — subscribe for live swaps. The
  // value is USED, not just subscribed to: see `sortedEntries` below.
  const catalog = useBars();
  const { ratings } = useRatings();
  const auth = useAuth();
  // U2-3 deep link (?add=<barId> from "Rank it →" on suggestion cards):
  // read once from location.search on mount — window-only, so no
  // useSearchParams/Suspense prerender dance — then strip the param so a
  // refresh doesn't re-open the tier sheet.
  const [deepLinkBarId, setDeepLinkBarId] = useState<string | undefined>();
  const clearDeepLink = useCallback(() => setDeepLinkBarId(undefined), []);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const add = params.get('add');
    if (!add) return;
    setDeepLinkBarId(add);
    params.delete('add');
    const query = params.toString();
    window.history.replaceState(
      null,
      '',
      `${window.location.pathname}${query ? `?${query}` : ''}`,
    );
  }, []);

  const sortedEntries: RatedEntry[] = useMemo(() => {
    // sortRatingsByScore puts pairwise-scored bars first (score desc), then
    // falls back to tier-then-recency for bars that haven't had a
    // comparison yet (BarRating.score === null/undefined).
    const sorted = sortRatingsByScore(ratings);
    const result: RatedEntry[] = [];
    for (const r of sorted) {
      const bar = getBarById(r.barId);
      if (bar) result.push({ rating: r, bar });
    }
    return result;
    // `catalog` is a dependency because `getBarById` reads the module-level
    // catalog, which CatalogRefresh swaps in AFTER hydration. Subscribing via
    // useBars() re-renders this component, but with `[ratings]` alone the memo
    // did not recompute, so the list stayed frozen against the ~39-bar
    // emergency fallback whenever the swap landed after the ratings hydrate.
    // Every rated bar outside that core — Bar 54 among them, which the V8 PRD
    // names as required retained state — silently vanished from Rankings on a
    // V7→V8 upgrade, purely on load ordering. Browser-dependent, which is why
    // it survived: WebKit happened to swap before the hydrate, Chromium after.
    // Covered by e2e/v7-continuity.spec.ts ("Bar 54 renders by name…").
  }, [ratings, catalog]);

  const hasNoRatings = ratings.length === 0;

  return (
    <main className="min-h-screen">
      <header className="px-6 pt-8 pb-2 text-center">
        <p className="text-accent uppercase tracking-[0.25em] text-xs mb-3">
          Your nights, ranked
        </p>
        <h1 className="font-display text-3xl md:text-4xl mb-2">Bar Rankings</h1>
        <p className="text-muted text-sm max-w-md mx-auto">
          Add a bar and enter your own score from 0 to 10.
        </p>
        <Link
          href="/lists"
          className="text-accent text-sm underline-offset-4 hover:underline min-h-[44px] inline-flex items-center touch-manipulation mt-1"
        >
          Your lists →
        </Link>
        {!hasNoRatings ? (
          // Persistent quick-add entry (B4). The empty state below mounts
          // its own instance — exactly one QuickAddBar renders at a time.
          <div className="mt-3">
            <QuickAddBar initialBarId={deepLinkBarId} onInitialConsumed={clearDeepLink} />
          </div>
        ) : null}
      </header>

      {hasNoRatings ? (
        <section className="flex flex-col items-center justify-center text-center px-6 py-[120px]">
          <h2 className="font-display text-2xl mb-2">Nothing here yet.</h2>
          <p className="text-muted text-sm mb-6 max-w-sm">
            Rate a bar after you check it out and it&apos;ll show up here, scored
            0–10 by your own taste. Your rankings stay on this device until the
            app ships with sync.
          </p>
          <div className="mb-4">
            <QuickAddBar initialBarId={deepLinkBarId} onInitialConsumed={clearDeepLink} />
          </div>
          <Link
            href="/"
            className="bg-accent text-bg rounded-full px-6 py-3 min-h-[44px] touch-manipulation font-display text-lg inline-flex items-center justify-center"
          >
            Find a bar →
          </Link>
          <button
            type="button"
            onClick={() => seedSampleNight()}
            className="mt-4 text-accent text-sm underline-offset-4 hover:underline min-h-[44px] touch-manipulation"
          >
            Or load a sample night to see it in action →
          </button>
        </section>
      ) : (
        <section className="max-w-2xl mx-auto px-6 flex flex-col gap-4">
          {sortedEntries.length === 0 ? (
            <p className="text-muted text-center">No bars ranked yet.</p>
          ) : (
            sortedEntries.map(({ rating, bar }, idx) => {
              const hasScore = typeof rating.score === 'number';
              return (
                <article
                  key={rating.barId}
                  className="rise bg-surface border border-border rounded-3xl p-5 flex flex-col gap-2"
                  style={{ ['--rise-delay' as string]: `${Math.min(idx, 10) * 50}ms` }}
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <h2 className="font-display text-xl leading-tight">
                      <span className="text-accent mr-2 tabular-nums">
                        {idx + 1}.
                      </span>
                      {bar.name}
                    </h2>
                    <div className="flex items-baseline gap-3 shrink-0">
                      {hasScore ? (
                        <span
                          className="font-display text-2xl tabular-nums text-accent"
                          aria-label={`Score ${(rating.score as number).toFixed(1)} out of 10`}
                        >
                          {(rating.score as number).toFixed(1)}
                        </span>
                      ) : (
                        // N6b (operator): EVERY ranked bar shows its number.
                        // No comparisons yet → tentative tier-band midpoint
                        // (what the sort already uses), muted + ~ so it
                        // reads as provisional, firming up via comparisons.
                        <span
                          className="font-display text-2xl tabular-nums text-muted"
                          aria-label={`Legacy estimated score ${tierMidpoint(rating.rating).toFixed(1)} out of 10`}
                        >
                          ~{tierMidpoint(rating.rating).toFixed(1)}
                        </span>
                      )}
                      <span className="text-muted text-xs">
                        {'$'.repeat(bar.priceTier)}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-muted text-xs uppercase tracking-wider">
                      {displayHood(bar.neighborhood)}
                    </span>
                    {!hasScore ? (
                      <span className="text-muted text-xs italic">
                        Add again to set an exact score
                      </span>
                    ) : null}
                  </div>
                  <p className="text-sm italic">{bar.blurb}</p>
                  <p className="text-xs text-muted pt-1">
                    Rated {formatRatedAt(rating.ratedAt)}
                  </p>
                </article>
              );
            })
          )}
        </section>
      )}

      <p className="text-muted text-xs text-center mt-8 pb-24">
        {auth.status === 'signed-in'
          ? 'Synced to your account'
          : 'Stored on this device · sign in to sync'}
      </p>
    </main>
  );
}
