import type {
  Bar,
  Coords,
  ManhattanNeighborhood,
  VibeProfile,
  VibeTag,
} from '@/types';
import { haversineMiles } from '@/lib/distance';
import { daysAgo } from '@/lib/freshness';
import {
  JACCARD_FLOOR,
  JACCARD_START,
  JACCARD_STEP,
  LAST_VERIFIED_HARD_FILTER_DAYS,
  MAX_RESULTS,
  MIN_CANDIDATES,
} from '@/lib/constants';

export function jaccard(a: VibeTag[], b: VibeTag[]): number {
  if (a.length === 0 && b.length === 0) return 0;
  const setA = new Set(a);
  const setB = new Set(b);
  let intersection = 0;
  for (const tag of setA) {
    if (setB.has(tag)) intersection += 1;
  }
  const union = setA.size + setB.size - intersection;
  if (union === 0) return 0;
  return intersection / union;
}

export function vibeMatchBadge(
  user: VibeTag[],
  bar: VibeTag[],
): { num: number; den: number } {
  const setUser = new Set(user);
  const setBar = new Set(bar);
  let num = 0;
  for (const tag of setUser) {
    if (setBar.has(tag)) num += 1;
  }
  const den = Math.max(1, Math.min(setUser.size, setBar.size));
  return { num, den };
}

export type MatchesArgs = {
  profile: VibeProfile;
  coords: Coords | null;
  preferredNeighborhoods: ManhattanNeighborhood[];
  maxMiles: number | null;
  bars: Bar[];
  excludeIds?: string[];
  maxResults?: number;
  now?: Date;
};

export function matches(args: MatchesArgs): Bar[] {
  const {
    profile,
    coords,
    preferredNeighborhoods,
    maxMiles,
    bars,
    excludeIds,
    maxResults,
    now,
  } = args;

  const exclude = new Set(excludeIds ?? []);
  let pool = bars
    .filter((b) => !exclude.has(b.id))
    .filter((b) => daysAgo(b.lastVerified, now) <= LAST_VERIFIED_HARD_FILTER_DAYS);

  if (preferredNeighborhoods.length > 0) {
    const allowed = new Set(preferredNeighborhoods);
    pool = pool.filter((b) => allowed.has(b.neighborhood));
  }

  if (coords && maxMiles !== null) {
    pool = pool.filter((b) => haversineMiles(coords, b) <= maxMiles);
  }

  let threshold = JACCARD_START;
  let candidates: Bar[] = [];
  while (threshold >= JACCARD_FLOOR - 1e-9 && candidates.length < MIN_CANDIDATES) {
    candidates = pool.filter((b) => jaccard(profile.tags, b.tags) >= threshold);
    if (candidates.length >= MIN_CANDIDATES) break;
    threshold = Math.round((threshold - JACCARD_STEP) * 100) / 100;
  }

  if (coords) {
    candidates = [...candidates].sort(
      (a, b) => haversineMiles(coords, a) - haversineMiles(coords, b),
    );
  } else {
    candidates = [...candidates].sort(
      (a, b) => jaccard(profile.tags, b.tags) - jaccard(profile.tags, a.tags),
    );
  }

  const cap = maxResults ?? MAX_RESULTS;
  return candidates.slice(0, cap);
}
