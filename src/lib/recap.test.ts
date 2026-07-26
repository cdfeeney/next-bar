import { describe, expect, it } from 'vitest';
import { composeRecap } from '@/lib/recap';
import { lastNightKey } from '@/lib/nightLog';
import type { NightRecord } from '@/lib/nightLog';

// Minimal catalog fixtures — recap only reads id/name-level fields.
type AnyBar = import('@/types').Bar;
const makeBar = (id: string): AnyBar =>
  ({
    id,
    name: id,
    neighborhood: 'LES',
    address: '1 Test St',
    lat: 40.72,
    lng: -73.99,
    tags: ['dive'],
    priceTier: 1,
    blurb: 'test',
    lastVerified: '2026-04-01',
  }) as AnyBar;

const catalog = [makeBar('attaboy'), makeBar('mister-paradise'), makeBar('sisters')];

const rating = (
  barId: string,
  tier: 'loved' | 'liked' | 'pass',
): import('@/types/ratings').BarRating => ({
  barId,
  rating: tier,
  ratedAt: '2026-07-25T01:00:00-04:00',
});

const night = (
  visits: string[],
  ratings: import('@/types/ratings').BarRating[] = [],
): NightRecord => ({
  nightKey: '2026-07-24',
  visits: visits.map((barId, i) => ({
    barId,
    at: `2026-07-24T2${i}:00:00-04:00`,
  })),
  ratings,
});

describe('composeRecap (E4.2)', () => {
  it('null for an empty night — the placeholder card stays', () => {
    expect(composeRecap(night([]), catalog)).toBeNull();
  });

  it('orders bars by the route and keeps a genuine return visit', () => {
    const recap = composeRecap(
      night(['attaboy', 'mister-paradise', 'attaboy']),
      catalog,
    );
    expect(recap!.bars.map((b) => b.id)).toEqual([
      'attaboy',
      'mister-paradise',
      'attaboy',
    ]);
  });

  it('drops ids the catalog no longer knows; all-unknown reads as no recap', () => {
    const recap = composeRecap(night(['attaboy', 'gone-bar']), catalog);
    expect(recap!.bars.map((b) => b.id)).toEqual(['attaboy']);
    expect(composeRecap(night(['gone-bar']), catalog)).toBeNull();
  });

  it("surfaces the night's Loved bar and the unrated remainder (distinct)", () => {
    const recap = composeRecap(
      night(
        ['attaboy', 'mister-paradise', 'sisters', 'mister-paradise'],
        [rating('attaboy', 'loved'), rating('sisters', 'pass')],
      ),
      catalog,
    );
    expect(recap!.loved?.id).toBe('attaboy');
    // mister-paradise visited twice → ONE unrated entry.
    expect(recap!.unratedBarIds).toEqual(['mister-paradise']);
  });

  it('no Loved rating that night → loved is null', () => {
    const recap = composeRecap(
      night(['attaboy'], [rating('attaboy', 'liked')]),
      catalog,
    );
    expect(recap!.loved).toBeNull();
    expect(recap!.unratedBarIds).toEqual([]);
  });
});

describe('lastNightKey (E4.2 read window)', () => {
  it('morning after points at the night that just ended', () => {
    // Sunday 9am NYC → last night = Saturday's key.
    expect(lastNightKey(new Date('2026-07-26T09:00:00-04:00'))).toBe('2026-07-25');
  });

  it('small hours still count as TONIGHT, so last night is the day before', () => {
    // Sunday 2am NYC = Saturday's night → last night = Friday.
    expect(lastNightKey(new Date('2026-07-26T02:00:00-04:00'))).toBe('2026-07-24');
  });

  it('crosses month boundaries with calendar math', () => {
    expect(lastNightKey(new Date('2026-08-01T09:00:00-04:00'))).toBe('2026-07-31');
  });
});
