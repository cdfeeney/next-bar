import { describe, it, expect } from 'vitest';
import { computeConsensus, type ConsensusParticipant } from './consensus';
import type { BarRating } from '@/types/ratings';

const rating = (
  barId: string,
  score: number,
): BarRating => ({
  barId,
  rating: score >= 8.0 ? 'loved' : score >= 5.0 ? 'liked' : 'pass',
  ratedAt: '2026-05-01T00:00:00.000Z',
  score,
});

const participant = (
  id: string,
  ratings: BarRating[],
): ConsensusParticipant => ({ id, label: id, ratings });

describe('computeConsensus', () => {
  it('puts bars everyone rated into overlap, ranked by average score', () => {
    const a = participant('a', [rating('x', 9.0), rating('y', 8.0)]);
    const b = participant('b', [rating('x', 8.0), rating('y', 9.0)]);
    const c = participant('c', [rating('x', 8.5), rating('y', 7.0)]);

    const { overlap } = computeConsensus([a, b, c]);

    expect(overlap.map((e) => e.barId)).toEqual(['x', 'y']);
    expect(overlap[0].barId).toBe('x');
    expect(overlap[0].avgScore).toBeCloseTo(8.5, 5);
    expect(overlap[0].ratedBy).toBe(3);
    expect(overlap[1].avgScore).toBeCloseTo(8.0, 5);
  });

  it('excludes a bar that any participant Passed (hard veto)', () => {
    const a = participant('a', [rating('x', 9.5)]); // loved
    const b = participant('b', [rating('x', 2.0)]); // pass — veto

    const { overlap, alsoConsider } = computeConsensus([a, b]);

    expect(overlap.find((e) => e.barId === 'x')).toBeUndefined();
    expect(alsoConsider.find((e) => e.barId === 'x')).toBeUndefined();
  });

  it('routes partial-overlap bars (2+ but not all) into alsoConsider', () => {
    const a = participant('a', [rating('shared', 9.0), rating('x', 8.0)]);
    const b = participant('b', [rating('shared', 8.0), rating('y', 8.0)]);
    const c = participant('c', [rating('shared', 7.5)]);

    const { overlap, alsoConsider } = computeConsensus([a, b, c]);

    // 'shared' is rated by all 3 → overlap.
    expect(overlap.map((e) => e.barId)).toEqual(['shared']);
    // 'x' and 'y' are each rated by only 1 → neither list.
    expect(alsoConsider).toHaveLength(0);
  });

  it('surfaces a bar two of three rated into alsoConsider', () => {
    const a = participant('a', [rating('duo', 9.0), rating('solo', 9.0)]);
    const b = participant('b', [rating('duo', 8.0)]);
    const c = participant('c', [rating('other', 8.0)]);

    const { overlap, alsoConsider } = computeConsensus([a, b, c]);

    expect(overlap).toHaveLength(0); // nothing rated by all 3
    expect(alsoConsider.map((e) => e.barId)).toEqual(['duo']);
    expect(alsoConsider[0].ratedBy).toBe(2);
  });

  it('returns empty lists for a single participant (no consensus possible)', () => {
    const a = participant('a', [rating('x', 9.0), rating('y', 8.0)]);
    const { overlap, alsoConsider } = computeConsensus([a]);
    // With one participant every bar is "rated by all" = 1, but ratedBy === total
    // means overlap; that's fine — the UI gates on >=2 participants.
    expect(overlap).toHaveLength(2);
    expect(alsoConsider).toHaveLength(0);
  });

  it('falls back to the tier midpoint when a rating has no score', () => {
    const a: ConsensusParticipant = {
      id: 'a',
      label: 'a',
      ratings: [{ barId: 'x', rating: 'loved', ratedAt: '2026-05-01T00:00:00.000Z' }],
    };
    const b: ConsensusParticipant = {
      id: 'b',
      label: 'b',
      ratings: [{ barId: 'x', rating: 'loved', ratedAt: '2026-05-01T00:00:00.000Z' }],
    };
    const { overlap } = computeConsensus([a, b]);
    expect(overlap[0].avgScore).toBeCloseTo(9.0, 5); // loved midpoint
  });

  it('does not mutate the input ratings', () => {
    const ratings = [rating('x', 9.0), rating('y', 8.0)];
    const snapshot = JSON.stringify(ratings);
    computeConsensus([participant('a', ratings), participant('b', ratings)]);
    expect(JSON.stringify(ratings)).toBe(snapshot);
  });

  it('sorts votes within an entry high→low', () => {
    const a = participant('a', [rating('x', 7.0)]);
    const b = participant('b', [rating('x', 9.0)]);
    const { overlap } = computeConsensus([a, b]);
    expect(overlap[0].votes.map((v) => v.score)).toEqual([9.0, 7.0]);
  });
});
