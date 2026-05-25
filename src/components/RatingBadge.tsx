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

export default function RatingBadge({ barId }: RatingBadgeProps) {
  const { getRating } = useRatings();
  const current = getRating(barId);

  if (current === null) {
    return null;
  }

  const classes = [BASE_BADGE_CLASSES, badgeClassesFor(current)].join(' ');

  return <span className={classes}>{labelFor(current)}</span>;
}
