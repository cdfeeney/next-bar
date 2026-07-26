import type { IntentStatus } from '@/lib/intent';

/**
 * nightPhase — derive which phase of a night out the user is in (E0.3).
 * Drives the adaptive HOME (locked decision 1: content + primary CTA
 * change by phase; the 5-tab nav never does).
 *
 * Load-bearing requirement is WRONG-PHASE RECOVERY, not clever
 * detection (DESIGN-SYSTEM R10): the manual override always wins, weak
 * signals never flip to a more specific phase, and every ambiguous or
 * broken input degrades to 'starting' — the phase whose home is useful
 * at any hour.
 *
 * Pure function; persistence of the override (nightKey-scoped
 * localStorage, resets at the 5am rollover per R11) is the E2.4/E3.4
 * UI's concern.
 */

export type NightPhase = 'planning' | 'starting' | 'out' | 'recap';

/** Chip cycle order for the phase switcher. */
export const NIGHT_PHASES: readonly NightPhase[] = [
  'planning',
  'starting',
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
const LATE_START = 21;

export function deriveNightPhase(inputs: NightPhaseInputs): NightPhase {
  const { now, intent, wasOutLastNight, override } = inputs;

  // R10: the human is always right.
  if (override) return override;

  // Physically at a bar tonight — the strongest signal there is.
  if (intent === 'here') return 'out';

  const hour = now.getHours();
  if (Number.isNaN(hour)) return 'starting'; // fail-safe on broken clocks

  const isMorning = hour >= MORNING_START && hour < MIDDAY_START;
  if (isMorning) return wasOutLastNight ? 'recap' : 'planning';

  const isMidday = hour >= MIDDAY_START && hour < EVENING_START;
  if (isMidday) return 'planning';

  // Evening through the rollover. Committed ("going") users flip to
  // 'out' once the night is properly on; "maybe" is not commitment and
  // no-signal stays 'starting' — its home works at any hour, and the
  // chip fixes a wrong guess in one tap.
  const isLate = hour >= LATE_START || hour < MORNING_START;
  if (isLate && intent === 'going') return 'out';

  return 'starting';
}
