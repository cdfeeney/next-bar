/**
 * Shared motion tokens (goal g-f9a3e003). One vocabulary for durations,
 * eases, and the standard step transition so animation timing is a design
 * decision, not a per-component magic number. Consumed via `motion/react`
 * (the supported successor package to framer-motion — see
 * https://motion.dev/docs/react-upgrade-guide).
 */

export const MOTION_DURATIONS = {
  /** Fast state feedback (taps, toggles). */
  fast: 0.15,
  /** Standard step/screen transition — the quiz's historical 0.25s. */
  step: 0.25,
  /** Deliberate emphasis (rarely; prefer step). */
  slow: 0.4,
} as const;

export const MOTION_EASES = {
  /** framer/motion default easing — keep unless a surface needs otherwise. */
  standard: 'easeOut',
} as const;

/** The quiz step enter/exit transition, exactly as shipped pre-migration. */
export const STEP_TRANSITION = { duration: MOTION_DURATIONS.step } as const;
