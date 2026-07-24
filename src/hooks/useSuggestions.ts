'use client';

import { useEffect, useMemo, useState } from 'react';
import type { Bar, Coords, VibeProfile, VibeTag } from '@/types';
import type { BarRating } from '@/types/ratings';
import { matches } from '@/lib/matching';
import { loadProfile } from '@/lib/storedProfile';
import { useBars } from '@/lib/useBars';
import { useRatings } from '@/hooks/useRatings';

/** How many bars the map's suggested tier surfaces (blueprint B6). */
export const MAP_SUGGESTION_COUNT = 10;

export type ComputeSuggestionsArgs = {
  profile: VibeProfile;
  coords: Coords | null;
  bars: Bar[];
  ratings: readonly BarRating[];
  maxResults?: number;
  /** Injectable clock for the staleness filter — tests pass a fixed date. */
  now?: Date;
};

/**
 * Pure core of "run matching for the current user". Mirrors the exact
 * `matches()` invocation ResultsView makes on the home (Where-next) flow:
 *
 *  - pass-rated bars are excluded,
 *  - the flattened tags of Loved bars feed the loved-affinity ranking term,
 *  - the profile's preferred neighborhoods filter applies,
 *  - maxMiles is null (no hard radius — the map shows the whole catalog).
 *
 * Kept pure (no hooks, no storage reads) so it is directly unit-testable.
 */
export function computeSuggestions(args: ComputeSuggestionsArgs): Bar[] {
  const {
    profile,
    coords,
    bars,
    ratings,
    maxResults = MAP_SUGGESTION_COUNT,
    now,
  } = args;

  const excludeIds = ratings
    .filter((r) => r.rating === 'pass')
    .map((r) => r.barId);

  // Flatten the vibe tags of every bar the user has Loved, so matches() can
  // nudge bars with a similar taste profile up the rank (loved-affinity term).
  const lovedBarIds = new Set(
    ratings.filter((r) => r.rating === 'loved').map((r) => r.barId),
  );
  const lovedTagSet = new Set<VibeTag>();
  if (lovedBarIds.size > 0) {
    for (const b of bars) {
      if (lovedBarIds.has(b.id)) {
        for (const t of b.tags) lovedTagSet.add(t);
      }
    }
  }

  return matches({
    profile,
    coords,
    preferredNeighborhoods: profile.preferredNeighborhoods,
    maxMiles: null,
    bars,
    excludeIds,
    maxResults,
    now,
    lovedTags: Array.from(lovedTagSet),
  });
}

export type UseSuggestionsReturn = {
  /** Ranked suggested bar ids. Empty until a saved quiz profile exists. */
  suggestedIds: string[];
  /** True when loadProfile() found a saved quiz profile. */
  hasProfile: boolean;
  /**
   * False until the client-side localStorage read has run. Gate "take the
   * quiz" empty-state UI on this to avoid a hydration flash for users who
   * DO have a profile.
   */
  profileChecked: boolean;
};

/**
 * "Run matching for the current user" as a hook — the map's shared entry
 * point to the same suggestion pipeline the home flow uses.
 *
 * Judgment call (B6): WhereNextFlow does not contain a cleanly liftable
 * inline matches() call — the actual invocation lives inside ResultsView,
 * coupled to its rendering and step state. Rather than destabilize that
 * flow, this hook composes the same primitives (storedProfile + useRatings
 * + useBars + matches) with identical semantics via computeSuggestions().
 */
export function useSuggestions(
  coords: Coords | null,
  maxResults: number = MAP_SUGGESTION_COUNT,
): UseSuggestionsReturn {
  const bars = useBars();
  const { ratings } = useRatings();

  // The saved vibe profile is read client-side after mount (same pattern as
  // WhereNextFlow) to avoid an SSR/localStorage hydration mismatch.
  const [profile, setProfile] = useState<VibeProfile | null>(null);
  const [profileChecked, setProfileChecked] = useState(false);
  useEffect(() => {
    const saved = loadProfile();
    if (saved) {
      setProfile({
        tags: saved.tags,
        archetype: saved.archetype,
        preferredNeighborhoods: saved.preferredNeighborhoods,
      });
    }
    setProfileChecked(true);
  }, []);

  const suggestedIds = useMemo(() => {
    if (!profile) return [];
    return computeSuggestions({ profile, coords, bars, ratings, maxResults })
      .map((b) => b.id);
  }, [profile, coords, bars, ratings, maxResults]);

  return { suggestedIds, hasProfile: profile !== null, profileChecked };
}
