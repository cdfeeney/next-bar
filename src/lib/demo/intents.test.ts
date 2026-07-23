import { describe, expect, it } from 'vitest';
import { demoFriends } from './friends';
import { demoIntentFor, demoTonightPickFor } from './intents';
import { barById } from './index';

// Local-time strings (no Z) so assertions don't depend on the runner's TZ.
// 2026-07-23 is a Thursday.
const THU = new Date('2026-07-23T21:00:00');
const FRI = new Date('2026-07-24T22:00:00');
const FRI_LATER = new Date('2026-07-24T23:30:00');
const SAT_1AM = new Date('2026-07-25T01:00:00'); // still Friday night
const SAT = new Date('2026-07-25T23:00:00');
const MON = new Date('2026-07-27T21:00:00');

function nightSnapshot(night: Date): string {
  return demoFriends.map((f) => demoIntentFor(f.handle, night)).join(',');
}

/** Mon 2026-07-27 through Sun 2026-08-02, all at 9pm local. */
function weekOfNights(): Date[] {
  return Array.from({ length: 7 }, (_, i) => {
    const night = new Date('2026-07-27T21:00:00');
    night.setDate(night.getDate() + i);
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

  it('keeps the small hours on the previous night (5am rollover)', () => {
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
