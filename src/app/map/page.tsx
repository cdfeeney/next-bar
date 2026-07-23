'use client';

import dynamic from 'next/dynamic';
import { useMemo } from 'react';
import { bars } from '@/lib/bars';
import { useRatings } from '@/hooks/useRatings';
import { useGeolocation } from '@/hooks/useGeolocation';
import { NEIGHBORHOOD_CENTROIDS } from '@/lib/constants';

const BarMap = dynamic(() => import('@/components/BarMap'), { ssr: false });

export default function MapPage(): JSX.Element {
  const { ratings } = useRatings();
  const { state, request, coords } = useGeolocation();

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
          Every curated bar, plotted. Bars you&apos;ve Loved or Liked
          glow in accent. Drag with one finger; pinch to zoom.
        </p>

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
          {locationFailed && (
            <p className="text-muted text-xs" role="status">
              {state.status === 'denied'
                ? "Location's off — the map still shows every bar."
                : "Your browser doesn't share location — the map still shows every bar."}
            </p>
          )}
        </div>
      </header>

      <section className="px-0 md:px-6">
        <BarMap
          bars={bars}
          userCoords={coords}
          highlightIds={highlightIds}
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
