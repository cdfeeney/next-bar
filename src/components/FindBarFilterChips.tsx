'use client';

import { useState } from 'react';
import type { Neighborhood } from '@/types';
import { NEIGHBORHOOD_CENTROIDS } from '@/lib/constants';
import { displayHood } from '@/lib/hoodDisplay';
import {
  countActiveFilters,
  toggleSelection,
  type FindBarFilters,
} from '@/lib/findBarFilters';
import VibeTweak from '@/components/VibeTweak';

const NEIGHBORHOODS = Object.keys(NEIGHBORHOOD_CENTROIDS) as Neighborhood[];

const CHIP_BASE =
  'min-h-[44px] px-4 rounded-full border font-display text-sm touch-manipulation transition-colors';
const CHIP_ON = 'bg-accent text-bg border-accent';
const CHIP_OFF = 'bg-surface text-text border-border hover:border-accent';

type FindBarFilterChipsProps = {
  filters: FindBarFilters;
  onChange: (next: FindBarFilters) => void;
};

export default function FindBarFilterChips({
  filters,
  onChange,
}: FindBarFilterChipsProps): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const activeCount = countActiveFilters(filters);

  return (
    <div
      data-testid="findbar-filters"
      className="mt-4 max-w-md mx-auto text-left overflow-hidden"
    >
      <div className="flex items-center justify-between gap-3 mb-2">
        <p className="text-xs text-muted">Neighborhood</p>
        {activeCount > 0 ? (
          <button
            type="button"
            data-testid="filter-clear"
            onClick={() => onChange({ neighborhoods: [], radius: null, vibes: [] })}
            className="text-xs text-accent min-h-[44px] px-2 touch-manipulation underline-offset-4 hover:underline"
          >
            Clear
          </button>
        ) : null}
      </div>
      <div
        role="group"
        aria-label="Filter by neighborhood"
        className="flex flex-wrap justify-center gap-2"
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

      <button
        type="button"
        aria-expanded={expanded}
        data-testid="vibe-filter-toggle"
        onClick={() => setExpanded((open) => !open)}
        className="mt-3 w-full min-h-[44px] flex items-center justify-between gap-3 rounded-2xl border border-border bg-surface px-4 font-display text-left touch-manipulation"
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

      {expanded ? (
        <VibeTweak
          initialTags={[...filters.vibes]}
          onApply={(vibes) => {
            onChange({ ...filters, vibes });
            setExpanded(false);
          }}
          onCancel={() => setExpanded(false)}
        />
      ) : null}
    </div>
  );
}
