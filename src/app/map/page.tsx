'use client';

import dynamic from 'next/dynamic';
import { useMemo, useState } from 'react';
import { useBars } from '@/lib/useBars';
import { useRatings } from '@/hooks/useRatings';
import { useGeolocation } from '@/hooks/useGeolocation';
import LocationAccessHelp from '@/components/LocationAccessHelp';
import FindBarFilterChips from '@/components/FindBarFilterChips';
import {
  EMPTY_FILTERS,
  countActiveFilters,
  filterBars,
  type FindBarFilters,
} from '@/lib/findBarFilters';

const BarMap = dynamic(() => import('@/components/BarMap'), { ssr: false });

/**
 * Map — free exploration (locked V8 design, `docs/design-reference/approved/
 * next-bar-map-v1.png`).
 *
 * The map IS the page: edge to edge from the status bar to behind the fixed
 * nav, with search, Filters and Locate floating over it. There is deliberately
 * no heading, no quiz prompt, no stacked blocks and no page scroll — this
 * surface previously rendered all four above a boxed map, which is the
 * pre-lock recommendation hierarchy rather than the approved map-first one.
 *
 * Two marker meanings only (reference note 3): Ranked bars carry a quiet coral
 * ring, everything else is a smaller muted dot, plus the blue user dot. The
 * "suggested" tier is intentionally absent — `Next Bar?` owns the guided
 * decision; the map does not recommend (note 5). That is why `suggestedIds` is
 * always the empty array: it selects BarMap's tiered rendering while leaving
 * the suggested tier empty.
 */

