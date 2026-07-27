import { describe, expect, test } from 'vitest';
import { displayHood, hoodDisplayCoverage } from './hoodDisplay';

describe('hoodDisplay (operator 2026-07-27: spell out abbreviations)', () => {
  test('abbreviated hoods spell out', () => {
    expect(displayHood('LES')).toBe('Lower East Side');
    expect(displayHood('UWS')).toBe('Upper West Side');
    expect(displayHood('UES')).toBe('Upper East Side');
    expect(displayHood('FiDi')).toBe('Financial District');
    expect(displayHood('LIC')).toBe('Long Island City');
  });

  test('already-full names pass through unchanged', () => {
    expect(displayHood("Hell's Kitchen")).toBe("Hell's Kitchen");
    expect(displayHood('Williamsburg')).toBe('Williamsburg');
  });

  test('the display map exactly tracks the service area', () => {
    const { missing, extra } = hoodDisplayCoverage();
    expect(missing).toEqual([]);
    expect(extra).toEqual([]);
  });
});
