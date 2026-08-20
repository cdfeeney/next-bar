import { describe, it, expect } from 'vitest';
import {
  computeConsensus,
  deriveConsensusParticipants,
  GROUP_FAVORITE_MIN_SCORE,
  type ConsensusParticipant,
} from './consensus';
import type { BarRating } from '@/types/ratings';

const rating = (barId: string, score: number): BarRating => ({
  barId,
  rating: score >= 8.0 ? 'loved' : score >= 5.0 ? 'liked' : 'pass',
  ratedAt: '2026-05-01T00:00:00.000Z',
  score,
});

/** A rating entered before any pairwise comparison — tier only, no score. */
const unscored = (barId: string, tier: BarRating['rating']): BarRating => ({
  barId,
  rating: tier,
  ratedAt: '2026-05-01T00:00:00.000Z',
});

const participant = (
  id: string,
  ratings: BarRating[],
): ConsensusParticipant => ({ id, label: id, ratings });

describe('computeConsensus — Group Favorites (founder rule 2026-08-19)', () => {
  it('makes a bar a Group Favorite only when every member scored it >= 8.0', () => {
    const a = participant('a', [rating('x', 9.0), rating('y', 8.0)]);
    const b = participant('b', [rating('x', 8.0), rating('y', 9.0)]);
    const c = participant('c', [rating('x', 8.5), rating('y', 7.0)]);

    const { overlap, alsoConsider } = computeConsensus([a, b, c]);

    // x: 9.0 / 8.0 / 8.5 — unanimous at or above the threshold.
    expect(overlap.map((e) => e.barId)).toEqual(['x']);
    expect(overlap[0].avgScore).toBeCloseTo(8.5, 5);
    expect(overlap[0].ratedBy).toBe(3);
    // y: one 7.5-style near-miss (7.0) fails unanimity, so it is a near-miss,
    // not a Group Favorite — and it is NOT hidden.
    expect(alsoConsider.map((e) => e.barId)).toEqual(['y']);
  });

  it('uses 8.0 as the threshold, inclusive', () => {
    expect(GROUP_FAVORITE_MIN_SCORE).toBe(8.0);
    const exactly = computeConsensus([
      participant('a', [rating('x', 8.0)]),
      participant('b', [rating('x', 8.0)]),
    ]);
    expect(exactly.overlap.map((e) => e.barId)).toEqual(['x']);

    const justUnder = computeConsensus([
      participant('a', [rating('x', 8.0)]),
      participant('b', [rating('x', 7.9)]),
    ]);
    expect(justUnder.overlap).toHaveLength(0);
  });

  it('does not let one low score veto a bar for the group', () => {
    // Founder table: 9.0 / 2.0 = not a Group Favorite. It is not removed by a
    // veto — it simply fails unanimity, same as a 7.5 does.
    const a = participant('a', [rating('x', 9.5), rating('y', 9.5)]);
    const b = participant('b', [rating('x', 2.0), rating('y', 7.5)]);

    const { overlap } = computeConsensus([a, b]);

    expect(overlap).toHaveLength(0);
    // And a Pass-tier score never suppresses OTHER bars either.
    const c = participant('c', [rating('x', 2.0), rating('z', 9.0)]);
    const d = participant('d', [rating('z', 8.5)]);
    expect(
      computeConsensus([c, d]).overlap.map((e) => e.barId),
    ).toEqual(['z']);
  });

  it('treats a member with no score for the bar as "not YET", never as a vote', () => {
    // Founder table: 9.0 / no score = not YET a Group Favorite.
    const a = participant('a', [rating('x', 9.0)]);
    const b = participant('b', [unscored('x', 'loved')]);

    const { overlap, alsoConsider } = computeConsensus([a, b]);

    expect(overlap).toHaveLength(0);
    // One favorable score is not a near-miss either — that needs 2.
    expect(alsoConsider).toHaveLength(0);
  });

  it('never imputes a tier midpoint for an unscored rating', () => {
    // Both `loved` with no score. Under the old tier-midpoint fallback this
    // scored 9.0 each and became a unanimous pick; scores are the product
    // model now, and there are none here.
    const a = participant('a', [unscored('x', 'loved')]);
    const b = participant('b', [unscored('x', 'loved')]);

    const { overlap, alsoConsider } = computeConsensus([a, b]);

    expect(overlap).toHaveLength(0);
    expect(alsoConsider).toHaveLength(0);
  });

  it('routes a bar 2+ (not all) members scored highly into alsoConsider', () => {
    const a = participant('a', [rating('duo', 9.0), rating('solo', 9.0)]);
    const b = participant('b', [rating('duo', 8.0)]);
    const c = participant('c', [rating('other', 8.0)]);

    const { overlap, alsoConsider } = computeConsensus([a, b, c]);

    expect(overlap).toHaveLength(0);
    expect(alsoConsider.map((e) => e.barId)).toEqual(['duo']);
    expect(alsoConsider[0].ratedBy).toBe(2);
    // 'solo' and 'other' have a single favourable score each — neither list.
  });

  it('keeps a near-miss out of alsoConsider without 2 favourable scores', () => {
    const a = participant('a', [rating('x', 9.0)]);
    const b = participant('b', [rating('x', 6.0)]);
    const c = participant('c', [rating('x', 6.5)]);

    const { overlap, alsoConsider } = computeConsensus([a, b, c]);

    expect(overlap).toHaveLength(0);
    expect(alsoConsider).toHaveLength(0);
  });

  it('ranks both lists by average score, descending', () => {
    const a = participant('a', [rating('hi', 9.5), rating('lo', 8.0)]);
    const b = participant('b', [rating('hi', 9.0), rating('lo', 8.5)]);

    const { overlap } = computeConsensus([a, b]);

    expect(overlap.map((e) => e.barId)).toEqual(['hi', 'lo']);
  });

  it('returns a single participant\'s own high scores as overlap', () => {
    const a = participant('a', [rating('x', 9.0), rating('y', 8.0)]);
    const { overlap, alsoConsider } = computeConsensus([a]);
    // With one participant "everyone scored it" is trivially true; the UI
    // gates on >= 2 participants.
    expect(overlap).toHaveLength(2);
    expect(alsoConsider).toHaveLength(0);
  });

  it('does not mutate the input ratings', () => {
    const ratings = [rating('x', 9.0), rating('y', 8.0)];
    const snapshot = JSON.stringify(ratings);
    computeConsensus([participant('a', ratings), participant('b', ratings)]);
    expect(JSON.stringify(ratings)).toBe(snapshot);
  });

  it('sorts votes within an entry high→low', () => {
    const a = participant('a', [rating('x', 8.5)]);
    const b = participant('b', [rating('x', 9.0)]);
    const { overlap } = computeConsensus([a, b]);
    expect(overlap[0].votes.map((v) => v.score)).toEqual([9.0, 8.5]);
  });
});

