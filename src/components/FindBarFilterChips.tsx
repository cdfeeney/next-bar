'use client';

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

/** Canonical service area — same source of truth the quiz picker serves. */
const NEIGHBORHOODS = Object.keys(NEIGHBORHOOD_CENTROIDS) as Neighborhood[];

/** All 33 vibe tags in canonical 6-axis order (E0.2 partition). */
const VIBE_TAGS: readonly VibeTag[] = AXIS_ORDER.flatMap(
  (axis) => VIBE_AXES[axis],
);

/** Same intent semantics as the results surface (E3.2 DistanceChips). */
const DISTANCE_CHIPS: ReadonlyArray<{ label: string; toRadius: () => Radius }> = [
  { label: 'Walkable', toRadius: () => ({ kind: 'walking', maxMiles: RADIUS_WALK }) },
  { label: 'Worth a cab', toRadius: () => ({ kind: 'cab', maxMiles: RADIUS_CAB }) },
  { label: 'Anywhere', toRadius: () => ({ kind: 'anywhere', maxMiles: RADIUS_ANYWHERE }) },
];

// min-w matters as much as min-h: the price row renders a single "$" glyph, and
// with px-4 alone that chip measured 43px wide — one pixel under the Apple
// minimum, which mobile-controls.spec.ts checks in BOTH dimensions. Every other
// chip is already wider than 44px, so the floor only ever affects the narrow
// ones. inline-flex/justify-center is explicit rather than relying on the
// default button text centring (these are flex children, so the display value
// is blockified by the parent anyway).
const CHIP_BASE =
  'shrink-0 inline-flex items-center justify-center min-h-[44px] min-w-[44px] px-4 rounded-full border font-display text-sm touch-manipulation transition-colors';
const CHIP_ON = 'bg-accent text-bg border-accent';
const CHIP_OFF = 'bg-surface text-text border-border hover:border-accent';

type FindBarFilterChipsProps = {
  filters: FindBarFilters;
  onChange: (next: FindBarFilters) => void;
  /** Distance chips need a usable location; without one they disable with a hint. */
  hasLocation: boolean;
};

/**
 * QA2 "Find Bar": three optional horizontal-scroll chip rows above the
 * map — Neighborhood (multi), Distance (Walkable / Worth a cab /
 * Anywhere), Vibe (multi, 6-axis vocabulary). All optional; the badge
 * counts active filters and Clear resets in one tap.
 */
export default function FindBarFilterChips({
  filters,
  onChange,
  hasLocation,
}: FindBarFilterChipsProps) {
  const activeCount = countActiveFilters(filters);
  const radiusKind = filters.radius?.kind ?? 'anywhere';

  return (
    <div data-testid="findbar-filters" className="mt-4 text-left">
      <div className="flex items-center justify-between px-1 mb-1">
        <span className="text-xs text-muted">
          Filters
          {activeCount > 0 && (
            <span
              data-testid="filter-count"
              className="ml-1.5 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-accent text-bg text-[11px] font-display"
            >
              {activeCount}
            </span>
          )}
        </span>
        {activeCount > 0 && (
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
        )}
      </div>

      {/* Neighborhood — multi-select, whole service area. */}
      <div
        role="group"
        aria-label="Filter by neighborhood"
        className="flex gap-2 overflow-x-auto pb-2 px-1"
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

      {/* Distance — needs a location; disabled with a hint otherwise. */}
      <div
        role="group"
        aria-label="Filter by distance"
        className="flex gap-2 overflow-x-auto pb-2 px-1"
      >
        {DISTANCE_CHIPS.map((chip) => {
          const next = chip.toRadius();
          const isOn = hasLocation && radiusKind === next.kind;
          return (
            <button
              key={next.kind}
              type="button"
              aria-pressed={isOn}
              disabled={!hasLocation}
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
        {!hasLocation && (
          <span className="shrink-0 self-center text-xs text-muted">
            Turn on location to filter by distance
          </span>
        )}
      </div>

      {/* Vibe — multi-select over the 6-axis vocabulary, displayTag labels. */}
      <div
        role="group"
        aria-label="Filter by vibe"
        className="flex gap-2 overflow-x-auto pb-2 px-1"
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
  );
}
