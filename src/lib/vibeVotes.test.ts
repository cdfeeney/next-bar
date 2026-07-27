import { describe, expect, test } from 'vitest';
import {
  VOTE_OPTIONS,
  boostByWinningVibe,
  tallyVibeVotes,
  type VibeVote,
} from './vibeVotes';
import { TAG_VOCABULARY } from '@/lib/catalog';

const vote = (
  userId: string,
  tag: string,
  createdAt: string,
): VibeVote => ({
  userId,
  handle: null,
  displayName: null,
  tag,
  createdAt,
});

describe('VOTE_OPTIONS', () => {
  test('every poll option is a real vocabulary tag', () => {
    for (const option of VOTE_OPTIONS) {
      expect(TAG_VOCABULARY).toContain(option);
    }
  });
});

describe('tallyVibeVotes', () => {
  test('no votes → no winner', () => {
    const { counts, winner } = tallyVibeVotes([]);
    expect(counts.size).toBe(0);
    expect(winner).toBeNull();
  });

  test('highest count wins', () => {
    const { counts, winner } = tallyVibeVotes([
      vote('a', 'dance', '2026-07-27T01:00:00Z'),
      vote('b', 'chill', '2026-07-27T01:01:00Z'),
      vote('c', 'dance', '2026-07-27T01:02:00Z'),
    ]);
    expect(winner).toBe('dance');
    expect(counts.get('dance')).toBe(2);
    expect(counts.get('chill')).toBe(1);
  });

  test('tie breaks to the tag whose earliest vote landed first', () => {
    const { winner } = tallyVibeVotes([
      vote('a', 'chill', '2026-07-27T01:05:00Z'),
      vote('b', 'dance', '2026-07-27T01:00:00Z'),
      vote('c', 'chill', '2026-07-27T01:10:00Z'),
      vote('d', 'dance', '2026-07-27T01:20:00Z'),
    ]);
    expect(winner).toBe('dance');
  });
});

describe('boostByWinningVibe', () => {
  type Entry = { barId: string; tags: string[] };
  const entries: Entry[] = [
    { barId: 'quiet-wine', tags: ['wine', 'chill'] },
    { barId: 'disco-a', tags: ['dance', 'loud'] },
    { barId: 'pub', tags: ['beer', 'pub'] },
    { barId: 'disco-b', tags: ['dance', 'buzzy'] },
  ];
  const tagsOf = (e: Entry) => e.tags;

  test('winner-matching entries float, order preserved within partitions', () => {
    expect(
      boostByWinningVibe(entries, 'dance', tagsOf).map((e) => e.barId),
    ).toEqual(['disco-a', 'disco-b', 'quiet-wine', 'pub']);
  });

  test('null winner returns the original order (fresh copy)', () => {
    const result = boostByWinningVibe(entries, null, tagsOf);
    expect(result.map((e) => e.barId)).toEqual([
      'quiet-wine',
      'disco-a',
      'pub',
      'disco-b',
    ]);
    expect(result).not.toBe(entries);
  });

  test('winner nobody matches leaves the order unchanged', () => {
    expect(
      boostByWinningVibe(entries, 'rooftop', tagsOf).map((e) => e.barId),
    ).toEqual(['quiet-wine', 'disco-a', 'pub', 'disco-b']);
  });
});
