export type Rating = 'loved' | 'liked' | 'pass';

export type BarRating = {
  barId: string;
  rating: Rating;
  ratedAt: string; // ISO timestamp
};

// Sort ordering: Loved -> Liked -> Pass, then most-recently-rated first
export const RATING_ORDER: Record<Rating, number> = {
  loved: 0,
  liked: 1,
  pass: 2,
};
