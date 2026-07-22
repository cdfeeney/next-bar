import { describe, it, expect } from 'vitest';
import { bars } from '@/lib/bars';

// Normalize a bar name for duplicate detection: fold case, punctuation, and the
// filler words that let the same venue slip in twice under slightly different
// spellings ("Freddy's" vs "Freddy's Bar", "Death & Co" vs "Death and Co").
function normName(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\band\b/g, '')
    .replace(/\bthe\b/g, '')
    .replace(/[^a-z0-9]/g, '');
}

describe('bars catalog integrity', () => {
  it('has no duplicate ids', () => {
    const seen = new Map<string, number>();
    for (const b of bars) seen.set(b.id, (seen.get(b.id) ?? 0) + 1);
    const dupes = [...seen.entries()].filter(([, n]) => n > 1).map(([id]) => id);
    expect(dupes).toEqual([]);
  });

  it('has no duplicate venues (same normalized name in the same neighborhood)', () => {
    const seen = new Map<string, string[]>();
    for (const b of bars) {
      const key = `${normName(b.name)}|${b.neighborhood}`;
      seen.set(key, [...(seen.get(key) ?? []), b.name]);
    }
    const dupes = [...seen.entries()].filter(([, names]) => names.length > 1);
    // Surface the offending names so a failure is actionable.
    expect(dupes.map(([, names]) => names)).toEqual([]);
  });

  it('every bar has valid coords inside the service bbox', () => {
    const BBOX = { minLat: 40.64, maxLat: 40.885, minLng: -74.03, maxLng: -73.89 };
    const outOfBox = bars.filter(
      (b) => b.lat < BBOX.minLat || b.lat > BBOX.maxLat || b.lng < BBOX.minLng || b.lng > BBOX.maxLng,
    );
    expect(outOfBox.map((b) => `${b.name} (${b.lat},${b.lng})`)).toEqual([]);
  });
});
