/**
 * NYC "night" key for night-scoped social features (bar suggestions,
 * RSVPs, pin presence).
 *
 * The implementation moved to src/lib/socialNight.ts (g-31f36bf8), the
 * canonical social-night module that owns the single 6am rollover for
 * the whole codebase. This re-export keeps every existing call site
 * working; new code should import from socialNight directly.
 */

export { socialNightKey as nycNightKey } from '@/lib/socialNight';
