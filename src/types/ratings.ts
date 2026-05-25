export type Rating = 'loved' | 'liked' | 'pass';

export type BarRating = {
  barId: string;
  rating: Rating;
  ratedAt: string; // ISO timestamp
  /**
   * 0.0–10.0 personal score derived from pairwise comparisons within tier.
   * NULL/undefined until the user has answered at least one comparison that
   * involves this bar. See src/lib/pairwise.ts.
   */
  score?: number | null;
};

export type PairwiseComparison = {
  winnerBarId: string;
  loserBarId: string;
  comparedAt: string; // ISO timestamp
};

// Sort ordering: Loved -> Liked -> Pass, then most-recently-rated first
export const RATING_ORDER: Record<Rating, number> = {
  loved: 0,
  liked: 1,
  pass: 2,
};
