import type { Bar, VibeProfile } from '@/types';

export function matchScore(profile: VibeProfile, bar: Bar): number {
  if (profile.tags.length === 0) {
    return 0;
  }

  const userTags = new Set(profile.tags);
  const overlap = bar.tags.reduce(
    (count, tag) => (userTags.has(tag) ? count + 1 : count),
    0,
  );

  const denominator = Math.max(profile.tags.length, 1);
  return Math.round((overlap / denominator) * 100);
}