/** Legend swatches mirror the BarMap tier icons (same accent/grey). */
const LEGEND_SWATCH = {
  ranked: {
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

/** No suggested tier on this surface — see the note above. */
const NO_SUGGESTED_TIER: string[] = [];

const FLOATING_CONTROL =
  'inline-flex items-center gap-1.5 min-h-[44px] px-4 rounded-full bg-surface/95 backdrop-blur ' +
  'border border-border text-text font-display text-sm touch-manipulation ' +
  'hover:border-accent transition-colors disabled:opacity-60 disabled:cursor-not-allowed';

export default function MapPage(): JSX.Element {
  const bars = useBars();
  const { ratings } = useRatings();
  const { state, request, coords } = useGeolocation();

  const [query, setQuery] = useState('');
  // Nonce per selection (review MED): re-picking the SAME bar after
  // panning away must re-fly — a bare id state bails on same-value sets.
  const [focus, setFocus] = useState<{ id: string; nonce: number } | null>(null);

  // Applied filters drive the map. `draft` is what the sheet is editing:
  // reference note 2 — choices stay a draft until "Show N bars", so the map
  // behind the sheet never twitches while the user is still deciding.
  const [filters, setFilters] = useState<FindBarFilters>(EMPTY_FILTERS);
  const [draft, setDraft] = useState<FindBarFilters>(EMPTY_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const q = query.trim().toLowerCase();

  const filteredBars = useMemo(
    () => filterBars(bars, filters, coords),
    [bars, filters, coords],
  );

  // Only needed for the sheet's "Show N bars" label, so it is computed from the
  // draft rather than the applied set.
  const draftCount = useMemo(
    () => filterBars(bars, draft, coords).length,
    [bars, draft, coords],
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

  // "Ranked" is exactly what the user has scored (Loved/Liked) — the same set
  // the rings represented before, under the label the locked legend uses.
  const rankedIds = useMemo(
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
  const activeFilterCount = countActiveFilters(filters);

  function openFilters(): void {
    setDraft(filters);
    setFiltersOpen(true);
  }

  return (
    // Fixed rather than a tall scrolling main: the map owns the viewport and
    // the page itself must not scroll. html/body keep their own overflow so the
    // shell's one-scroll-owner contract still holds for every other route.
    <main
      data-testid="map-surface"
      className="fixed inset-0 overflow-hidden"
    >
      <div className="absolute inset-0">
        <BarMap
          bars={filteredBars}
          userCoords={coords}
          panToUser
          focusBarId={focus?.id ?? null}
          focusNonce={focus?.nonce}
          highlightIds={rankedIds}
          suggestedIds={NO_SUGGESTED_TIER}
          fitToBars
          oneFingerPan
          fill
        />
      </div>

      {/* Search, Filters and Locate float over the map (reference note 2). */}
      <div className="absolute inset-x-0 top-0 z-[900] px-4 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <label htmlFor="map-search" className="sr-only">
          Search bars
        </label>
        <input
          id="map-search"
          type="search"
          inputMode="text"
          autoComplete="off"
          placeholder="Search bars or neighborhoods"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full bg-surface/95 backdrop-blur border border-border rounded-full px-5 py-3 text-base text-text placeholder:text-muted focus:outline-none focus:border-accent min-h-[44px]"
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

        {/* Wrap, never scroll sideways — criterion 7. */}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={openFilters}
            aria-expanded={filtersOpen}
            aria-haspopup="dialog"
            className={FLOATING_CONTROL}
          >
            Filters
            {activeFilterCount > 0 ? (
              <span className="text-accent">({activeFilterCount})</span>
            ) : null}
          </button>
          <button
            type="button"
            onClick={request}
            disabled={isLocating}
            aria-disabled={isLocating}
            className={FLOATING_CONTROL}
          >
            {isLocating ? 'Locating…' : 'Locate'}
          </button>
        </div>

        {coords && (
          <p className="mt-2 text-muted text-xs" role="status">
            Showing your location on the map.
          </p>
        )}
        {locationImprecise && (
          <p className="mt-2 text-muted text-xs" role="status">
            Your location&apos;s too rough to pin exactly — the map still shows
            every bar.
          </p>
        )}
        {locationFailed &&
          (state.status === 'denied' ? (
            <div className="mt-2">
              <LocationAccessHelp onRetry={request} />
            </div>
          ) : (
            <p className="mt-2 text-muted text-xs" role="status">
              Your browser doesn&apos;t share location — the map still shows
              every bar.
            </p>
          ))}
      </div>

      {/* Two marker meanings, stated where the markers are. Sits above the
          fixed nav's safe area rather than inside a scrolling page. */}
      <div
        data-testid="map-legend"
        className="absolute left-4 bottom-[calc(4.5rem+max(0.5rem,env(safe-area-inset-bottom)))] z-[900] inline-flex items-center gap-3 rounded-full bg-surface/95 backdrop-blur border border-border px-3 py-1.5 text-xs text-muted"
      >
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden style={LEGEND_SWATCH.ranked} />
          Ranked
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden style={LEGEND_SWATCH.other} />
          Other bars
        </span>
      </div>

      {filtersOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Filter bars"
          data-testid="map-filter-sheet"
          // The sheet owns its own scroll. Its parent is the clipped full-bleed
          // map surface, so an expanded vibe panel would otherwise grow past
          // the bottom edge and put its own controls out of reach. Capped well
          // under the viewport so the map stays visible behind it (note 2).
          className="absolute inset-x-0 bottom-0 z-[1100] max-h-[70vh] overflow-y-auto overscroll-contain rounded-t-3xl bg-bg border-t border-border px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
        >
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-display text-base">Filters</h2>
            <button
              type="button"
              onClick={() => setFiltersOpen(false)}
              className="min-h-[44px] px-3 text-muted text-sm touch-manipulation hover:text-text"
            >
              Cancel
            </button>
          </div>

          {/* Edits land in `draft`, never in `filters`: the chips' own Apply
              commits the vibe panel INTO the draft, and only "Show N bars"
              below commits the draft to the map. One Clear, one apply. */}
          <FindBarFilterChips filters={draft} onChange={setDraft} />

          <button
            type="button"
            onClick={() => {
              setFilters(draft);
              setFiltersOpen(false);
            }}
            className="mt-3 w-full min-h-[44px] px-4 rounded-full bg-accent text-bg font-display text-sm touch-manipulation"
          >
            Show {draftCount} {draftCount === 1 ? 'bar' : 'bars'}
          </button>
        </div>
      ) : null}
    </main>
  );
}
