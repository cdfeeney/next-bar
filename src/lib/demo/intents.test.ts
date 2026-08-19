import { describe, expect, it } from 'vitest';
import { demoFriends } from './friends';
import { demoIntentFor, demoTonightPickFor } from './intents';
import { barById } from './index';

// ABSOLUTE instants (Z): the rollover is an America/New_York rule, so a bare
// local literal names a different NYC wall clock per runner. July is EDT
// (UTC-4) — NYC wall clock + 4h = the Z value. 2026-07-23 is a Thursday.
const THU = new Date('2026-07-24T01:00:00Z'); // Thu 9pm NYC
const FRI = new Date('2026-07-25T02:00:00Z'); // Fri 10pm NYC
const FRI_LATER = new Date('2026-07-25T03:30:00Z'); // Fri 11:30pm NYC
const SAT_1AM = new Date('2026-07-25T05:00:00Z'); // Sat 1am NYC — still Friday night
const SAT = new Date('2026-07-26T03:00:00Z'); // Sat 11pm NYC
const MON = new Date('2026-07-28T01:00:00Z'); // Mon 9pm NYC

function nightSnapshot(night: Date): string {
  return demoFriends.map((f) => demoIntentFor(f.handle, night)).join(',');
}

/** Mon 2026-07-27 through Sun 2026-08-02, all at 9pm NYC. */
function weekOfNights(): Date[] {
  return Array.from({ length: 7 }, (_, i) => {
    const night = new Date('2026-07-28T01:00:00Z');
    night.setUTCDate(night.getUTCDate() + i);
    return night;
  });
}

describe('demoIntentFor', () => {
  it('varies by night — not the same trio every single night (F3)', () => {
    const snapshots = [THU, FRI, SAT, MON].map(nightSnapshot);
    expect(new Set(snapshots).size).toBeGreaterThan(1);
  });

  it('is deterministic within a night (no randomness)', () => {
    expect(nightSnapshot(FRI)).toBe(nightSnapshot(FRI_LATER));
  });

  it('keeps the small hours on the previous night (NYC 6am rollover)', () => {
    expect(nightSnapshot(SAT_1AM)).toBe(nightSnapshot(FRI));
  });

  it('always has at least one friend signaling on weekend nights', () => {
    for (const night of [THU, FRI, SAT]) {
      const signaling = demoFriends.filter(
        (f) => demoIntentFor(f.handle, night) !== null,
      );
      expect(signaling.length).toBeGreaterThan(0);
    }
  });

  it('gives every friend at least one silent night a week', () => {
    const week = weekOfNights();
    for (const friend of demoFriends) {
      const silentNights = week.filter(
        (night) => demoIntentFor(friend.handle, night) === null,
      );
      expect(
        silentNights.length,
        `${friend.handle} signals every night — reads as fake`,
      ).toBeGreaterThan(0);
    }
  });

  it('returns null for unknown handles', () => {
    expect(demoIntentFor('nobody', FRI)).toBeNull();
  });
});

describe('demoTonightPickFor', () => {
  it('resolves every possible signaling friend to a real bar', () => {
    // Any friend who can ever signal needs a pick, and it must exist in
    // the bars dataset (a typo would silently drop the reveal).
    const week = weekOfNights();
    for (const friend of demoFriends) {
      const everSignals = week.some(
        (night) => demoIntentFor(friend.handle, night) !== null,
      );
      if (!everSignals) continue;
      const pickId = demoTonightPickFor(friend.handle);
      expect(pickId, `${friend.handle} has no tonight pick`).not.toBeNull();
      expect(
        barById(pickId as string),
        `${friend.handle} picks unknown bar ${pickId}`,
      ).toBeDefined();
    }
  });

  it('returns null for unknown handles', () => {
    expect(demoTonightPickFor('nobody')).toBeNull();
  });
});
