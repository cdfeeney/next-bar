'use client';

import type { Rating } from '@/types/ratings';
import { useRatings } from '@/hooks/useRatings';

type RatingBadgeProps = {
  barId: string;
};

const BASE_BADGE_CLASSES =
  'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-display uppercase tracking-wider';

function badgeClassesFor(rating: Rating): string {
  switch (rating) {
    case 'loved':
      return 'bg-accent text-bg';
    case 'liked':
      return 'bg-surface border border-accent text-accent';
    case 'pass':
      return 'bg-surface border border-border text-muted line-through';
  }
}

function labelFor(rating: Rating): string {
  switch (rating) {
    case 'loved':
      return 'Loved';
    case 'liked':
      return 'Liked';
    case 'pass':
      return 'Pass';
  }
}

/**
 * Presentational badge for callers that already hold the rating. Surfaces
 * that render MANY badges per interaction (e.g. /search result rows, which
 * remount on every query change) must use this with ONE page-level
 * useRatings, not the hook-bearing default export: each hook instance runs
 * the hydration effect, and the single-flight guard is in-flight only, so
 * a mount wave AFTER a settled run refires server hydration for signed-in
 * users (santa: Codex).
 */
export function RatingBadgeView({ rating }: { rating: Rating | null }): JSX.Element | null {
  if (rating === null) return null;
  const classes = [BASE_BADGE_CLASSES, badgeClassesFor(rating)].join(' ');
  return <span className={classes}>{labelFor(rating)}</span>;
}

export default function RatingBadge({ barId }: RatingBadgeProps) {
  const { getRating } = useRatings();
  return <RatingBadgeView rating={getRating(barId)} />;
}
