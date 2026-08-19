import { describe, expect, it } from 'vitest';
import { isWeekendNight, tonightPrompt } from '@/lib/cadence';

// ABSOLUTE instants (Z), never local-time strings. The rollover is defined in
// America/New_York, so a bare '2026-07-23T21:00:00' means a different NYC wall
// clock on every runner — these assertions would then pass or fail by machine.
// July is EDT (UTC-4), so NYC wall clock + 4h = the Z value below.
// 2026-07-23 is a Thursday.
const THU_9PM = new Date('2026-07-24T01:00:00Z'); // Thu 9pm NYC
const FRI_1AM = new Date('2026-07-24T05:00:00Z'); // Fri 1am NYC — still Thursday night
const SAT_11PM = new Date('2026-07-26T03:00:00Z'); // Sat 11pm NYC
const SUN_1AM = new Date('2026-07-26T05:00:00Z'); // Sun 1am NYC — still Saturday night
const SUN_9PM = new Date('2026-07-27T01:00:00Z'); // Sun 9pm NYC
const MON_9PM = new Date('2026-07-28T01:00:00Z'); // Mon 9pm NYC
const WED_9PM = new Date('2026-07-30T01:00:00Z'); // Wed 9pm NYC

describe('isWeekendNight', () => {
  it('is on for Thursday through Saturday evenings', () => {
    expect(isWeekendNight(THU_9PM)).toBe(true);
    expect(isWeekendNight(SAT_11PM)).toBe(true);
  });

  it('keeps the small hours attached to the previous night', () => {
    expect(isWeekendNight(FRI_1AM)).toBe(true); // Thursday night, 1am
    expect(isWeekendNight(SUN_1AM)).toBe(true); // Saturday night, 1am
  });

  it('is off Sunday through Wednesday', () => {
    expect(isWeekendNight(SUN_9PM)).toBe(false);
    expect(isWeekendNight(MON_9PM)).toBe(false);
    expect(isWeekendNight(WED_9PM)).toBe(false);
  });
});

describe('tonightPrompt', () => {
  it('names the night on weekend nights', () => {
    expect(tonightPrompt(THU_9PM)).toMatch(/Thursday/);
    expect(tonightPrompt(SAT_11PM)).toMatch(/Saturday/);
    // 1am Sunday is still Saturday night.
    expect(tonightPrompt(SUN_1AM)).toMatch(/Saturday/);
  });

  it('is null off-nights (no fake urgency midweek)', () => {
    expect(tonightPrompt(MON_9PM)).toBeNull();
    expect(tonightPrompt(WED_9PM)).toBeNull();
  });

  it('flips the named night exactly at the 6am NYC boundary (F5 rollover)', () => {
    // 2026-07-24 is a Friday: 5:59am NYC is still Thursday night…
    expect(tonightPrompt(new Date('2026-07-24T09:59:00Z'))).toMatch(/Thursday/);
    // …and 6:00am NYC starts Friday.
    expect(tonightPrompt(new Date('2026-07-24T10:00:00Z'))).toMatch(/Friday/);
  });
});
