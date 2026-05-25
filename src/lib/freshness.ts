import { LAST_VERIFIED_FRESH_DAYS } from '@/lib/constants';

const MS_PER_DAY = 1000 * 60 * 60 * 24;

export function daysAgo(isoDate: string, now: Date = new Date()): number {
  const then = new Date(isoDate).getTime();
  if (Number.isNaN(then)) {
    return Number.POSITIVE_INFINITY;
  }
  const diffMs = now.getTime() - then;
  return Math.floor(diffMs / MS_PER_DAY);
}

export function isFresh(isoDate: string, now: Date = new Date()): boolean {
  return daysAgo(isoDate, now) <= LAST_VERIFIED_FRESH_DAYS;
}

export function formatVerified(isoDate: string): string {
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return 'unknown';
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}
