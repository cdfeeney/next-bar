'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRatings } from '@/hooks/useRatings';
import { useAuth } from '@/hooks/useAuth';
import { useWantToGo } from '@/hooks/useWantToGo';
import { sortRatingsByScore, tierMidpoint } from '@/lib/pairwise';
import { seedSampleNight } from '@/lib/demo';
import { getBarById } from '@/lib/catalog';
import { useBars } from '@/lib/useBars';
import { displayHood } from '@/lib/hoodDisplay';
import QuickAddBar from '@/components/QuickAddBar';
import WantToGoList from '@/components/WantToGoList';
import type { Bar } from '@/types';
import type { BarRating, Rating } from '@/types/ratings';

type FilterValue = 'all' | Rating | 'want';

const FILTER_OPTIONS: ReadonlyArray<{ value: FilterValue; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'loved', label: 'Loved' },
  { value: 'liked', label: 'Liked' },
  { value: 'pass', label: 'Pass' },
  // QA5-S2: saved-for-later bars — a LIST view, not a rating tier.
  { value: 'want', label: 'Want to go' },
];

const RATING_LABEL: Record<Rating, string> = {
  loved: 'Loved',
  liked: 'Liked',
  pass: 'Pass',
};

const RATING_BADGE_CLASSES: Record<Rating, string> = {
  loved: 'bg-accent text-bg',
  liked: 'bg-surface border border-accent text-accent',
  pass: 'bg-surface border border-border text-muted',
};

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
  // 0019 swap-day rule: getBarById reader — subscribe for live swaps.
  useBars();
  const { ratings } = useRatings();
  const auth = useAuth();
  const [filter, setFilter] = useState<FilterValue>('all');
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
  }, [ratings]);

  const visibleEntries = useMemo(() => {
    if (filter === 'all' || filter === 'want') return sortedEntries;
    return sortedEntries.filter((e) => e.rating.rating === filter);
  }, [sortedEntries, filter]);

  const hasNoRatings = ratings.length === 0;

  // QA5-S2 "Want to go" list. Rated bars leave the list automatically
  // ("Been — rank it" completes → the bar now lives in the rankings
  // proper): the guard makes the effect terminate — pruneRated rewrites
  // entries, the rerun then finds nothing rated and bails.
  const { entries: wantEntries, remove: removeWant, pruneRated } = useWantToGo();
  const ratedIds = useMemo(
    () => new Set(ratings.map((r) => r.barId)),
    [ratings],
  );
  useEffect(() => {
    if (!wantEntries.some((e) => ratedIds.has(e.barId))) return;
    pruneRated(ratedIds);
  }, [wantEntries, ratedIds, pruneRated]);

  return (
    <main className="min-h-screen">
      <header className="px-6 pt-8 pb-2 text-center">
        <p className="text-accent uppercase tracking-[0.25em] text-xs mb-3">
          Your nights, ranked
        </p>
        <h1 className="font-display text-3xl md:text-4xl mb-2">Rankings</h1>
        <p className="text-muted text-sm max-w-md mx-auto">
          Bars you&apos;ve rated, ordered by your personal 0–10 score.
          A ~score is tentative — it sits at your tier&apos;s midpoint and
          firms up as you answer comparison prompts.
        </p>
        <div className="flex items-center justify-center gap-5">
          <Link
            href="/lists"
            className="text-accent text-sm underline-offset-4 hover:underline min-h-[44px] inline-flex items-center touch-manipulation mt-1"
          >
            Your lists →
          </Link>
          <Link
            href="/search"
            className="text-accent text-sm underline-offset-4 hover:underline min-h-[44px] inline-flex items-center touch-manipulation mt-1"
          >
            Search bars →
          </Link>
        </div>
        {!hasNoRatings ? (
          // Persistent quick-add entry (B4). The empty state below mounts
          // its own instance — exactly one QuickAddBar renders at a time.
          <div className="mt-3">
            <QuickAddBar initialBarId={deepLinkBarId} onInitialConsumed={clearDeepLink} />
          </div>
        ) : null}
      </header>

      <div
        role="group"
        aria-label="Filter by rating"
        className="flex flex-wrap gap-2 justify-center px-6 my-6"
      >
        {FILTER_OPTIONS.map((opt) => {
          const isActive = filter === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              aria-pressed={isActive}
              onClick={() => setFilter(opt.value)}
              className={[
                'min-h-[44px] touch-manipulation px-4 py-2 rounded-full',
                'font-display text-sm border transition-colors',
                isActive
                  ? 'bg-accent text-bg border-accent'
                  : 'bg-surface border-border text-muted hover:text-text',
              ].join(' ')}
            >
              {opt.label}
            </button>
          );
        })}
      </div>

      {filter === 'want' ? (
        // Want-to-go is a list, not a tier — it renders regardless of
        // whether any ratings exist yet.
        <WantToGoList entries={wantEntries} onRemove={removeWant} />
      ) : hasNoRatings ? (
        <section className="flex flex-col items-center justify-center text-center px-6 py-[120px]">
          <h2 className="font-display text-2xl mb-2">Nothing here yet.</h2>
          {/* Auth-aware sync claim (g-65a31bdf crit 11): signed-in ratings DO
              sync — the old unconditional "stay on this device" contradicted
              the signed-in footer below (santa: Sonnet verifier, g-7b6021a8). */}
          <p className="text-muted text-sm mb-6 max-w-sm">
            Rate a bar after you check it out and it&apos;ll show up here, scored
            0–10 by your own taste.{' '}
            {auth.status === 'signed-in'
              ? 'Your ratings sync to your account.'
              : 'Ratings stay on this device — sign in to sync.'}
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
          {visibleEntries.length === 0 ? (
            <p className="text-muted text-center">
              No bars rated {filter} yet.
            </p>
          ) : (
            visibleEntries.map(({ rating, bar }, idx) => {
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
                          aria-label={`Tentative score ${tierMidpoint(rating.rating).toFixed(1)} out of 10 — firms up as you compare`}
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
                    <span
                      className={[
                        'text-xs font-display px-2 py-0.5 rounded-full',
                        RATING_BADGE_CLASSES[rating.rating],
                      ].join(' ')}
                    >
                      {RATING_LABEL[rating.rating]}
                    </span>
                    {!hasScore ? (
                      <span className="text-muted text-xs italic">
                        Rank as you compare
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
        {/* Want-to-go saves are localStorage-only on every auth path — the
            signed-in "Synced" claim is true for RATINGS but was false on this
            tab, contradicting /search's honest device-only disclosure
            (santa: Codex, round 3). */}
        {filter === 'want'
          ? "Want-to-go saves stay on this device — cross-device sync isn't available yet"
          : auth.status === 'signed-in'
            ? 'Synced to your account'
            : 'Stored on this device · sign in to sync'}
      </p>
    </main>
  );
}