describe('deriveConsensusParticipants — the unanimity denominator', () => {
  const you = { id: 'you', label: 'You', ratings: [rating('x', 9.0)] };
  const scored = { id: 'friend', label: 'Friend', ratings: [rating('x', 8.5)] };
  /** Selected, invited, ranks nothing. Counts anyway. */
  const unranked = { id: 'newbie', label: 'Newbie', ratings: [] };

  const derive = (selectedIds: string[]) =>
    deriveConsensusParticipants({
      selected: new Set(selectedIds),
      you,
      ratedPeople: [scored],
      unratedPeople: [unranked],
    });

  it('counts a selected member who has ranked nothing', () => {
    // The defect: they used to be dropped, so `total` was 2 and a bar only
    // the other two scored came out unanimous.
    expect(derive(['you', 'friend', 'newbie']).map((p) => p.id)).toEqual([
      'you',
      'friend',
      'newbie',
    ]);
  });

  it('so a bar the others love is NOT a Group Favorite while they are selected', () => {
    const withNewbie = computeConsensus(derive(['you', 'friend', 'newbie']));
    expect(withNewbie.overlap).toHaveLength(0);
    // Not hidden either — two favourable scores make it a near-miss.
    expect(withNewbie.alsoConsider.map((e) => e.barId)).toEqual(['x']);

    // Deselect them and the same bar qualifies. That is the denominator
    // doing its job, not a threshold change.
    const without = computeConsensus(derive(['you', 'friend']));
    expect(without.overlap.map((e) => e.barId)).toEqual(['x']);
  });

  it('includes only selected people, and You only when they have ratings', () => {
    expect(derive(['friend']).map((p) => p.id)).toEqual(['friend']);
    expect(
      deriveConsensusParticipants({
        selected: new Set(['you', 'friend']),
        you: null,
        ratedPeople: [scored],
        unratedPeople: [],
      }).map((p) => p.id),
    ).toEqual(['friend']);
  });

  it('handles mixed group membership: a bar nobody shares stays out of both lists', () => {
    const result = computeConsensus(
      deriveConsensusParticipants({
        selected: new Set(['you', 'a', 'b']),
        you,
        ratedPeople: [
          { id: 'a', label: 'A', ratings: [rating('only-a', 9.5)] },
          { id: 'b', label: 'B', ratings: [rating('only-b', 9.5)] },
        ],
        unratedPeople: [],
      }),
    );
    expect(result.overlap).toHaveLength(0);
    expect(result.alsoConsider).toHaveLength(0);
  });
});
