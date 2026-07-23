import type { Bar, Neighborhood, VibeTag } from '@/types';
import type { BarRating } from '@/types/ratings';
import { deriveArchetype } from '@/lib/quiz';

/** How much each tier contributes to a bar's tags in the taste profile. */
const LOVED_WEIGHT = 2;
const LIKED_WEIGHT = 1;
/** Cap so the profile reads as a headline, not a tag dump. */
const TOP_TAGS_LIMIT = 5;

export type TasteProfile = {
  /** Every rating the user has made (any tier, on- or off-catalog). */
  ratedCount: number;
  lovedCount: number;
  likedCount: number;
  /** Weighted tags from Loved (2x) + Liked (1x) bars, desc; ties alphabetical. */
  topTags: { tag: VibeTag; weight: number }[];
  /** Neighborhoods of Loved+Liked bars, count desc; ties alphabetical. */
  neighborhoods: { neighborhood: Neighborhood; count: number }[];
  /** Quiz-style archetype derived from the weighted top tags; null when no signal. */
  archetype: string | null;
};

/**
 * Pure derivation of a "taste identity" from ratings + the catalog.
 * Pass-rated bars carry negative intent, so they contribute nothing.
 */
export function deriveTasteProfile(
  ratings: BarRating[],
  bars: Bar[],
): TasteProfile {
  const barById = new Map(bars.map((b) => [b.id, b]));

  const tagWeights = new Map<VibeTag, number>();
  const hoodCounts = new Map<Neighborhood, number>();
  let lovedCount = 0;
  let likedCount = 0;

  for (const r of ratings) {
    if (r.rating === 'loved') lovedCount += 1;
    if (r.rating === 'liked') likedCount += 1;
    if (r.rating === 'pass') continue;

    const bar = barById.get(r.barId);
    if (!bar) continue;

    const weight = r.rating === 'loved' ? LOVED_WEIGHT : LIKED_WEIGHT;
    for (const tag of bar.tags) {
      tagWeights.set(tag, (tagWeights.get(tag) ?? 0) + weight);
    }
    hoodCounts.set(bar.neighborhood, (hoodCounts.get(bar.neighborhood) ?? 0) + 1);
  }

  const topTags = Array.from(tagWeights.entries())
    .map(([tag, weight]) => ({ tag, weight }))
    .sort((a, b) => b.weight - a.weight || a.tag.localeCompare(b.tag))
    .slice(0, TOP_TAGS_LIMIT);

  const neighborhoods = Array.from(hoodCounts.entries())
    .map(([neighborhood, count]) => ({ neighborhood, count }))
    .sort(
      (a, b) => b.count - a.count || a.neighborhood.localeCompare(b.neighborhood),
    );

  const archetype =
    topTags.length > 0 ? deriveArchetype(topTags.map((t) => t.tag)) : null;

  return {
    ratedCount: ratings.length,
    lovedCount,
    likedCount,
    topTags,
    neighborhoods,
    archetype,
  };
}
