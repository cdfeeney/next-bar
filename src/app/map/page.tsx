'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useMemo } from 'react';
import { useBars } from '@/lib/useBars';
import { useRatings } from '@/hooks/useRatings';
import { useGeolocation } from '@/hooks/useGeolocation';
import LocationAccessHelp from '@/components/LocationAccessHelp';
import { useSuggestions, MAP_SUGGESTION_COUNT } from '@/hooks/useSuggestions';
import { NEIGHBORHOOD_CENTROIDS } from '@/lib/constants';

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

  // Same matching pipeline as home (profile + ratings + user coords when
  // granted), capped at MAP_SUGGESTION_COUNT for the suggested tier.
  const { suggestedIds, hasProfile, profileChecked } = useSuggestions(
    coords,
    MAP_SUGGESTION_COUNT,
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
      <header className="px-6 pt-8 pb-4 text-center">
        <p className="text-accent uppercase tracking-[0.25em] text-xs mb-3">
          Manhattan + Brooklyn
        </p>
        <h1 className="font-display text-3xl md:text-4xl mb-2">Map</h1>
        <p className="text-muted text-sm max-w-md mx-auto">
          Every curated bar, plotted. Your suggested bars glow in accent;
          bars you&apos;ve rated get a ring. Drag with one finger; pinch to
          zoom.
        </p>

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
            Everything else
          </span>
        </div>

        {profileChecked && !hasProfile && (
          <div
            className="mt-4 mx-auto max-w-sm rounded-2xl border border-border px-4 py-3 text-sm text-muted"
            data-testid="map-quiz-hint"
          >
            No suggestions yet —{' '}
            <Link
              href="/quiz"
              className="text-accent underline-offset-4 hover:underline"
            >
              take the vibe quiz
            </Link>{' '}
            to light up your picks on the map.
          </div>
        )}

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
      </header>

      <section className="px-0 md:px-6">
        <BarMap
          bars={bars}
          userCoords={coords}
          panToUser
          highlightIds={highlightIds}
          // Always defined on /map → tiered rendering. Empty (no quiz
          // profile) means no suggested tier: grey dots + rated rings only.
          suggestedIds={suggestedIds}
          fitToBars
          oneFingerPan
        />
      </section>

      <p className="text-muted text-xs text-center mt-6 pb-24">
        {bars.length} bars across {Object.keys(NEIGHBORHOOD_CENTROIDS).length} neighborhoods
      </p>
    </main>
  );
}
