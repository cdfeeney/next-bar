'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRatings } from '@/hooks/useRatings';
import { useAuth } from '@/hooks/useAuth';
import { sortRatingsByTierThenRecency } from '@/lib/ratings';
import { bars } from '@/lib/bars';
import type { Bar } from '@/types';
import type { BarRating, Rating } from '@/types/ratings';

type FilterValue = 'all' | Rating;

const FILTER_OPTIONS: ReadonlyArray<{ value: FilterValue; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'loved', label: 'Loved' },
  { value: 'liked', label: 'Liked' },
  { value: 'pass', label: 'Pass' },
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

function findBarById(id: string): Bar | undefined {
  return bars.find((b) => b.id === id);
}

type RatedEntry = {
  rating: BarRating;
  bar: Bar;
};

export default function RankingsPage(): JSX.Element {
  const { ratings } = useRatings();
  const auth = useAuth();
  const [filter, setFilter] = useState<FilterValue>('all');

  const sortedEntries: RatedEntry[] = useMemo(() => {
    const sorted = sortRatingsByTierThenRecency(ratings);
    const result: RatedEntry[] = [];
    for (const r of sorted) {
      const bar = findBarById(r.barId);
      if (bar) result.push({ rating: r, bar });
    }
    return result;
  }, [ratings]);

  const visibleEntries = useMemo(() => {
    if (filter === 'all') return sortedEntries;
    return sortedEntries.filter((e) => e.rating.rating === filter);
  }, [sortedEntries, filter]);

  const hasNoRatings = ratings.length === 0;

  return (
    <main className="min-h-screen">
      <header className="px-6 pt-8 pb-2 text-center">
        <p className="text-accent uppercase tracking-[0.25em] text-xs mb-3">
          Your nights, ranked
        </p>
        <h1 className="font-display text-3xl md:text-4xl mb-2">Rankings</h1>
        <p className="text-muted text-sm max-w-md mx-auto">
          Bars you&apos;ve rated, ordered Loved → Liked → Pass. Pairwise
          comparison scoring lands with the native app.
        </p>
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

      {hasNoRatings ? (
        <section className="flex flex-col items-center justify-center text-center px-6 py-[160px]">
          <h2 className="font-display text-2xl mb-2">Nothing here yet.</h2>
          <p className="text-muted text-sm mb-6 max-w-sm">
            Rate a bar after you check it out and it&apos;ll show up here. Your
            rankings stay on this device until the app ships with sync.
          </p>
          <Link
            href="/"
            className="bg-accent text-bg rounded-full px-6 py-3 min-h-[44px] touch-manipulation font-display text-lg inline-flex items-center justify-center"
          >
            Find a bar →
          </Link>
        </section>
      ) : (
        <section className="max-w-2xl mx-auto px-6 flex flex-col gap-4">
          {visibleEntries.length === 0 ? (
            <p className="text-muted text-center">
              No bars rated {filter} yet.
            </p>
          ) : (
            visibleEntries.map(({ rating, bar }, idx) => (
              <article
                key={rating.barId}
                className="bg-surface border border-border rounded-3xl p-5 flex flex-col gap-2"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <h2 className="font-display text-xl leading-tight">
                    <span className="text-accent mr-2 tabular-nums">
                      {idx + 1}.
                    </span>
                    {bar.name}
                  </h2>
                  <span className="text-muted text-xs shrink-0">
                    {'$'.repeat(bar.priceTier)}
                  </span>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-muted text-xs uppercase tracking-wider">
                    {bar.neighborhood}
                  </span>
                  <span
                    className={[
                      'text-xs font-display px-2 py-0.5 rounded-full',
                      RATING_BADGE_CLASSES[rating.rating],
                    ].join(' ')}
                  >
                    {RATING_LABEL[rating.rating]}
                  </span>
                </div>
                <p className="text-sm italic">{bar.blurb}</p>
                <p className="text-xs text-muted pt-1">
                  Rated {formatRatedAt(rating.ratedAt)}
                </p>
              </article>
            ))
          )}
        </section>
      )}

      <p className="text-muted text-xs text-center mt-8 pb-24">
        {auth.status === 'signed-in'
          ? `Synced to ${auth.user.email}`
          : 'Stored on this device · sign in to sync'}
      </p>
    </main>
  );
}
