'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useBars } from '@/lib/useBars';
import { useRatings } from '@/hooks/useRatings';
import { useGeolocation } from '@/hooks/useGeolocation';
import LocationAccessHelp from '@/components/LocationAccessHelp';
import { useSuggestions } from '@/hooks/useSuggestions';
import { suggestedCount } from '@/lib/suggestedTier';
import { displayHood } from '@/lib/hoodDisplay';
import { displayTag } from '@/lib/tagDisplay';
import { NEIGHBORHOOD_CENTROIDS } from '@/lib/constants';
import FindBarFilterChips from '@/components/FindBarFilterChips';
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

  // QA2 "Find Bar": optional chips narrow which bars render on the map.
  // Pure logic lives in lib/findBarFilters (unit-tested); this page only
  // holds the selection state.
  const [filters, setFilters] = useState<FindBarFilters>(EMPTY_FILTERS);
  // M1: collapsed by DEFAULT. The point of the change is that the rails are not
  // the first thing you see.
  const [filtersOpen, setFiltersOpen] = useState(false);

  const activeFilterCount = countActiveFilters(filters);
  // What the collapsed row says, so closing the panel never hides what it does.
  const filterSummary = useMemo(() => {
    const parts = [
      ...filters.neighborhoods.map(displayHood),
      ...filters.vibes.map(displayTag),
    ];
    if (filters.radius && filters.radius.maxMiles !== null) parts.push('nearby');
    return parts.join(' · ');
  }, [filters]);

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
  const { suggestedIds, hasProfile, profileChecked } = useSuggestions(
    coords,
    suggestedBudget,
    hasIntent ? { tags: filters.vibes, bars: filteredBars } : { bars: filteredBars },
  );

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
          {/* QA5-S3: idle-time browsing lives on /discover, not here. */}
          <p className="mt-2 text-center">
            <Link
              href="/discover"
              className="inline-flex items-center min-h-[44px] text-accent font-display text-sm touch-manipulation hover:underline underline-offset-4"
            >
              Discover →
            </Link>
          </p>
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
          M1 (goal g-44007df6): the filters were always-on horizontal rails.
          They are now collapsed behind ONE control, per the operator: "header
          becomes Tweak the vibe; the normal filters sit underneath it and are
          collapsed by default — you click into them rather than seeing
          always-on rails."

          Two side effects worth naming: the rails were also what generated 88
          false positives in mobile-controls.spec.ts (a wall of chips is a wall
          of tap targets), and collapsing them gives the map back the vertical
          space the rails were eating on a short viewport.

          Collapsed state still SUMMARISES the active selection, so hiding the
          controls never hides what they are doing — the count and the picks
          both stay visible without opening anything.
        */}
        <div className="mt-4 max-w-sm mx-auto text-left">
          <button
            type="button"
            aria-expanded={filtersOpen}
            aria-controls="map-filters"
            onClick={() => setFiltersOpen((open) => !open)}
            className="w-full min-h-[44px] touch-manipulation flex items-center justify-between gap-3 px-4 py-3 rounded-2xl bg-surface border border-border"
          >
            <span className="font-display text-base">Tweak the vibe</span>
            <span className="text-muted text-xs truncate max-w-[55%] text-right">
              {activeFilterCount > 0 ? filterSummary : 'Anything'}
            </span>
          </button>
          {filtersOpen ? (
            <div id="map-filters">
              <FindBarFilterChips
                filters={filters}
                onChange={setFilters}
                hasLocation={coords !== null}
              />
            </div>
          ) : null}
        </div>
      </header>

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
          fitToBars
          oneFingerPan
        />
      </section>

      <p className="text-muted text-xs text-center mt-6 pb-24">
        {countActiveFilters(filters) > 0
          ? `${filteredBars.length} of ${bars.length} bars match your filters`
          : `${bars.length} bars across ${Object.keys(NEIGHBORHOOD_CENTROIDS).length} neighborhoods`}
      </p>
    </main>
  );
}
