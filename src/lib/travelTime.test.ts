import { describe, it, expect } from 'vitest';
import { walkMinutes, uberMinutes, leadCopy } from '@/lib/travelTime';

describe('walkMinutes', () => {
  it('returns ~10 for 0.5 miles (Math.round(0.5 * 20))', () => {
    expect(walkMinutes(0.5)).toBe(10);
  });

  it('returns 1 for 0 miles (Math.max floor prevents 0)', () => {
    expect(walkMinutes(0)).toBe(1);
  });

  it('returns 20 for 1.0 mile', () => {
    expect(walkMinutes(1.0)).toBe(20);
  });

  it('returns 1 for very small distance (floor at 1)', () => {
    expect(walkMinutes(0.001)).toBe(1);
  });
});

describe('uberMinutes', () => {
  it('returns 12 for 2 miles (Math.round(2 * 6))', () => {
    expect(uberMinutes(2)).toBe(12);
  });

  it('returns 18 for 3 miles', () => {
    expect(uberMinutes(3)).toBe(18);
  });

  it('returns 1 for 0 miles (floor at 1)', () => {
    expect(uberMinutes(0)).toBe(1);
  });
});

describe('leadCopy', () => {
  it('returns walk result for 0.5 miles', () => {
    const result = leadCopy(0.5);
    expect(result).toEqual({ kind: 'walk', minutes: 10, text: '~10 min walk' });
  });

  it('returns walk result at exactly 1.0 mile (boundary inclusive on walk side)', () => {
    const result = leadCopy(1.0);
    expect(result.kind).toBe('walk');
    expect((result as { kind: 'walk'; minutes: number; text: string }).minutes).toBe(20);
    expect(result.text).toBe('~20 min walk');
  });

  it('flips to uber at 1.01 miles', () => {
    const result = leadCopy(1.01);
    expect(result.kind).toBe('uber');
    expect(result.text).toContain('min by Uber');
  });

  it('returns uber result for 3.0 miles', () => {
    const result = leadCopy(3.0);
    expect(result).toEqual({ kind: 'uber', minutes: 18, text: '~18 min by Uber' });
  });

  it('returns neighborhood fallback when miles is null and no neighborhood provided', () => {
    const result = leadCopy(null);
    expect(result).toEqual({ kind: 'neighborhood', text: 'Pick a neighborhood' });
  });

  it('returns "In Midtown" when miles is null and neighborhood is "Midtown"', () => {
    const result = leadCopy(null, 'Midtown');
    expect(result).toEqual({ kind: 'neighborhood', text: 'In Midtown' });
  });

  it('returns "In East Village" when miles is null and neighborhood is "East Village"', () => {
    const result = leadCopy(null, 'East Village');
    expect(result).toEqual({ kind: 'neighborhood', text: 'In East Village' });
  });
});
