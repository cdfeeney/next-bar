'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useBars } from '@/lib/useBars';
import { useRatings } from '@/hooks/useRatings';
import { useGeolocation } from '@/hooks/useGeolocation';
import LocationAccessHelp from '@/components/LocationAccessHelp';
import { useSuggestions } from '@/hooks/useSuggestions';
import { stableSuggestions, suggestedCount } from '@/lib/suggestedTier';
import { displayHood } from '@/lib/hoodDisplay';
import { displayTag } from '@/lib/tagDisplay';
import { NEIGHBORHOOD_CENTROIDS } from '@/lib/constants';
import MapFilterSheet from '@/components/MapFilterSheet';
import BarLightbox from '@/components/BarLightbox';
import type { Bar } from '@/types';
import {
  EMPTY_FILTERS,
  countActiveFilters,
  filterBars,
  type FindBarFilters,
} from '@/lib/findBarFilters';

const BarMap = dynamic(() => import('@/components/BarMap'), { ssr: false });

/** Legend swatches mirror the BarMap tier icons (same accent/grey). */
const LEGEND_SWATCH = {
  suggested: {
    width: 14,
    height: 14,
    background: '#ff5b3a',
    borderRadius: 9999,
    boxShadow: '0 0 8px rgba(255,91,58,0.9)',
  },
  rated: {
    width: 12,
    height: 12,
    background: 'transparent',
    border: '2px solid #ff5b3a',
    borderRadius: 9999,
  },
  other: {
    width: 8,
    height: 8,
    background: '#9ca3af',
    opacity: 0.6,
    borderRadius: 9999,
  },
} as const;

