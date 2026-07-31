'use client';

import { useEffect, useMemo, useState } from 'react';
import type { Bar, Coords, VibeProfile, VibeTag } from '@/types';
import type { BarRating } from '@/types/ratings';
import { matches } from '@/lib/matching';
import { deriveArchetype } from '@/lib/quiz';
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
  /** Ranked suggested bar ids. Empty only before profileChecked; with no
   *  saved quiz profile it falls back to the empty-tag profile
   *  (proximity/affinity-ranked) — never blank for lack of a quiz. */
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
export type SuggestionIntent = {
  /**
   * The ACTIVE intent to rank by, replacing the saved quiz profile's tags.
   * `/map` passes what the user has currently filtered for, so the prominent
   * markers answer "what I asked for just now" rather than "what I said in a
   * quiz once". Omit to keep the saved-profile behaviour (`/discover`).
   */
  tags?: readonly VibeTag[];
  /**
   * Rank within THIS set rather than the whole catalog. `/map` passes the
   * filtered bars: ranking the full catalog and then hiding most of it would
   * score bars the user cannot see, and the cohort-relative tier cut in
   * `suggestedTier` would be computed against the wrong denominator.
   */
  bars?: readonly Bar[];
};

export function useSuggestions(
  coords: Coords | null,
  maxResults: number = MAP_SUGGESTION_COUNT,
  intent?: SuggestionIntent,
): UseSuggestionsReturn {
  const allBars = useBars();
  const bars = intent?.bars ? (intent.bars as Bar[]) : allBars;
  const { ratings } = useRatings();

  // The saved vibe profile is read client-side after mount (same pattern as
  // WhereNextFlow) to avoid an SSR/localStorage hydration mismatch.
  const [profile, setProfile] = useState<VibeProfile | null>(null);
  const [profileChecked, setProfileChecked] = useState(false);
  useEffect(() => {
    const syncProfile = (): void => {
      const saved = loadProfile();
      // G1: fall back to null when the profile is gone, don't keep stale tags.
      // This hook feeds the "Suggested for you" ranking on /map and /discover,
      // so without the listener an account switch (or a Settings clear) would
      // keep RANKING against the previous profile's tags until remount — the
      // same class of leak the profile-change notification exists to close,
      // just expressed as ranking rather than displayed tags.
      setProfile(
        saved
          ? {
              tags: saved.tags,
              archetype: saved.archetype,
              preferredNeighborhoods: saved.preferredNeighborhoods,
            }
          : null,
      );
      setProfileChecked(true);
    };
    syncProfile();
    window.addEventListener('storage', syncProfile);
    return () => window.removeEventListener('storage', syncProfile);
  }, []);

  // UX-C (operator: "no suggested bars for me now"): a missing quiz
  // profile must not blank the suggested tier — fall back to the EMPTY
  // profile (the home flow's defaultProfile pattern: distance/affinity-
  // ranked). hasProfile still reports the truth for the personalize hint.
  const intentTags = intent?.tags;
  const suggestedIds = useMemo(() => {
    if (!profileChecked) return [];
    // An ACTIVE intent wins over the saved quiz profile. Without this the map's
    // prominent markers reflected a quiz answered once, while the user was
    // staring at filters they had just set — the two disagreed and the map
    // looked broken. preferredNeighborhoods is deliberately dropped in intent
    // mode: the neighborhood filter already narrowed `bars`, and re-applying it
    // as a ranking preference would double-count it.
    const effective: VibeProfile = intentTags
      ? {
          tags: [...intentTags],
          archetype: deriveArchetype([...intentTags]),
          preferredNeighborhoods: [],
        }
      : profile ?? {
          tags: [],
          archetype: deriveArchetype([]),
          preferredNeighborhoods: [],
        };
    return computeSuggestions({
      profile: effective,
      coords,
      bars,
      ratings,
      maxResults,
    }).map((b) => b.id);
  }, [profile, intentTags, profileChecked, coords, bars, ratings, maxResults]);

  return { suggestedIds, hasProfile: profile !== null, profileChecked };
}
