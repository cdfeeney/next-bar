import { describe, it, expect } from 'vitest';
import {
  createSession,
  castVote,
  tally,
  winner,
  pickFavorite,
} from '@/lib/groupVote';
import type { BarRating } from '@/types/ratings';

const CANDIDATES = ['death-and-co', 'attaboy', 'donna'];
const PEOPLE = [
  { id: 'you', label: 'You' },
  { id: 'maya', label: 'Maya' },
  { id: 'jordan', label: 'Jordan' },
];

const rating = (
  barId: string,
  tier: BarRating['rating'],
  score?: number,
): BarRating => ({ barId, rating: tier, ratedAt: '2026-07-01T00:00:00Z', score });

describe('createSession', () => {
  it('starts in voting status with no votes cast', () => {
    const s = createSession(CANDIDATES, PEOPLE);
    expect(s.status).toBe('voting');
    expect(s.candidates).toEqual(CANDIDATES);
    expect(s.participants).toEqual(PEOPLE);
    expect(s.votes).toEqual({});
  });

  it('dedupes repeated candidates and participants', () => {
    const s = createSession(
      ['a', 'b', 'a'],
      [PEOPLE[0], PEOPLE[1], { id: 'you', label: 'Duplicate You' }],
    );
    expect(s.candidates).toEqual(['a', 'b']);
    expect(s.participants.map((p) => p.id)).toEqual(['you', 'maya']);
  });

  it('throws when there are fewer than 2 candidates or 2 participants', () => {
    expect(() => createSession(['only-one'], PEOPLE)).toThrow();
    expect(() => createSession(CANDIDATES, [PEOPLE[0]])).toThrow();
  });
});

describe('castVote', () => {
  it('records a vote without mutating the previous session', () => {
    const s0 = createSession(CANDIDATES, PEOPLE);
    const s1 = castVote(s0, 'maya', 'attaboy');
    expect(s1.votes).toEqual({ maya: 'attaboy' });
    expect(s0.votes).toEqual({});
    expect(s1.status).toBe('voting');
  });

  it('ignores unknown participants and unknown candidates', () => {
    const s0 = createSession(CANDIDATES, PEOPLE);
    expect(castVote(s0, 'stranger', 'attaboy')).toBe(s0);
    expect(castVote(s0, 'maya', 'not-a-candidate')).toBe(s0);
  });

  it('lets a participant change their vote while voting is open', () => {
    const s0 = createSession(CANDIDATES, PEOPLE);
    const s1 = castVote(s0, 'maya', 'attaboy');
    const s2 = castVote(s1, 'maya', 'donna');
    expect(s2.votes).toEqual({ maya: 'donna' });
    expect(s2.status).toBe('voting');
  });

  it('flips to decided when the final participant votes', () => {
    let s = createSession(CANDIDATES, PEOPLE);
    s = castVote(s, 'you', 'death-and-co');
    s = castVote(s, 'maya', 'death-and-co');
    expect(s.status).toBe('voting');
    s = castVote(s, 'jordan', 'attaboy');
    expect(s.status).toBe('decided');
  });

  it('ignores votes after the session is decided', () => {
    let s = createSession(CANDIDATES, PEOPLE);
    s = castVote(s, 'you', 'death-and-co');
    s = castVote(s, 'maya', 'death-and-co');
    s = castVote(s, 'jordan', 'attaboy');
    const after = castVote(s, 'jordan', 'donna');
    expect(after).toBe(s);
  });
});

describe('tally + winner', () => {
  it('ranks candidates by vote count, keeping every candidate visible', () => {
    let s = createSession(CANDIDATES, PEOPLE);
    s = castVote(s, 'you', 'attaboy');
    s = castVote(s, 'maya', 'attaboy');
    s = castVote(s, 'jordan', 'donna');
    const rows = tally(s);
    expect(rows).toEqual([
      { barId: 'attaboy', count: 2 },
      { barId: 'donna', count: 1 },
      { barId: 'death-and-co', count: 0 },
    ]);
  });

  it('breaks ties by candidate order (group ranking wins)', () => {
    let s = createSession(CANDIDATES, [PEOPLE[0], PEOPLE[1]]);
    s = castVote(s, 'you', 'donna');
    s = castVote(s, 'maya', 'death-and-co');
    // 1–1 tie: death-and-co is ranked earlier in candidates, so it leads.
    expect(tally(s)[0]).toEqual({ barId: 'death-and-co', count: 1 });
    expect(winner(s)).toBe('death-and-co');
  });

  it('returns null winner until the session is decided', () => {
    let s = createSession(CANDIDATES, PEOPLE);
    expect(winner(s)).toBeNull();
    s = castVote(s, 'you', 'attaboy');
    expect(winner(s)).toBeNull();
    s = castVote(s, 'maya', 'attaboy');
    s = castVote(s, 'jordan', 'attaboy');
    expect(winner(s)).toBe('attaboy');
  });
});

describe('pickFavorite', () => {
  it('picks the highest-scored candidate from the ratings', () => {
    const ratings = [
      rating('attaboy', 'loved', 8.4),
      rating('donna', 'loved', 9.6),
      rating('death-and-co', 'liked', 6.0),
    ];
    expect(pickFavorite(ratings, CANDIDATES)).toBe('donna');
  });

  it('never votes for a candidate the person passed on', () => {
    const ratings = [
      rating('death-and-co', 'pass', 2.0),
      rating('attaboy', 'liked', 6.2),
    ];
    expect(pickFavorite(ratings, CANDIDATES)).toBe('attaboy');
  });

  it('falls back to tier midpoints when scores are missing', () => {
    const ratings = [
      rating('death-and-co', 'liked'),
      rating('donna', 'loved'),
    ];
    expect(pickFavorite(ratings, CANDIDATES)).toBe('donna');
  });

  it('defaults to the top-ranked candidate when nothing relevant is rated', () => {
    expect(pickFavorite([], CANDIDATES)).toBe('death-and-co');
    expect(pickFavorite([rating('elsewhere', 'loved', 9.9)], CANDIDATES)).toBe(
      'death-and-co',
    );
  });
});