export default function MapPage(): JSX.Element {
  const bars = useBars();
  const { ratings } = useRatings();
  const { state, request, coords } = useGeolocation();

  // UX-C: the search that never shipped — matching a bar pans/zooms the
  // map to it and opens its popup.
  const [query, setQuery] = useState('');
  // Nonce per selection (review MED): re-picking the SAME bar after
  // panning away must re-fly — a bare id state bails on same-value sets.
  const [focus, setFocus] = useState<{ id: string; nonce: number } | null>(null);
  // The bar whose detail overlay is open. Null = closed.
  const [selectedBar, setSelectedBar] = useState<Bar | null>(null);

  // QA2 "Find Bar": optional chips narrow which bars render on the map.
  // Pure logic lives in lib/findBarFilters (unit-tested); this page only
  // holds the selection state.
  const [filters, setFilters] = useState<FindBarFilters>(EMPTY_FILTERS);
  // M1: collapsed by DEFAULT. The point of the change is that the rails are not
  // the first thing you see.
  const [filtersOpen, setFiltersOpen] = useState(false);

  // Count and summarize only what is actually filtering. A radius applied while
  // located survives in `filters` after location is lost, but `filterBars`
  // no-ops it without coords — so counting it would tell the user a filter is on
  // while the map shows every bar, and the collapsed row is exactly where that
  // lie is hardest to notice.
  //
  // Composed from countActiveFilters rather than re-summing the fields by hand.
  // Hand-rolling it worked and was still wrong: it created a second copy of the
  // counting rule that the type system cannot keep in sync, so a new dimension
  // on FindBarFilters would be counted by the sheet's badge and silently ignored
  // by this one. Same shape as MapFilterSheet's `effectiveDraft`.
  const effectiveFilters = coords ? filters : { ...filters, radius: null };
  const activeFilterCount = countActiveFilters(effectiveFilters);
  const radiusActive = effectiveFilters.radius?.maxMiles != null;
  // What the collapsed row says, so closing the panel never hides what it does.
  const filterSummary = useMemo(() => {
    const parts = [
      ...filters.neighborhoods.map(displayHood),
      ...filters.vibes.map(displayTag),
    ];
    if (radiusActive) parts.push('nearby');
    return parts.join(' · ');
  }, [filters, radiusActive]);

  const q = query.trim().toLowerCase();

  // Filters narrow which bars render; search finds among the rendered set
  // so a picked match always has a marker to fly to.
  const filteredBars = useMemo(
    () => filterBars(bars, filters, coords),
    [bars, filters, coords],
  );

  const searchMatches = useMemo(() => {
    if (q.length < 2) return [];
    return filteredBars
      .filter(
        (b) =>
          b.name.toLowerCase().includes(q) ||
          b.neighborhood.toLowerCase().includes(q),
      )
      .slice(0, 5);
  }, [filteredBars, q]);

  // PROMINENCE FROM THE ACTIVE MAP INTENT (goal g-44007df6, criterion 3).
  //
  // This used to rank the WHOLE catalog against the saved quiz profile, so the
  // glowing markers answered "what you said in a quiz once" while the user was
  // looking at filters they had just set. The two disagreed, and the map looked
  // broken. Now it ranks the FILTERED cohort by what is currently selected.
  //
  // Two things follow from ranking a filtered set, and both matter:
  //  - pass `filteredBars`, not the catalog — otherwise we score bars the user
  //    cannot see and the cohort-relative cut below uses the wrong denominator;
  //  - ask for `suggestedCount(cohort)` rather than a fixed 10, or a filter that
  //    leaves 8 bars would mark all 8 "suggested" and the tier would convey
  //    nothing exactly when the user had narrowed hardest.
  const suggestedBudget = suggestedCount(filteredBars.length);
  const hasIntent = filters.vibes.length > 0;
  // Rank the WHOLE eligible cohort, not just `suggestedBudget` of it. Asking
  // for exactly the budget made the stabilisation below a near no-op: a bar
  // that was highlighted, is still eligible, but now ranks just below the
  // cutoff would be absent from `rankedIds` entirely, so there was nothing to
  // preserve and the highlights swapped anyway — the precise case
  // stableSuggestions exists to prevent. The budget is applied AFTER stability,
  // not before it. No extra cost: this ranked the full catalog before the
  // filtered-cohort change, so a cohort is strictly less work.
  const { suggestedIds: rankedIds, hasProfile, profileChecked } = useSuggestions(
    coords,
    filteredBars.length,
    hasIntent ? { tags: filters.vibes, bars: filteredBars } : { bars: filteredBars },
  );

  // STABILITY. Ranking inside the filtered cohort fixed relevance but broke
  // something the old whole-catalog ranking got right for free: because the
  // ranker re-solves against whatever the filter left, two adjacent filter
  // states could swap most of the glowing pins. Narrowing by one axis could
  // take ten highlights down to two that were not even among the previous ten —
  // the map appeared to jump for an action that should only remove bars.
  // Prefer survivors, top up from the new ranking. See lib/suggestedTier.
  const previousRef = useRef<string[]>([]);
  const suggestedIds = useMemo(
    () => stableSuggestions(previousRef.current, rankedIds, suggestedBudget),
    [rankedIds, suggestedBudget],
  );
  // The ref write lives in an EFFECT, not in the memo factory. Writing it
  // during render was benign only while the result did not really depend on
  // `previous`; now that it does, a render that is discarded (StrictMode
  // double-invoke today, a Suspense retry or concurrent re-render later) would
  // leave behind a mutation from a render the user never saw, silently
  // corrupting the next comparison. Post-commit means it only records what was
  // actually shown.
  useEffect(() => {
    previousRef.current = suggestedIds;
  }, [suggestedIds]);

  const highlightIds = useMemo(
    () =>
      ratings
        .filter((r) => r.rating === 'loved' || r.rating === 'liked')
        .map((r) => r.barId),
    [ratings],
  );

  const isLocating = state.status === 'requesting';
  const locationFailed =
    state.status === 'denied' || state.status === 'unavailable';
  // Geolocation succeeded but was too rough to pin (common for desktop/IP
  // fixes, or anyone outside the curated area). coords is null here, so it
  // must be handled explicitly — otherwise the button silently no-ops.
  const locationImprecise = state.status === 'granted_coarse';

  return (
    <main className="min-h-screen">
      {/* UX-C: minimum words — the legend explains the dots, nothing else
          needs prose. */}
      <header className="px-6 pt-8 pb-4 text-center">
        <h1 className="font-display text-3xl md:text-4xl mb-2">Find Bar</h1>

        <div
          className="mt-4 flex items-center justify-center gap-4 text-xs text-muted"
          data-testid="map-legend"
        >
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden style={LEGEND_SWATCH.suggested} />
            Suggested
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden style={LEGEND_SWATCH.rated} />
            Rated
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden style={LEGEND_SWATCH.other} />
            Bar
          </span>
        </div>

        {/*
          The quiz link needs a real 44px box (an inline <a> here was 17px tall,
          and a ::after hit-area trick would not satisfy mobile-controls.spec.ts,
          which measures getBoundingClientRect). But a 44px inline-flex box must
          NOT share a line with 12px prose: the line box grows to 44px and the
          trailing words then float with a large gap against neighbouring lines —
          roughly 3.7x the surrounding line height. So the prose and the link are
          separate blocks and the link is the SOLE content of its own <p>,
          matching the "Discover →" treatment further down this page. The testid
          stays on the wrapper; map-interaction.spec.ts only requires it to
          contain the quiz link.
        */}
        {profileChecked && !hasProfile && (
          <div className="mt-3 text-xs text-muted" data-testid="map-quiz-hint">
            <p>Want sharper picks?</p>
            <p>
              <Link
                href="/quiz"
                className="text-accent underline-offset-4 hover:underline inline-flex items-center min-h-[44px] touch-manipulation"
              >
                Take the quiz →
              </Link>
            </p>
          </div>
        )}

        {/* Search — pick a match and the map flies there. */}
        <div className="mt-4 max-w-sm mx-auto text-left">
          <label htmlFor="map-search" className="sr-only">
            Search bars
          </label>
          <input
            id="map-search"
            type="search"
            inputMode="text"
            autoComplete="off"
            placeholder="Search bars…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full bg-surface border border-border rounded-2xl px-4 py-3 text-base text-text placeholder:text-muted focus:outline-none focus:border-accent min-h-[44px]"
          />
          {searchMatches.length > 0 ? (
            <ul
              aria-label="Matching bars"
              className="mt-2 bg-surface border border-border rounded-2xl overflow-hidden divide-y divide-border"
            >
              {searchMatches.map((b) => (
                <li key={b.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setFocus({ id: b.id, nonce: Date.now() });
                      setQuery('');
                    }}
                    className="w-full text-left px-4 py-3 min-h-[44px] touch-manipulation hover:bg-bg transition-colors"
                  >
                    <span className="font-display text-sm">{b.name}</span>
                    <span className="text-muted text-xs ml-2">
                      {b.neighborhood}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {/*
            The "Discover →" link stood here until goal g-12d33864. /discover is
            archived for the current product and now redirects to /map, so a link
            pointing at it would be a round trip back to the page you are on.
            Git history is the archive; see src/app/discover/page.tsx.
          */}
        </div>

        <div className="mt-4 flex flex-col items-center gap-2">
          <button
            type="button"
            onClick={request}
            disabled={isLocating}
            aria-disabled={isLocating}
            className="bg-accent text-bg font-display text-base px-5 py-2.5 rounded-full min-h-[44px] touch-manipulation disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {isLocating ? 'Locating…' : coords ? 'Update my location' : 'Use my location'}
          </button>
          {coords && (
            <p className="text-muted text-xs" role="status">
              Showing your location on the map.
            </p>
          )}
          {locationImprecise && (
            <p className="text-muted text-xs" role="status">
              Your location&apos;s too rough to pin exactly — the map still
              shows every bar.
            </p>
          )}
          {locationFailed &&
            (state.status === 'denied' ? (
              <div className="max-w-md mx-auto text-left">
                <LocationAccessHelp onRetry={request} />
              </div>
            ) : (
              <p className="text-muted text-xs" role="status">
                Your browser doesn&apos;t share location — the map still
                shows every bar.
              </p>
            ))}
        </div>

        {/*
          "Tweak the vibe" opens MapFilterSheet — the SHARED six-axis accordion
          (goal g-12d33864), not the old FindBarFilterChips rails.

          History worth keeping, because it is the mistake this replaces: M1
          (goal g-44007df6) collapsed the always-on rails behind this same
          button. The operator rejected that — "do not merely hide the same
          rails behind a button" — because a wall of 33 flat chips is still a
          wall of chips once you open the lid, and Club / Dancing / House were
          buried in a horizontal scroll rather than being obvious, independently
          selectable picks in their own axes. The control itself had to change.

          Collapsed state still SUMMARISES the applied selection, so closing the
          panel never hides what it is doing — the count and the picks both stay
          visible without opening anything.
        */}
        <div className="mt-4 max-w-sm mx-auto text-left">
          <button
            type="button"
            aria-expanded={filtersOpen}
            aria-controls="map-filters"
            onClick={() => setFiltersOpen((open) => !open)}
            className="w-full min-h-[44px] touch-manipulation flex items-center justify-between gap-3 px-4 py-3 rounded-2xl bg-surface border border-border"
          >
            <span className="font-display text-base inline-flex items-center gap-2">
              Tweak the vibe
              {/* The COUNT, not just the summary. The summary truncates on a
                  narrow screen, so without a numeral the collapsed row cannot
                  tell you how many filters are on — which is the one thing you
                  need to know before deciding whether to open it. */}
              {activeFilterCount > 0 ? (
                <span
                  data-testid="collapsed-filter-count"
                  className="min-w-[20px] h-5 px-1.5 rounded-full bg-accent text-bg text-[11px] leading-5 font-display text-center"
                >
                  {activeFilterCount}
                </span>
              ) : null}
            </span>
            <span className="text-muted text-xs truncate max-w-[50%] text-right">
              {activeFilterCount > 0 ? filterSummary : 'Anything'}
            </span>
          </button>
          {filtersOpen ? (
            <div id="map-filters">
              {/*
                Unmounted on close, which is what makes the draft seeding in
                MapFilterSheet correct: every reopen re-seeds from the applied
                filters, so a cancelled edit cannot leak into the next opening.
              */}
              <MapFilterSheet
                filters={filters}
                hasLocation={coords !== null}
                onApply={(next) => {
                  setFilters(next);
                  setFiltersOpen(false);
                }}
                onCancel={() => setFiltersOpen(false)}
              />
            </div>
          ) : null}
        </div>
      </header>

      {/* Exact-filter recovery (goal g-6cc99120): when the ACTIVE filter
          combination has no exact intersection, say so honestly and offer a
          way forward — never silently weaken the request (filterBars stays a
          strict AND; the no-weakening invariant is test-pinned). "Adjust"
          reopens the sheet, which re-seeds from the APPLIED filters, so the
          user's selections survive; "Clear" is the explicit reset. */}
      {activeFilterCount > 0 && filteredBars.length === 0 ? (
        <div
          role="status"
          data-testid="exact-filter-empty"
          className="max-w-sm mx-auto mt-4 mb-2 px-4"
        >
          <div className="bg-surface border border-border rounded-2xl p-4 text-center flex flex-col gap-3">
            <p className="text-sm">
              No bar matches{' '}
              <span className="font-display text-accent">{filterSummary}</span>{' '}
              exactly.
            </p>
            <p className="text-xs text-muted">
              Your filters are unchanged — nothing was widened behind your
              back. Loosen one, or start over.
            </p>
            <div className="flex items-center justify-center gap-3">
              <button
                type="button"
                onClick={() => setFiltersOpen(true)}
                className="min-h-[44px] touch-manipulation px-4 rounded-full bg-accent text-bg font-display text-sm"
              >
                Adjust filters
              </button>
              <button
                type="button"
                onClick={() => setFilters(EMPTY_FILTERS)}
                className="min-h-[44px] touch-manipulation px-4 rounded-full border border-border font-display text-sm hover:border-accent transition-colors"
              >
                Clear filters
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <section className="px-0 md:px-6">
        <BarMap
          bars={filteredBars}
          userCoords={coords}
          panToUser
          focusBarId={focus?.id ?? null}
          focusNonce={focus?.nonce}
          highlightIds={highlightIds}
          // Always defined on /map → tiered rendering. Empty (no quiz
          // profile) means no suggested tier: grey dots + rated rings only.
          suggestedIds={suggestedIds}
          // Tapping a marker opens the full venue detail (goal g-5ead112c).
          onSelectBar={setSelectedBar}
          fitToBars
          oneFingerPan
        />
        {/*
          Reuse of the EXISTING BarLightbox, deliberately not a second detail
          surface. It already renders approved cached/local photos through the
          one media policy, open status, the full weekly hours table with its
          provenance note, address, description, and both the Maps and Rank-it
          actions — plus dialog semantics, Escape/backdrop close, a focus trap
          and focus return. Building a map-specific variant would have forked
          all of that, and the Google-media kill switch with it.
        */}
        {selectedBar ? (
          <BarLightbox bar={selectedBar} onClose={() => setSelectedBar(null)} />
        ) : null}
      </section>

      <p className="text-muted text-xs text-center mt-6 pb-24">
        {activeFilterCount > 0
          ? `${filteredBars.length} of ${bars.length} bars match your filters`
          : `${bars.length} bars across ${Object.keys(NEIGHBORHOOD_CENTROIDS).length} neighborhoods`}
      </p>
    </main>
  );
}
