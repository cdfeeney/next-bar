'use client';

import { useState } from 'react';
import type { Neighborhood, Radius, VibeTag } from '@/types';
import {
  NEIGHBORHOOD_CENTROIDS,
  RADIUS_ANYWHERE,
  RADIUS_CAB,
  RADIUS_WALK,
} from '@/lib/constants';
import { AXIS_ORDER, VIBE_AXES } from '@/lib/vibeAxes';
import { displayTag } from '@/lib/tagDisplay';
import { displayHood } from '@/lib/hoodDisplay';
import {
  countActiveFilters,
  toggleSelection,
  type FindBarFilters,
} from '@/lib/findBarFilters';

const NEIGHBORHOODS = Object.keys(NEIGHBORHOOD_CENTROIDS) as Neighborhood[];
const VIBE_TAGS: readonly VibeTag[] = AXIS_ORDER.flatMap(
  (axis) => VIBE_AXES[axis],
);
const DISTANCE_CHIPS: ReadonlyArray<{ label: string; toRadius: () => Radius }> = [
  { label: 'Walkable', toRadius: () => ({ kind: 'walking', maxMiles: RADIUS_WALK }) },
  { label: 'Worth a cab', toRadius: () => ({ kind: 'cab', maxMiles: RADIUS_CAB }) },
  { label: 'Anywhere', toRadius: () => ({ kind: 'anywhere', maxMiles: RADIUS_ANYWHERE }) },
];

const CHIP_BASE =
  'min-h-[44px] px-4 rounded-full border font-display text-sm touch-manipulation transition-colors';
const CHIP_ON = 'bg-accent text-bg border-accent';
const CHIP_OFF = 'bg-surface text-text border-border hover:border-accent';

type FindBarFilterChipsProps = {
  filters: FindBarFilters;
  onChange: (next: FindBarFilters) => void;
  hasLocation: boolean;
};

export default function FindBarFilterChips({
  filters,
  onChange,
  hasLocation,
}: FindBarFilterChipsProps): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const activeCount = countActiveFilters(filters);
  const radiusKind = filters.radius?.kind ?? 'anywhere';

  return (
    <div
      data-testid="findbar-filters"
      className="mt-4 max-w-md mx-auto text-left overflow-hidden"
    >
      <button
        type="button"
        aria-expanded={expanded}
        data-testid="vibe-filter-toggle"
        onClick={() => setExpanded((open) => !open)}
        className="w-full min-h-[44px] flex items-center justify-between gap-3 rounded-2xl border border-border bg-surface px-4 font-display text-left touch-manipulation"
      >
        <span className="flex items-center gap-2 min-w-0">
          <span>Tweak the vibe</span>
          {activeCount > 0 ? (
            <span
              data-testid="filter-count"
              className="inline-flex items-center justify-center min-w-[20px] h-5 px-1 rounded-full bg-accent text-bg text-[11px]"
            >
              {activeCount}
            </span>
          ) : null}
        </span>
        <span aria-hidden="true" className="text-muted shrink-0">
          {expanded ? '−' : '+'}
        </span>
      </button>

      <div
        role="group"
        aria-label="Filter by distance"
        className="mt-3 flex flex-wrap justify-center gap-2"
      >
        {DISTANCE_CHIPS.map((chip) => {
          const next = chip.toRadius();
          const isOn = radiusKind === next.kind;
          const needsLocation = next.kind !== 'anywhere';
          return (
            <button
              key={next.kind}
              type="button"
              aria-pressed={isOn}
              disabled={needsLocation && !hasLocation}
              onClick={() =>
                onChange({
                  ...filters,
                  radius: next.kind === 'anywhere' ? null : next,
                })
              }
              className={`${CHIP_BASE} ${isOn ? CHIP_ON : CHIP_OFF} disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              {chip.label}
            </button>
          );
        })}
      </div>
      {!hasLocation ? (
        <p className="mt-2 text-center text-xs text-muted">
          Turn on location to filter by distance
        </p>
      ) : null}

      {expanded ? (
        <div className="mt-4 rounded-2xl border border-border bg-surface p-3">
          <div className="flex items-center justify-between gap-3 mb-2">
            <p className="text-xs text-muted">Neighborhood</p>
            {activeCount > 0 ? (
              <button
                type="button"
                data-testid="filter-clear"
                onClick={() =>
                  onChange({ neighborhoods: [], radius: null, vibes: [] })
                }
                className="text-xs text-accent min-h-[44px] px-2 touch-manipulation underline-offset-4 hover:underline"
              >
                Clear
              </button>
            ) : null}
          </div>
          <div
            role="group"
            aria-label="Filter by neighborhood"
            className="flex flex-wrap gap-2"
          >
            {NEIGHBORHOODS.map((hood) => {
              const isOn = filters.neighborhoods.includes(hood);
              return (
                <button
                  key={hood}
                  type="button"
                  aria-pressed={isOn}
                  onClick={() =>
                    onChange({
                      ...filters,
                      neighborhoods: toggleSelection(filters.neighborhoods, hood),
                    })
                  }
                  className={`${CHIP_BASE} ${isOn ? CHIP_ON : CHIP_OFF}`}
                >
                  {displayHood(hood)}
                </button>
              );
            })}
          </div>

          <p className="mt-5 mb-2 text-xs text-muted">Vibe</p>
          <div
            role="group"
            aria-label="Filter by vibe"
            className="flex flex-wrap gap-2"
          >
            {VIBE_TAGS.map((tag) => {
              const isOn = filters.vibes.includes(tag);
              return (
                <button
                  key={tag}
                  type="button"
                  aria-pressed={isOn}
                  onClick={() =>
                    onChange({
                      ...filters,
                      vibes: toggleSelection(filters.vibes, tag),
                    })
                  }
                  className={`${CHIP_BASE} ${isOn ? CHIP_ON : CHIP_OFF}`}
                >
                  {displayTag(tag)}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
