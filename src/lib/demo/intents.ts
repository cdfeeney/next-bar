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

/**
 * Where each signaling friend is headed tonight — their own top-loved bar
 * (see friends.ts data), fixed so the reciprocity reveal (C1) is
 * deterministic. Only friends with an intent have a pick.
 */
const DEMO_TONIGHT_PICKS: Readonly<Record<string, string>> = {
  maya: 'death-and-co',
  jordan: 'smalls-jazz-club',
  sasha: 'mr-purple',
};

export function demoTonightPickFor(handle: string): string | null {
  return DEMO_TONIGHT_PICKS[handle] ?? null;
}
