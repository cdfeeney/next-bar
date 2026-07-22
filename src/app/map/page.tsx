'use client';

import dynamic from 'next/dynamic';
import { useMemo } from 'react';
import { bars } from '@/lib/bars';
import { useRatings } from '@/hooks/useRatings';
import { NEIGHBORHOOD_CENTROIDS } from '@/lib/constants';

const BarMap = dynamic(() => import('@/components/BarMap'), { ssr: false });

export default function MapPage(): JSX.Element {
  const { ratings } = useRatings();

  const highlightIds = useMemo(
    () =>
      ratings
        .filter((r) => r.rating === 'loved' || r.rating === 'liked')
        .map((r) => r.barId),
    [ratings],
  );

  return (
    <main className="min-h-screen">
      <header className="px-6 pt-8 pb-4 text-center">
        <p className="text-accent uppercase tracking-[0.25em] text-xs mb-3">
          Manhattan + Brooklyn
        </p>
        <h1 className="font-display text-3xl md:text-4xl mb-2">Map</h1>
        <p className="text-muted text-sm max-w-md mx-auto">
          Every curated bar, plotted. Bars you&apos;ve Loved or Liked
          glow in accent.
        </p>
      </header>

      <section className="px-0 md:px-6">
        <BarMap bars={bars} highlightIds={highlightIds} fitToBars />
      </section>

      <p className="text-muted text-xs text-center mt-6 pb-24">
        {bars.length} bars across {Object.keys(NEIGHBORHOOD_CENTROIDS).length} neighborhoods
      </p>
    </main>
  );
}
