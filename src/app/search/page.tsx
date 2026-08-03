'use client';

import { useEffect, useMemo, useState } from 'react';
import type { Bar } from '@/types';
import { useBars } from '@/lib/useBars';
import { displayHood } from '@/lib/hoodDisplay';
import { MAX_RESULTS, MIN_QUERY_LENGTH, searchCatalog } from '@/lib/searchBars';
import BarLightbox from '@/components/BarLightbox';
import BarVisualTile from '@/components/BarVisualTile';
import { RatingBadgeView } from '@/components/RatingBadge';
import WantToGoToggle from '@/components/WantToGoToggle';
import { useRatings } from '@/hooks/useRatings';

/**
 * /search — find any catalog bar and save it to Want to Go (goal
 * g-7b6021a8). Deliberately a thin composition of existing primitives:
 * searchCatalog (pure lib), WantToGoToggle (the one Want-to-Go writer),
 * BarLightbox (the one bar-detail surface). No new persistence path, no
 * geolocation, no remote calls — typing only filters the local catalog.
 *
 * Sits OUTSIDE the 5-tab bottom nav (CLAUDE.md: new tool routes decide
 * explicitly; the nav stays 5 tabs). Reached from /rankings ("Search
 * bars →") and the Want-to-go empty state. Input is intentionally NOT
 * sticky: a sticky search bar over a scrolled list is exactly the
 * covered-control failure mobile-controls flags on /.
 */
export default function SearchPage(): JSX.Element {
  const bars = useBars();
  // ONE ratings subscription for the whole page. Per-row RatingBadge
  // instances would each run the hydration effect, and a typing-driven
  // mount wave after a settled run refires server hydration for signed-in
  // users — remote calls from typing, which this surface forbids
  // (santa: Codex).
  const { getRating } = useRatings();
  const [query, setQuery] = useState('');
  // ID, not the Bar object: the async catalog swap replaces every bar's
  // object identity, and a captured object would keep an open lightbox on
  // stale data (santa: DeepSeek + Codex, convergent). Deriving from the
  // live array means the dialog tracks the current catalog — and closes
  // itself if the bar vanishes in the swap.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected: Bar | null = useMemo(
    () => (selectedId ? bars.find((b) => b.id === selectedId) ?? null : null),
    [bars, selectedId],
  );

  const { results, total } = useMemo(
    () => searchCatalog(bars, query),
    [bars, query],
  );
  const trimmed = query.trim();
  const searching = trimmed.length >= MIN_QUERY_LENGTH;

  // The debounce applies ONLY to the announcement — visual results stay
  // per-keystroke.
  const liveMessage = searching
    ? results.length === 0
      ? `No bars match ${trimmed}`
      : `${total} bar${total === 1 ? '' : 's'} match`
    : '';
  const [announcement, setAnnouncement] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setAnnouncement(liveMessage), 400);
    return () => clearTimeout(t);
  }, [liveMessage]);

  return (
    <main className="min-h-screen">
      <header className="px-6 pt-8 pb-4 text-center">
        <p className="text-accent uppercase tracking-[0.25em] text-xs mb-3">
          Every bar we know
        </p>
        <h1 className="font-display text-3xl md:text-4xl mb-2">Search bars</h1>
        <p className="text-muted text-sm max-w-md mx-auto">
          Find any bar by name, neighborhood, or vibe and save it to your
          Want-to-go list. Saves stay on this device — cross-device sync
          isn&apos;t available yet.
        </p>
      </header>

      <section className="max-w-2xl mx-auto px-6">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search bars..."
          aria-label="Search bars"
          autoComplete="off"
          className="w-full bg-surface border border-border rounded-2xl px-4 py-3 mb-4 focus:border-accent outline-none text-base"
        />
        {/* Screen-reader announcement of result changes — the visual blocks
            below swap silently otherwise (santa: Claude). Debounced 400ms
            (FindFriends precedent): announcing on every keystroke queues a
            burst of stale counts over the input echo (santa: Claude+GLM
            convergent). */}
        <p role="status" className="sr-only">
          {announcement}
        </p>

        {!searching ? (
          <p data-testid="search-hint" className="text-muted text-sm text-center py-10">
            Type at least {MIN_QUERY_LENGTH} letters — try a bar name, a
            neighborhood like &ldquo;Lower East Side&rdquo;, or a vibe like
            &ldquo;dive&rdquo; or &ldquo;dancing&rdquo;.
          </p>
        ) : results.length === 0 ? (
          <div data-testid="search-no-match" className="text-center py-10">
            <p className="font-display text-xl mb-2">
              No bars match &ldquo;{trimmed}&rdquo;.
            </p>
            <p className="text-muted text-sm mb-6 max-w-sm mx-auto">
              Check the spelling, or try a neighborhood or vibe instead.
            </p>
            <button
              type="button"
              onClick={() => setQuery('')}
              className="min-h-[44px] touch-manipulation px-5 rounded-full border border-border font-display text-sm text-text hover:border-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              Clear search
            </button>
          </div>
        ) : (
          <>
            {total > MAX_RESULTS ? (
              <p className="text-muted text-xs text-center mb-3">
                Showing {MAX_RESULTS} of {total} matches — keep typing to
                narrow it down.
              </p>
            ) : null}
            {/* pb-24 matches the rest of the app's fixed-nav clearance
                convention (rankings/map/settings) on top of the body-level
                safe-area padding (santa: Claude). */}
            <ul data-testid="search-results" className="pb-24">
              {results.map((bar) => (
                <li
                  key={bar.id}
                  className="flex items-center gap-2 border-b border-border"
                >
                  <button
                    type="button"
                    onClick={() => setSelectedId(bar.id)}
                    className="flex-1 min-w-0 min-h-[56px] flex items-center gap-3 px-2 py-3 text-left touch-manipulation hover:bg-surface active:bg-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    <BarVisualTile bar={bar} size={32} />
                    <span className="min-w-0">
                      <span className="font-display flex items-center gap-2">
                        <span className="truncate">{bar.name}</span>
                        <RatingBadgeView rating={getRating(bar.id)} />
                      </span>
                      <span className="block text-muted text-xs uppercase tracking-wider mt-0.5">
                        {displayHood(bar.neighborhood)} · {'$'.repeat(bar.priceTier)}
                      </span>
                    </span>
                  </button>
                  <WantToGoToggle barId={bar.id} barName={bar.name} className="mr-1" />
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      {selected ? (
        <BarLightbox bar={selected} onClose={() => setSelectedId(null)} />
      ) : null}
    </main>
  );
}
