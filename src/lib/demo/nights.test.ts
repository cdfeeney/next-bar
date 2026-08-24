import { describe, expect, it } from 'vitest';
import { demoShareId, demoSharedNight } from './nights';
import { demoFriends } from './friends';

/**
 * Feed's `View night` points at the bearer-token route, which can only answer
 * for real rows — so a seeded memory needs this fallback or the action is a
 * guaranteed dead end for every card on the surface.
 */
describe('demoSharedNight', () => {
  it('resolves the share id every seeded memory carries', () => {
    for (const friend of demoFriends) {
      const night = demoSharedNight(demoShareId(friend.handle));
      expect(night, friend.handle).not.toBeNull();
      expect(night?.handle).toBe(friend.handle);
      expect(night?.barIds.length).toBeGreaterThan(0);
      expect(night?.night).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('is deterministic — the same night on every read', () => {
    const first = demoSharedNight(demoShareId('claire'));
    const second = demoSharedNight(demoShareId('claire'));
    expect(first).toEqual(second);
  });

  it('answers null for anything that is not a seeded id', () => {
    // A real bearer token must still take the database path, untouched.
    expect(demoSharedNight('7f1a2b3c-4d5e-6f70-8192-a3b4c5d6e7f8')).toBeNull();
    expect(demoSharedNight('demo-nobody')).toBeNull();
    expect(demoSharedNight('')).toBeNull();
  });
});
