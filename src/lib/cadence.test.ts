import { describe, expect, it } from 'vitest';
import { isWeekendNight, tonightPrompt } from '@/lib/cadence';

// Local-time strings (no Z) so assertions don't depend on the runner's TZ.
// 2026-07-23 is a Thursday.
const THU_9PM = new Date('2026-07-23T21:00:00');
const FRI_1AM = new Date('2026-07-24T01:00:00'); // still Thursday night
const SAT_11PM = new Date('2026-07-25T23:00:00');
const SUN_1AM = new Date('2026-07-26T01:00:00'); // still Saturday night
const SUN_9PM = new Date('2026-07-26T21:00:00');
const MON_9PM = new Date('2026-07-27T21:00:00');
const WED_9PM = new Date('2026-07-29T21:00:00');

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
});
