'use client';

import { useMemo } from 'react';
import type {
  AccuracyBand,
  Coords,
  ManhattanNeighborhood,
  VibeProfile,
  VibeTag,
} from '@/types';
import { bars } from '@/lib/bars';
import { matches } from '@/lib/matching';
import { haversineMiles } from '@/lib/distance';
import { NEIGHBORHOOD_CENTROIDS } from '@/lib/constants';
import { useRatings } from '@/hooks/useRatings';
import ResultCard from '@/components/ResultCard';

type ResolvedLocation =
  | { kind: 'coords'; coords: Coords; band: AccuracyBand; snappedTo: ManhattanNeighborhood | null }
  | { kind: 'neighborhood'; neighborhood: ManhattanNeighborhood };

type ResultsViewProps = {
  profile: VibeProfile;
  location: ResolvedLocation;
  maxMiles: number | null;
  excludeIds?: string[];
  maxResults?: number;
};

export default function ResultsView({
  profile,
  location,
  maxMiles,
  excludeIds,
  maxResults,
}: ResultsViewProps) {
  const userCoords: Coords =
    location.kind === 'coords'
      ? location.coords
      : NEIGHBORHOOD_CENTROIDS[location.neighborhood];

  const preferredNeighborhoods =
    location.kind === 'neighborhood'
      ? [location.neighborhood]
      : profile.preferredNeighborhoods;

  const { ratings } = useRatings();

  const effectiveExcludeIds = useMemo(() => {
    const merged = new Set(excludeIds ?? []);
    for (const r of ratings) {
      if (r.rating === 'pass') merged.add(r.barId);
    }
    return Array.from(merged);
  }, [excludeIds, ratings]);

  // Flatten the vibe tags of every bar the user has Loved, so matches() can
  // nudge bars with a similar taste profile up the rank (loved-affinity term).
  const lovedTags = useMemo(() => {
    const lovedBarIds = new Set(
      ratings.filter((r) => r.rating === 'loved').map((r) => r.barId),
    );
    if (lovedBarIds.size === 0) return [] as VibeTag[];
    const tags = new Set<VibeTag>();
    for (const b of bars) {
      if (lovedBarIds.has(b.id)) {
        for (const t of b.tags) tags.add(t);
      }
    }
    return Array.from(tags);
  }, [ratings]);

  const ranked = useMemo(
    () =>
      matches({
        profile,
        coords: userCoords,
        preferredNeighborhoods,
        maxMiles,
        bars,
        excludeIds: effectiveExcludeIds,
        maxResults,
        lovedTags,
      }),
    [profile, userCoords, preferredNeighborhoods, maxMiles, effectiveExcludeIds, maxResults, lovedTags],
  );

  const locationLabel =
    location.kind === 'neighborhood'
      ? `In ${location.neighborhood}`
      : location.snappedTo
      ? `Approximate — based on ${location.snappedTo}`
      : 'Using your location';

  return (
    <section className="px-6 py-8">
      <div className="max-w-2xl mx-auto">
        <p className="text-muted text-sm text-center mb-2">{locationLabel}</p>
        <h2 className="font-display text-3xl md:text-4xl text-center mb-8">
          {ranked.length === 1
            ? 'Your next bar'
            : `Your next ${ranked.length} bars`}
        </h2>

        {ranked.length === 0 ? (
          <p className="text-muted text-center">
            No matches found nearby.
            <br />
            Try a different neighborhood or widen your radius.
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            {ranked.map((bar, idx) => {
              const miles = haversineMiles(userCoords, {
                lat: bar.lat,
                lng: bar.lng,
              });
              return (
                <ResultCard
                  key={bar.id}
                  bar={bar}
                  rank={idx + 1}
                  miles={miles}
                  userTags={profile.tags}
                />
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
