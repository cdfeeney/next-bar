import { describe, expect, it } from 'vitest';
import { formatGoingList, GOING_LIST_MAX_NAMES } from '@/lib/goingList';

describe('formatGoingList', () => {
  it('empty list renders nothing', () => {
    expect(formatGoingList([])).toBe('');
  });

  it('single friend is singular', () => {
    expect(formatGoingList(['Claire'])).toBe('Claire is in');
  });

  it('"You" alone is plural (second person)', () => {
    expect(formatGoingList(['You'])).toBe('You are in');
  });

  it('two and three names list everyone', () => {
    expect(formatGoingList(['You', 'Claire'])).toBe('You, Claire are in');
    expect(formatGoingList(['You', 'Claire', 'Sam'])).toBe(
      'You, Claire, Sam are in',
    );
  });

  it('past the cap collapses to +N others', () => {
    expect(formatGoingList(['You', 'Claire', 'Sam', 'Dev'])).toBe(
      'You, Claire, Sam +1 other are in',
    );
    expect(formatGoingList(['You', 'Claire', 'Sam', 'Dev', 'Mo', 'Ana'])).toBe(
      'You, Claire, Sam +3 others are in',
    );
  });

  it('cap constant matches the documented UI bound', () => {
    expect(GOING_LIST_MAX_NAMES).toBe(3);
  });
});
