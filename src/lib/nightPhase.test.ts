import { describe, expect, it } from 'vitest';
import { NIGHT_PHASES, deriveNightPhase } from '@/lib/nightPhase';

// A NEW YORK wall clock on Friday 2026-07-24, as an ABSOLUTE instant. The
// phase hours resolve in America/New_York (the one rollover), so building
// these with setHours() would have asked the runner's zone instead and made
// every boundary assertion below zone-dependent. July is EDT, UTC-4.
const at = (hour: number, minute = 0): Date =>
  new Date(Date.UTC(2026, 6, 24, hour + 4, minute, 0, 0));

const base = { intent: null, override: null, wasOutLastNight: false } as const;

describe('deriveNightPhase (E0.3)', () => {
  it('manual override ALWAYS wins, any hour, any signals (R10)', () => {
    for (const phase of NIGHT_PHASES) {
      expect(
        deriveNightPhase({ now: at(3), intent: 'here', wasOutLastNight: true, override: phase }),
      ).toBe(phase);
      expect(deriveNightPhase({ ...base, now: at(14), override: phase })).toBe(phase);
    }
  });

  it('"here" intent means OUT regardless of hour', () => {
    expect(deriveNightPhase({ ...base, now: at(15), intent: 'here' })).toBe('out');
    expect(deriveNightPhase({ ...base, now: at(23), intent: 'here' })).toBe('out');
    expect(deriveNightPhase({ ...base, now: at(2), intent: 'here' })).toBe('out');
  });

  it('morning after a night out is RECAP; otherwise mornings PLAN', () => {
    expect(deriveNightPhase({ ...base, now: at(9), wasOutLastNight: true })).toBe('recap');
    // The morning starts at the ONE rollover, 4:00 AM NYC (V8-R-PRE-005).
    // MORNING_START is derived from NIGHT_ROLLOVER_HOUR, so this boundary
    // MOVES with it — that is why this test is pinned at the minute.
    // 3:59am is still the night you are having, not the morning after it.
    expect(deriveNightPhase({ ...base, now: at(3, 59), wasOutLastNight: true })).toBe('out');
    expect(deriveNightPhase({ ...base, now: at(4), wasOutLastNight: true })).toBe('recap');
    // 5:59am is morning too — the retired 6am rule called this 'out'.
    expect(deriveNightPhase({ ...base, now: at(5, 59), wasOutLastNight: true })).toBe('recap');
    expect(deriveNightPhase({ ...base, now: at(9) })).toBe('planning');
    expect(deriveNightPhase({ ...base, now: at(11, 59), wasOutLastNight: true })).toBe('recap');
  });

  it('midday is PLANNING, evening onward is OUT (3-phase cut: starting is gone)', () => {
    expect(deriveNightPhase({ ...base, now: at(12) })).toBe('planning');
    expect(deriveNightPhase({ ...base, now: at(16, 59) })).toBe('planning');
    expect(deriveNightPhase({ ...base, now: at(17) })).toBe('out');
    expect(deriveNightPhase({ ...base, now: at(20, 59) })).toBe('out');
  });

  it('late night is OUT with or without intent; the rollover keeps 3am in the night', () => {
    expect(deriveNightPhase({ ...base, now: at(21), intent: 'going' })).toBe('out');
    expect(deriveNightPhase({ ...base, now: at(23, 30), intent: 'going' })).toBe('out');
    expect(deriveNightPhase({ ...base, now: at(3), intent: 'going' })).toBe('out');
    // 3:59am is the last minute of the night; 4:00 is the morning after.
    expect(deriveNightPhase({ ...base, now: at(3, 59), intent: 'going' })).toBe('out');
    // No-signal / "maybe" nights derive OUT too — the find-a-bar home is
    // the fail-safe surface now that 'starting' is deleted.
    expect(deriveNightPhase({ ...base, now: at(23) })).toBe('out');
    expect(deriveNightPhase({ ...base, now: at(2) })).toBe('out');
    expect(deriveNightPhase({ ...base, now: at(23), intent: 'maybe' })).toBe('out');
  });

  it("'not-going' NEVER derives OUT (QA4) — evenings read as planning in the 3-phase world", () => {
    // Late/evening: everyone else derives 'out'; an explicit "Not
    // tonight" stays on planning instead.
    expect(deriveNightPhase({ ...base, now: at(21), intent: 'not-going' })).toBe('planning');
    expect(deriveNightPhase({ ...base, now: at(23), intent: 'not-going' })).toBe('planning');
    expect(deriveNightPhase({ ...base, now: at(3), intent: 'not-going' })).toBe('planning');
    expect(deriveNightPhase({ ...base, now: at(17), intent: 'not-going' })).toBe('planning');
    // Midday unchanged.
    expect(deriveNightPhase({ ...base, now: at(15), intent: 'not-going' })).toBe('planning');
    // Mornings still follow wasOutLastNight, not the stale pill.
    expect(deriveNightPhase({ ...base, now: at(9), intent: 'not-going' })).toBe('planning');
    expect(
      deriveNightPhase({ ...base, now: at(9), intent: 'not-going', wasOutLastNight: true }),
    ).toBe('recap');
  });

  it('fail-safe: garbage input degrades to OUT, never throws', () => {
    expect(deriveNightPhase({ ...base, now: new Date('invalid') })).toBe('out');
  });
});
