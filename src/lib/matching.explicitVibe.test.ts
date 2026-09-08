import { describe, it, expect } from 'vitest';
import { explicitVibeScore, matches } from '@/lib/matching';
import {
  deriveLearnedTaste,
  learnedTasteScore,
  EMPTY_TASTE,
  type LearnedTaste,
} from '@/lib/tasteAffinity';
import { RADIUS_CAB, RADIUS_WALK } from '@/lib/constants';
import type { BarRating } from '@/types/ratings';
import type { Bar, VibeProfile, VibeTag } from '@/types';

/**
 * The explicit-intent ranking path: an APPLIED Tweak-the-vibe pick outweighs
 * learned taste 80/20, instead of being weighted (1 - c) as the cold-start
 * quiz prior.
 *
 * The defect these pin down: at 200 ratings c = 0.952, so a tweak the user had
 * just applied carried 4.8% of the ranking and a matching cocktail bar lost to
 * a nonmatching dive the user simply had more history with.
 */

const NOW = new Date('2026-05-15T12:00:00Z');
const FRESH = '2026-04-01';

const ORIGIN = { lat: 40.755, lng: -73.984 }; // Midtown centroid

const makeBar = (overrides: Partial<Bar>): Bar => ({
  id: 'bar-x',
  name: 'X',
  neighborhood: 'Midtown',
  address: '1 Main St',
  lat: ORIGIN.lat,
  lng: ORIGIN.lng,
  priceTier: 2,
  tags: [],
  blurb: 'A bar.',
  lastVerified: FRESH,
  ...overrides,
});

/** ~69 miles per degree of latitude — same helper the cascade tests use. */
const atMiles = (id: string, miles: number, tags: VibeTag[]): Bar =>
  makeBar({ id, tags, lat: ORIGIN.lat + miles / 69, lng: ORIGIN.lng });

/** The vibe the user picks in the tweak surface. */
const PICKED: VibeTag = 'cocktail';
/** The vibe their rating history is soaked in. */
const HISTORY: VibeTag = 'dive';

/** A user whose whole history is `n` perfect scores on dive bars. */
function diveHistoryTaste(n: number): LearnedTaste {
  const rated = Array.from({ length: n }, (_, i) =>
    makeBar({ id: `hist-${i}`, tags: [HISTORY] }),
  );
  const ratings: BarRating[] = rated.map((bar) => ({
    barId: bar.id,
    rating: 'loved',
    ratedAt: '2026-05-01T00:00:00.000Z',
    score: 10,
  }));
  return deriveLearnedTaste(ratings, rated);
}

const quizProfile = (tags: VibeTag[]): VibeProfile => ({
  tags,
  archetype: 'test-archetype',
  preferredNeighborhoods: [],
});

/** The same tags, but APPLIED through the tweak surface. */
const tweakedProfile = (tags: VibeTag[]): VibeProfile => ({
  ...quizProfile(tags),
  isExplicitVibe: true,
});

/** A cocktail bar and a dive bar, both an easy walk away. */
const twoBarPool = (): Bar[] => [
  atMiles('cocktail-bar', 0.5, [PICKED]),
  atMiles('dive-bar', 0.6, [HISTORY]),
];

const rank = (
  profile: VibeProfile,
  bars: Bar[],
  taste: LearnedTaste,
): string[] =>
  matches({
    profile,
    coords: ORIGIN,
    preferredNeighborhoods: [],
    maxMiles: null,
    bars,
    maxResults: 5,
    now: NOW,
    taste,
  }).map((bar) => bar.id);

describe('matches() — inactive tweak', () => {
  it('ranks by the normal quiz-prior cascade when no tweak has been applied', () => {
    const taste = diveHistoryTaste(200);
    // Today's documented behavior at c = 0.952: history outranks the tags.
    expect(rank(quizProfile([PICKED]), twoBarPool(), taste)).toEqual([
      'dive-bar',
      'cocktail-bar',
    ]);
  });

  it('treats an explicitly false flag exactly like an absent one', () => {
    const taste = diveHistoryTaste(200);
    const pool = twoBarPool();
    expect(
      rank({ ...quizProfile([PICKED]), isExplicitVibe: false }, pool, taste),
    ).toEqual(rank(quizProfile([PICKED]), pool, taste));
  });
});

