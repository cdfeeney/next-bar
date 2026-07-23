/**
 * Seeded "tonight" intents for the demo friends — blueprint B2.
 *
 * Deterministic (no Date/randomness) so the Friends surface always shows a
 * live-feeling mix: someone's out, someone's on the fence, someone's silent.
 * Real friends' intents sync in the D1 Supabase pass.
 */

import type { IntentStatus } from '@/lib/intent';

const DEMO_INTENTS: Readonly<Record<string, IntentStatus>> = {
  maya: 'going',
  jordan: 'maybe',
  sasha: 'here',
  // dev: intentionally absent — not every friend signals every night.
};

export function demoIntentFor(handle: string): IntentStatus | null {
  return DEMO_INTENTS[handle] ?? null;
}
