import type { SharedNight } from '@/lib/nights.server';
import { findDemoFriend } from './friends';

/**
 * A shared night for a SEEDED profile.
 *
 * `/u/[handle]` already falls back to the demo catalogue when a handle has no
 * server profile — seeded curators are not real accounts, so nothing about
 * them is ever in the database. Feed memories are seeded from those same
 * profiles, and their `View night` action pointed at a bearer-token route that
 * can only answer for real rows: every one of them was a guaranteed dead end.
 * This is the same fallback the profile page keeps, for the same reason.
 *
 * Share ids are prefixed so the fallback can never collide with a real token
 * (`isShareToken` accepts UUIDs only), and the token path is untouched: no
 * database read is skipped, no id is enumerable that `/u/<handle>` does not
 * already serve in full.
 */
const DEMO_SHARE_PREFIX = 'demo-';

/** The share id a seeded memory carries. */
export function demoShareId(handle: string): string {
  return `${DEMO_SHARE_PREFIX}${handle}`;
}

/** Build the seeded night behind a demo share id, or null if there is none. */
export function demoSharedNight(shareId: string): SharedNight | null {
  if (!shareId.startsWith(DEMO_SHARE_PREFIX)) return null;
  const friend = findDemoFriend(shareId.slice(DEMO_SHARE_PREFIX.length));
  if (friend === undefined) return null;

  // Deterministic: the friend's own fixed rating timestamps, never a clock, so
  // the page renders the same night on every visit and in every test run.
  const stops = friend.ratings
    .slice()
    .sort((a, b) => Date.parse(b.ratedAt) - Date.parse(a.ratedAt))
    .slice(0, 3);
  if (stops.length === 0) return null;
  const latest = stops[0].ratedAt;
  const loved = stops.find((stop) => stop.rating === 'loved') ?? null;

  return {
    handle: friend.handle,
    displayName: friend.displayName,
    night: latest.slice(0, 10),
    barIds: stops.map((stop) => stop.barId),
    lovedBarId: loved?.barId ?? null,
    sharedAt: latest,
  };
}