describe('matches() — active tweak', () => {
  it('puts the picked vibe ahead of the bar the history favours', () => {
    const taste = diveHistoryTaste(20);
    expect(rank(quizProfile([PICKED]), twoBarPool(), taste)).toEqual([
      'dive-bar',
      'cocktail-bar',
    ]);
    // D-C-41: the dive bar is not merely outranked now, it is 0/1 and so
    // INELIGIBLE. A one-bar page is the honest answer; padding it with a bar
    // the user's pick rejected is not.
    expect(rank(tweakedProfile([PICKED]), twoBarPool(), taste)).toEqual([
      'cocktail-bar',
    ]);
  });

  it('still wins at 200+ ratings, where the quiz prior is worth 4.8%', () => {
    for (const n of [200, 500]) {
      const taste = diveHistoryTaste(n);
      expect(taste.confidence).toBeGreaterThan(0.95);
      expect(rank(tweakedProfile([PICKED]), twoBarPool(), taste)).toEqual([
        'cocktail-bar',
      ]);
    }
  });

  it('orders two MATCHING bars by the 80/20 blend, not by learned taste alone', () => {
    // Both bars match the pick, so the match-first fill order cannot decide
    // this one — only the weighted score can, and the WEIGHT is what decides
    // it. With 20 observations per tag the shrinkage term stops damping and
    // A(tag) reaches ±0.8, so:
    //   sharp = w*1.0  + (1 - w)*(-0.8)  =  1.8w - 0.8
    //   broad = w*0.5  + (1 - w)*(0.0)   =  0.5w
    // sharp leads only while w > ~0.62. At the approved 0.8 it does; re-tune
    // the constant down to 0.5 and this flips, which is what pins it.
    const rated = [
      ...Array.from({ length: 20 }, (_, i) =>
        makeBar({ id: `wine-${i}`, tags: ['wine'] }),
      ),
      ...Array.from({ length: 20 }, (_, i) =>
        makeBar({ id: `ck-${i}`, tags: [PICKED] }),
      ),
    ];
    const taste = deriveLearnedTaste(
      rated.map((bar) => ({
        barId: bar.id,
        rating: bar.tags[0] === 'wine' ? ('loved' as const) : ('pass' as const),
        ratedAt: '2026-05-01T00:00:00.000Z',
        score: bar.tags[0] === 'wine' ? 10 : 1,
      })),
      rated,
    );
    expect(taste.affinity.get(PICKED)).toBeCloseTo(-0.8, 10);
    expect(taste.affinity.get('wine')).toBeCloseTo(0.8, 10);

    const sharp = atMiles('sharp', 0.5, [PICKED]);
    const broad = atMiles('broad', 0.6, [PICKED, 'wine']);

    expect(
      matches({
        profile: tweakedProfile([PICKED]),
        coords: ORIGIN,
        preferredNeighborhoods: [],
        maxMiles: RADIUS_WALK,
        bars: [broad, sharp],
        maxResults: 5,
        now: NOW,
        taste,
      }).map((bar) => bar.id),
    ).toEqual(['sharp', 'broad']);
  });

  it('lets learned taste order bars that match the pick equally well', () => {
    // Same tag count and the same single overlap, so the 80% vibe term ties
    // exactly and the remaining 20% of learned taste is what decides.
    const taste = diveHistoryTaste(200);
    const pool = [
      atMiles('cocktail-wine', 0.5, [PICKED, 'wine']),
      atMiles('cocktail-dive', 0.6, [PICKED, HISTORY]),
    ];
    expect(rank(tweakedProfile([PICKED]), pool, taste)[0]).toBe('cocktail-dive');
  });
});

