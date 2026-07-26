import { describe, expect, it } from 'vitest';
import { AXIS_ORDER, VIBE_AXES, axisOf, type VibeAxis } from '@/lib/vibeAxes';
import { TAG_VOCABULARY } from '@/lib/catalog';

describe('vibeAxes (E0.2)', () => {
  it('partitions the ENTIRE vocabulary — every tag in exactly one axis', () => {
    const seen = new Map<string, VibeAxis>();
    for (const axis of AXIS_ORDER) {
      for (const tag of VIBE_AXES[axis]) {
        expect(seen.has(tag), `${tag} appears in both ${seen.get(tag)} and ${axis}`).toBe(false);
        seen.set(tag, axis);
      }
    }
    // Total coverage: nothing missing, nothing extra.
    expect([...seen.keys()].sort()).toEqual([...TAG_VOCABULARY].sort());
  });

  it('axisOf round-trips membership for every tag', () => {
    for (const tag of TAG_VOCABULARY) {
      const axis = axisOf(tag);
      expect(VIBE_AXES[axis]).toContain(tag);
    }
  });

  it('AXIS_ORDER lists all six axes exactly once', () => {
    expect([...AXIS_ORDER].sort()).toEqual(
      ['Drink', 'Energy', 'Scene', 'Setting', 'Sound', 'Spend'].sort(),
    );
    expect(new Set(AXIS_ORDER).size).toBe(AXIS_ORDER.length);
  });

  it('Spend is exactly the price ladder in ascending order', () => {
    expect(VIBE_AXES.Spend).toEqual(['cheap', 'mid', 'pricey', 'splurge']);
  });
});
