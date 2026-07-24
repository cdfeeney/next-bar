/**
 * Seeded "tonight" intents for the demo friends — blueprint B2.
 *
 * Day-varying but deterministic (audit F3): each friend follows a fixed
 * weekly rhythm keyed off the effective night (same 5am rollover as
 * src/lib/intent.ts), so "Claire is going out tonight" is no longer true
 * EVERY night, yet the surface stays reproducible — no Date.now() or
 * randomness at module scope; callers pass the current date in. The UI
 * labels these rows "demo" so they can't be mistaken for real people.
 * Real friends' intents sync in the D1 Supabase pass.
 */

import { effectiveNight } from '@/lib/cadence';
import type { IntentStatus } from '@/lib/intent';

/**
 * Per-friend weekly rhythm, indexed by the effective night's day
 * (0 = Sunday … 6 = Saturday). Friday keeps the original demo trio
 * (Claire out, John on the fence, Sasha already there); midweek is
 * quieter; every friend has silent nights so the mix reads sample-ish,
 * not fabricated. Every night still has at least one signal so the
 * Friends surface never demos dead-empty.
 */
const WEEKLY_INTENTS: Readonly<
  Record<string, ReadonlyArray<IntentStatus | null>>
> = {
  //         Sun      Mon      Tue      Wed      Thu      Fri      Sat
  claire:   [  null,    null,   'maybe',  null,   'going', 'going',  null  ],
  john: [  null,   'maybe',  null,   'going',  null,   'maybe', 'here' ],
  sasha:  [ 'maybe',  null,    null,    null,   'maybe', 'here',  'going'],
  dev:    [  null,    null,    null,    null,    null,    null,   'maybe'],
};

/** The demo intent a friend shows for the night containing `now`, if any. */
export function demoIntentFor(
  handle: string,
  now: Date,
): IntentStatus | null {
  const rhythm = WEEKLY_INTENTS[handle];
  if (!rhythm) return null;
  return rhythm[effectiveNight(now).getDay()] ?? null;
}

/**
 * Where each friend is headed when they signal — their own top-loved bar
 * (see friends.ts data), fixed so the reciprocity reveal (C1) is
 * deterministic. Only surfaces for friends whose intent is non-null.
 */
const DEMO_TONIGHT_PICKS: Readonly<Record<string, string>> = {
  claire: 'death-and-co',
  john: 'smalls-jazz-club',
  sasha: 'mr-purple',
  dev: '169-bar',
};

export function demoTonightPickFor(handle: string): string | null {
  return DEMO_TONIGHT_PICKS[handle] ?? null;
}