describe('matches() — distance band expansion under an active tweak', () => {
  const walkables = [0.2, 0.4, 0.6, 0.8, 1.0].map((mi, i) =>
    atMiles(`near-${i}`, mi, [HISTORY]),
  );
  const farMatch = atMiles('far-cocktail', 3.0, [PICKED]); // cab band
  const pool = [...walkables, farMatch];

  it('without a tweak, the walkable band fills the page and the far bar never surfaces', () => {
    expect(rank(quizProfile([PICKED]), pool, EMPTY_TASTE)).not.toContain(
      'far-cocktail',
    );
  });

  it('reaches the far MATCH, and never pads the page with the near nonmatches', () => {
    // Before D-C-41 the five walkable dives filled the rest of the page behind
    // the far match. They are 0/1 against the pick, so the page is now one bar
    // long — "fewer results" rather than "five results, four of them wrong".
    const ids = rank(tweakedProfile([PICKED]), pool, EMPTY_TASTE);
    expect(ids).toEqual(['far-cocktail']);
  });

  // Explicit bounds remain strict even with an applied vibe.
  it('does not expand an explicit maximum for an applied vibe', () => {
    const ids = matches({
      profile: tweakedProfile([PICKED]),
      coords: ORIGIN,
      preferredNeighborhoods: [],
      minMilesExclusive: null,
      maxMiles: RADIUS_WALK,
      bars: pool,
      maxResults: 5,
      now: NOW,
      taste: EMPTY_TASTE,
    }).map((bar) => bar.id);

    expect(ids).toEqual([]);
  });

  it('reaches the NEXT band only — a match past RADIUS_CAB stays out of a Walkable page', () => {
    const scoped = [
      atMiles('walk-dive', 0.9, [HISTORY]),
      atMiles('cab-cocktail', 3.0, [PICKED]), // next band — reachable
      atMiles('far-cocktail', 9.0, [PICKED]), // two bands out — not
    ];
    const ids = matches({
      profile: tweakedProfile([PICKED]),
      coords: ORIGIN,
      preferredNeighborhoods: [],
      minMilesExclusive: null,
      maxMiles: RADIUS_WALK,
      bars: scoped,
      maxResults: 5,
      now: NOW,
      taste: EMPTY_TASTE,
    }).map((bar) => bar.id);

    expect(ids).toEqual([]);
  });

  it('enforces both geographic bounds even when no vibe match remains', () => {
    const cabScoped = [
      atMiles('walk-cocktail', 0.5, [PICKED]), // inside the chip's inner edge
      atMiles('cab-dive', 2.0, [HISTORY]),
      atMiles('beyond-cocktail', 6.0, [PICKED]), // past its outer edge
    ];
    const ids = matches({
      profile: tweakedProfile([PICKED]),
      coords: ORIGIN,
      preferredNeighborhoods: [],
      minMilesExclusive: RADIUS_WALK,
      maxMiles: RADIUS_CAB,
      bars: cabScoped,
      maxResults: 5,
      now: NOW,
      taste: EMPTY_TASTE,
    }).map((bar) => bar.id);

    expect(ids).toEqual([]);
  });

  it('changes geographic scope only — the radius never re-weights the vibe', () => {
    const scoped = [
      atMiles('walk-dive', 0.9, [HISTORY]),
      atMiles('walk-cocktail', 0.5, [PICKED]),
      atMiles('cab-cocktail', 3.0, [PICKED]),
      atMiles('cab-dive', 3.1, [HISTORY]),
    ];
    const common = {
      profile: tweakedProfile([PICKED]),
      coords: ORIGIN,
      preferredNeighborhoods: [],
      bars: scoped,
      maxResults: 5,
      now: NOW,
    };
    const anywhere = matches({ ...common, maxMiles: null }).map((b) => b.id);
    const walkOnly = matches({ ...common, maxMiles: RADIUS_WALK }).map(
      (b) => b.id,
    );

    expect(anywhere).toEqual(['walk-cocktail', 'cab-cocktail']);
    expect(walkOnly).toEqual(['walk-cocktail']);
  });
});

