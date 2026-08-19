import type { IntentStatus } from '@/lib/intent';
import { NIGHT_ROLLOVER_HOUR, nycHour } from '@/lib/nightKey';

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
 * localStorage, resets at the ONE rollover per R11) is the E2.4/E3.4
 * UI's concern.
 *
 * Every hour below is a NEW YORK hour, from src/lib/nightKey.ts. This module
 * used to declare its own MORNING_START = 5 and read now.getHours(), so its
 * morning boundary disagreed with the one rollover by an hour AND by a zone.
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

// Mornings begin exactly where nights end — the one rollover, not a copy of it.
const MORNING_START = NIGHT_ROLLOVER_HOUR;
const MIDDAY_START = 12;
const EVENING_START = 17;

export function deriveNightPhase(inputs: NightPhaseInputs): NightPhase {
  const { now, intent, wasOutLastNight, override } = inputs;

  // R10: the human is always right.
  if (override) return override;

  // 'not-going' is an explicit "staying in" — for phase derivation it
  // behaves like no signal at all: it must NEVER derive 'out', so the
  // 'here'/'going' branches below see null instead.
  const signal = intent === 'not-going' ? null : intent;

  // Physically at a bar tonight — the strongest signal there is.
  if (signal === 'here') return 'out';

  const hour = nycHour(now);
  if (Number.isNaN(hour)) return 'out'; // fail-safe on broken clocks

  const isMorning = hour >= MORNING_START && hour < MIDDAY_START;
  if (isMorning) return wasOutLastNight ? 'recap' : 'planning';

  const isMidday = hour >= MIDDAY_START && hour < EVENING_START;
  if (isMidday) return 'planning';

  // Evening through the rollover is 'out' — with 'starting' deleted
  // (3-phase cut) the find-a-bar home covers the whole night, signal or
  // not, and the chip fixes a wrong guess in one tap. The ONE exception
  // (QA-4 invariant): an explicit "Not tonight" never derives 'out' —
  // staying in reads as planning the next one.
  return intent === 'not-going' ? 'planning' : 'out';
}
