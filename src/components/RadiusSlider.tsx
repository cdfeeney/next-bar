'use client';

import type { Radius } from '@/types';
import {
  RADIUS_ANYWHERE,
  RADIUS_SHORT_UBER,
  RADIUS_WALK,
} from '@/lib/constants';

type RadiusSliderProps = {
  value: Radius;
  onChange: (next: Radius) => void;
};

type Segment = {
  kind: Radius['kind'];
  label: string;
  toRadius: () => Radius;
};

const SEGMENTS: Segment[] = [
  {
    kind: 'walking',
    label: 'Walking',
    toRadius: () => ({ kind: 'walking', maxMiles: RADIUS_WALK }),
  },
  {
    kind: 'shortUber',
    label: 'Short Uber',
    toRadius: () => ({ kind: 'shortUber', maxMiles: RADIUS_SHORT_UBER }),
  },
  {
    kind: 'anywhere',
    label: 'Anywhere',
    toRadius: () => ({ kind: 'anywhere', maxMiles: RADIUS_ANYWHERE }),
  },
];

export default function RadiusSlider({ value, onChange }: RadiusSliderProps) {
  return (
    <div
      role="group"
      aria-label="Search radius"
      className="flex bg-surface border border-border rounded-full p-1 max-w-md mx-auto"
    >
      {SEGMENTS.map((segment) => {
        const isActive = value.kind === segment.kind;
        return (
          <button
            key={segment.kind}
            type="button"
            aria-pressed={isActive}
            onClick={() => onChange(segment.toRadius())}
            className={[
              'flex-1 min-h-[44px] touch-manipulation rounded-full font-display text-sm md:text-base transition-colors',
              isActive ? 'bg-accent text-bg' : 'text-text hover:text-accent',
            ].join(' ')}
          >
            {segment.label}
          </button>
        );
      })}
    </div>
  );
}
