import type { IntentStatus } from '@/lib/intent';

/**
 * nightPhase — derive which phase of a night out the user is in (E0.3).
 * Drives the adaptive HOME (locked decision 1: content + primary CTA
 * change by phase; the 5-tab nav never does).
 *
 * Load-bearing requirement is WRONG-PHASE RECOVERY, not clever
 * detection (DESIGN-SYSTEM R10): the manual override always wins, and
 * every ambiguous or broken input degrades to 'out' — its home IS the
 * find-a-bar flow, which is useful at any hour.
 *
 * 2026-07-26 operator cut: the phase set is THREE — 'starting' is
 * deleted (only Planning / Out now / Last night matter). Everything the
 * old 'starting' covered (evening, no-signal late night, fail-safes)
 * now derives 'out'.
 *
 * Pure function; persistence of the override (nightKey-scoped
 * localStorage, resets at the 5am rollover per R11) is the E2.4/E3.4
 * UI's concern.
 */

export type NightPhase = 'planning' | 'out' | 'recap';

/** Display order for the phase switcher's picker (R10: all three are one
 *  tap away once the chip is open — it's a picker, not a cycler). */
export const NIGHT_PHASES: readonly NightPhase[] = [
  'planning',
  'out',
  'recap',
];

export type NightPhaseInputs = {
  now: Date;
  /** Tonight's intent, already night-scoped by loadIntent(); null = none. */
  intent: IntentStatus | null;
  /** Did last night involve going out? (E4.1's Night object feeds this;
   * until then callers derive it from the previous night's intent.) */
  wasOutLastNight: boolean;
  /** The user's explicit phase choice for THIS night, or null. */
  override: NightPhase | null;
};

const MORNING_START = 5; // the rollover hour — mornings begin where nights end
const MIDDAY_START = 12;
const EVENING_START = 17;

export function deriveNightPhase(inputs: NightPhaseInputs): NightPhase {
  const { now, intent, wasOutLastNight, override } = inputs;

  // R10: the human is always right.
  if (override) return override;

  // Physically at a bar tonight — the strongest signal there is.
  if (intent === 'here') return 'out';

  const hour = now.getHours();
  if (Number.isNaN(hour)) return 'out'; // fail-safe on broken clocks

  const isMorning = hour >= MORNING_START && hour < MIDDAY_START;
  if (isMorning) return wasOutLastNight ? 'recap' : 'planning';

  const isMidday = hour >= MIDDAY_START && hour < EVENING_START;
  if (isMidday) return 'planning';

  // Evening through the rollover is 'out' — with 'starting' deleted
  // (3-phase cut) the find-a-bar home covers the whole night, signal or
  // not, and the chip fixes a wrong guess in one tap.
  return 'out';
}
