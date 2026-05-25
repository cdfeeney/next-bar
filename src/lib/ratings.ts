import type { BarRating, Rating } from '@/types/ratings';
import { RATING_ORDER } from '@/types/ratings';

const KEY = 'next-bar:ratings:v1';

const VALID_RATINGS: ReadonlySet<Rating> = new Set<Rating>([
  'loved',
  'liked',
  'pass',
]);

function isRating(value: unknown): value is Rating {
  return typeof value === 'string' && VALID_RATINGS.has(value as Rating);
}

function isBarRating(value: unknown): value is BarRating {
  if (value === null || typeof value !== 'object') return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.barId === 'string' &&
    isRating(obj.rating) &&
    typeof obj.ratedAt === 'string'
  );
}

function isBarRatingArray(value: unknown): value is BarRating[] {
  return Array.isArray(value) && value.every(isBarRating);
}

function notifyChange(): void {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(new StorageEvent('storage', { key: KEY }));
  } catch {
    // Ignore — some environments may not support StorageEvent constructor.
  }
}

function writeAll(items: BarRating[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(items));
  } catch {
    // Ignore quota / private-mode errors silently.
  }
}

export function loadRatings(): BarRating[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!isBarRatingArray(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
}

export function getRating(barId: string): Rating | null {
  const found = loadRatings().find((r) => r.barId === barId);
  return found ? found.rating : null;
}

export function setRating(barId: string, rating: Rating): void {
  if (typeof window === 'undefined') return;
  const current = loadRatings();
  const next: BarRating = {
    barId,
    rating,
    ratedAt: new Date().toISOString(),
  };
  const filtered = current.filter((r) => r.barId !== barId);
  const updated = [...filtered, next];
  writeAll(updated);
  notifyChange();
}

export function clearRating(barId: string): void {
  if (typeof window === 'undefined') return;
  const current = loadRatings();
  const updated = current.filter((r) => r.barId !== barId);
  if (updated.length === current.length) return;
  writeAll(updated);
  notifyChange();
}

export function sortRatingsByTierThenRecency(items: BarRating[]): BarRating[] {
  return [...items].sort((a, b) => {
    const tierDiff = RATING_ORDER[a.rating] - RATING_ORDER[b.rating];
    if (tierDiff !== 0) return tierDiff;
    // More recent first — descending by ratedAt
    if (a.ratedAt < b.ratedAt) return 1;
    if (a.ratedAt > b.ratedAt) return -1;
    return 0;
  });
}
