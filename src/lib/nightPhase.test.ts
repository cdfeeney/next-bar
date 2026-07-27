import { describe, expect, it } from 'vitest';
import { NIGHT_PHASES, deriveNightPhase } from '@/lib/nightPhase';

const at = (hour: number, minute = 0): Date => {
  const d = new Date('2026-07-24T00:00:00'); // a Friday (local)
  d.setHours(hour, minute, 0, 0);
  return d;
};

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
    expect(deriveNightPhase({ ...base, now: at(5), wasOutLastNight: true })).toBe('recap');
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
    expect(deriveNightPhase({ ...base, now: at(4, 59), intent: 'going' })).toBe('out');
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