describe('matches() — eligibility gates the pool (D-C-41)', () => {
  const FOUR: VibeTag[] = ['cocktail', 'wine', 'jazz', 'rooftop'];

  /** A bar carrying the first `hit` of FOUR, padded with a non-picked tag. */
  const hitting = (id: string, hit: number, miles: number): Bar =>
    atMiles(id, miles, [...FOUR.slice(0, hit), 'pub']);

  const rankFour = (bars: Bar[], maxMiles: number | null = null): string[] =>
    matches({
      profile: tweakedProfile(FOUR),
      coords: ORIGIN,
      preferredNeighborhoods: [],
      minMilesExclusive: null,
      maxMiles,
      bars,
      maxResults: 10,
      now: NOW,
      taste: EMPTY_TASTE,
    }).map((bar) => bar.id);

  it('admits 3/4 and 4/4 but not 2/4 — one miss is forgiven, two are not', () => {
    const ids = rankFour([
      hitting('four', 4, 0.4),
      hitting('three', 3, 0.5),
      hitting('two', 2, 0.6),
      hitting('one', 1, 0.7),
      hitting('zero', 0, 0.8),
    ]);
    expect(ids).toEqual(['four', 'three']);
  });

  it('returns an EMPTY list rather than padding with rejected bars', () => {
    // Five nearby bars, none eligible. The old fill order would have handed
    // back all five; the honest answer is none.
    expect(
      rankFour([0.2, 0.3, 0.4, 0.5, 0.6].map((mi, i) => hitting(`near-${i}`, 1, mi))),
    ).toEqual([]);
  });

  it('an ineligible bar cannot re-enter through the band expansion', () => {
    // A 2/4 bar sitting in the next band out is exactly what the expansion
    // reaches for — and it is still rejected, because eligibility is decided
    // before any distance rule runs.
    const ids = rankFour(
      [hitting('near-two', 2, 0.5), hitting('far-three', 3, 3.0)],
      RADIUS_WALK,
    );
    expect(ids).toEqual([]);
  });

  it('an ineligible bar cannot re-enter to fill an under-full page', () => {
    // maxResults 10 against 1 eligible bar: nothing tops the list back up.
    const ids = rankFour([
      hitting('eligible', 4, 0.4),
      ...Array.from({ length: 9 }, (_, i) => hitting(`filler-${i}`, 1, 0.5 + i / 100)),
    ]);
    expect(ids).toEqual(['eligible']);
  });

  it('deduplicates the selection before setting the threshold', () => {
    // Two distinct picks written four times: N = 2, so 1 match is enough.
    // Counting duplicates would demand 3 of 4 and return nothing.
    const oneOfTwo = atMiles('one-of-two', 0.5, ['cocktail', 'pub']);
    expect(
      matches({
        profile: tweakedProfile(['cocktail', 'cocktail', 'wine', 'wine']),
        coords: ORIGIN,
        preferredNeighborhoods: [],
        maxMiles: null,
        bars: [oneOfTwo],
        maxResults: 5,
        now: NOW,
        taste: EMPTY_TASTE,
      }).map((bar) => bar.id),
    ).toEqual(['one-of-two']);
  });
});

describe('matches() — clearing the tweak', () => {
  it('restores normal ranking exactly when the pick is emptied', () => {
    const taste = diveHistoryTaste(200);
    const pool = twoBarPool();
    const normal = rank(quizProfile([]), pool, taste);
    // A cleared tweak carries the flag but no tags — it must not take the
    // explicit path, and must not reorder anything.
    expect(rank(tweakedProfile([]), pool, taste)).toEqual(normal);
  });

  it('restores normal ranking when the flag is dropped again', () => {
    const taste = diveHistoryTaste(200);
    const pool = twoBarPool();
    expect(rank(tweakedProfile([PICKED]), pool, taste)).toEqual([
      'cocktail-bar',
    ]);
    // Dropping the flag drops the gate with it: the dive bar is back, and
    // ahead, exactly as the quiz-prior cascade orders it.
    expect(rank(quizProfile([PICKED]), pool, taste)).toEqual([
      'dive-bar',
      'cocktail-bar',
    ]);
  });
});

describe('explicitVibeScore', () => {
  const taste = diveHistoryTaste(200);

  it('weights the picked vibe 80% and learned taste 20%', () => {
    const dive = makeBar({ id: 'd', tags: [HISTORY] });
    expect(explicitVibeScore(dive, [PICKED], taste)).toBeCloseTo(
      0.2 * learnedTasteScore(dive, taste),
      10,
    );
    const cocktail = makeBar({ id: 'c', tags: [PICKED] });
    expect(explicitVibeScore(cocktail, [PICKED], taste)).toBeCloseTo(0.8, 10);
  });

  it('is independent of confidence — the blend never shrinks with N', () => {
    const cocktail = makeBar({ id: 'c', tags: [PICKED] });
    const cold = explicitVibeScore(cocktail, [PICKED], EMPTY_TASTE);
    const seasoned = explicitVibeScore(
      cocktail,
      [PICKED],
      diveHistoryTaste(500),
    );
    expect(cold).toBeCloseTo(seasoned, 10);
  });
});
