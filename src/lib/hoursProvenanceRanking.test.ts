import { describe, expect, test } from 'vitest';
import type { Bar, WeeklyHours } from '@/types';
import { unverifiedHoursAdjustment } from '@/lib/matching';
import { UNVERIFIED_HOURS_PENALTY } from '@/lib/constants';

/**
 * Criterion 9, second half: normal ranking must DE-PRIORITISE venues whose
 * hours we are not entitled to rely on — not exclude them.
 *
 * Why this is a nudge and not a sink: 1,192 of 1,265 catalog venues (94%)
 * carry Google-derived hours. A hard partition would bury the catalog and
 * show every user the same ~73 venues. So the penalty sits at tie-breaker
 * scale, below the late-night nudge (0.06), where it decides near-ties and
 * nothing else.
 */

const bar = (overrides: Partial<Bar>): Bar =>
  ({
    id: 'x',
    name: 'X',
    neighborhood: 'LES',
    address: '1 Test St',
    lat: 40.72,
    lng: -73.99,
    tags: ['dive'],
    priceTier: 1,
    blurb: 'test',
    lastVerified: '2026-04-01',
    ...overrides,
  }) as Bar;

const THU: WeeklyHours = { 4: [{ open: '17:00', close: '02:00' }] } as unknown as WeeklyHours;

describe('unverifiedHoursAdjustment (criterion 9 de-prioritisation)', () => {
  test('no penalty for hours we can vouch for', () => {
    expect(unverifiedHoursAdjustment(bar({ hours: THU, hoursConfidence: 'verified' }))).toBe(0);
    expect(unverifiedHoursAdjustment(bar({ hours: THU, hoursConfidence: 'reported' }))).toBe(0);
  });

  test('penalises Google-derived (unverified) hours', () => {
    expect(unverifiedHoursAdjustment(bar({ hours: THU, hoursConfidence: 'unverified' }))).toBe(
      -UNVERIFIED_HOURS_PENALTY,
    );
  });

  test('penalises legacy rows whose provenance is absent entirely', () => {
    expect(unverifiedHoursAdjustment(bar({ hours: THU }))).toBe(-UNVERIFIED_HOURS_PENALTY);
  });

  test('penalises a bar with no hours at all', () => {
    expect(unverifiedHoursAdjustment(bar({}))).toBe(-UNVERIFIED_HOURS_PENALTY);
  });

  test('stays strictly below the late-night nudge so it only decides near-ties', () => {
    expect(UNVERIFIED_HOURS_PENALTY).toBeGreaterThan(0);
    expect(UNVERIFIED_HOURS_PENALTY).toBeLessThan(0.06);
  });
});
