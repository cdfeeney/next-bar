'use client';

import type { Radius } from '@/types';
import { RADIUS_ANYWHERE, RADIUS_CAB, RADIUS_WALK } from '@/lib/constants';

type DistanceChipsProps = {
  value: Radius;
  onChange: (next: Radius) => void;
};

type Chip = {
  kind: Radius['kind'];
  label: string;
  toRadius: () => Radius;
};

/**
 * E3.2: distance as intent — "Walkable" / "Worth a cab" — with the
 * "Anywhere" escape hatch (R5). Replaces RadiusSlider (deleted); same
 * group semantics on the results surface, live re-rank on tap (R8).
 */
const CHIPS: Chip[] = [
  {
    kind: 'walking',
    label: 'Walkable',
    toRadius: () => ({ kind: 'walking', maxMiles: RADIUS_WALK }),
  },
  {
    kind: 'cab',
    label: 'Worth a cab',
    toRadius: () => ({ kind: 'cab', maxMiles: RADIUS_CAB }),
  },
  {
    kind: 'anywhere',
    label: 'Anywhere',
    toRadius: () => ({ kind: 'anywhere', maxMiles: RADIUS_ANYWHERE }),
  },
];

export default function DistanceChips({ value, onChange }: DistanceChipsProps) {
  return (
    <div
      role="group"
      aria-label="Search radius"
      className="flex bg-surface border border-border rounded-full p-1 max-w-md mx-auto"
    >
      {CHIPS.map((chip) => {
        const isActive = value.kind === chip.kind;
        return (
          <button
            key={chip.kind}
            type="button"
            aria-pressed={isActive}
            onClick={() => onChange(chip.toRadius())}
            className={[
              'flex-1 min-h-[44px] touch-manipulation rounded-full font-display text-sm md:text-base transition-colors',
              isActive ? 'bg-accent text-bg' : 'text-text hover:text-accent',
            ].join(' ')}
          >
            {chip.label}
          </button>
        );
      })}
    </div>
  );
}
