'use client';

import type { Rating } from '@/types/ratings';
import { useRatings } from '@/hooks/useRatings';

type RatingBadgeProps = {
  barId: string;
};

const BASE_BADGE_CLASSES =
  'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-label uppercase tracking-wider';

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
 * Presentational badge for a rating the CALLER already holds. List surfaces
 * (BarPicker: 2,107 rows) must use this with one `useRatings` at the list
 * level — the hook variant below mounts a full ratings hydration per badge,
 * which at picker scale meant ~2,107 duplicate server fetches per open.
 */
export function RatingBadgeLabel({ rating }: { rating: Rating | null }) {
  if (rating === null) {
    return null;
  }

  const classes = [BASE_BADGE_CLASSES, badgeClassesFor(rating)].join(' ');

  return <span className={classes}>{labelFor(rating)}</span>;
}

export default function RatingBadge({ barId }: RatingBadgeProps) {
  const { getRating } = useRatings();
  return <RatingBadgeLabel rating={getRating(barId)} />;
}
