/**
 * Demo social layer — public surface.
 *
 * Everything here is backend-free seeded data + pure helpers so the Friends,
 * Consensus, and Rankings experiences are fully demonstrable with zero setup
 * (no Supabase, no sign-in). See the individual modules for rationale.
 */

import type { Bar } from '@/types';
import type { BarRating } from '@/types/ratings';
import { bars } from '@/lib/bars';
import type { DemoFriend } from './friends';

export { demoFriends, findDemoFriend } from './friends';
export { demoIntentFor, demoTonightPickFor } from './intents';
export type { DemoFriend } from './friends';
export {
  computeConsensus,
} from './consensus';
export type {
  ConsensusParticipant,
  ConsensusEntry,
  ConsensusVote,
  ConsensusResult,
} from './consensus';
export {
  SAMPLE_NIGHT,
  isDemoSeeded,
  seedSampleNight,
  clearSampleNight,
} from './seed';

const barsById = new Map<string, Bar>(bars.map((b) => [b.id, b]));

export function barById(id: string): Bar | undefined {
  return barsById.get(id);
}

/** A friend's ratings sorted high→low, resolved to bars (drops unknown ids). */
export function topRatedBars(
  friend: DemoFriend,
  limit = Infinity,
): Array<{ rating: BarRating; bar: Bar }> {
  return friend.ratings
    .slice()
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .map((rating) => {
      const bar = barsById.get(rating.barId);
      return bar ? { rating, bar } : null;
    })
    .filter((x): x is { rating: BarRating; bar: Bar } => x !== null)
    .slice(0, limit);
}

/** Count of loved/liked entries — used for friend cards' social proof. */
export function lovedCount(friend: DemoFriend): number {
  return friend.ratings.filter((r) => r.rating === 'loved').length;
}
