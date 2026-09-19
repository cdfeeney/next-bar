'use client';

import { useRef, useState } from 'react';
import {
  countActiveFilters,
  type FindBarFilters,
} from '@/lib/findBarFilters';
import VibeTweak from '@/components/VibeTweak';

type FindBarFilterChipsProps = {
  filters: FindBarFilters;
  onChange: (next: FindBarFilters) => void;
};

export default function FindBarFilterChips({
  filters,
  onChange,
}: FindBarFilterChipsProps): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  // Bumped by Clear: a mounted VibeTweak keeps its own picks, so without a
  // remount its Apply would put the cleared picks straight back (T-01b panel).
  const [resetKey, setResetKey] = useState(0);
  // What the panel opened with, so Cancel can put it back after live edits.
  const openedWith = useRef(filters);
  const activeCount = countActiveFilters(filters);

  return (
    <div
      data-testid="findbar-filters"
      className="mt-4 max-w-md mx-auto text-left overflow-hidden"
    >
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-expanded={expanded}
          data-testid="vibe-filter-toggle"
          onClick={() => {
            if (!expanded) openedWith.current = filters;
            setExpanded((open) => !open);
          }}
          className="flex-1 min-h-[44px] flex items-center justify-between gap-3 rounded-2xl border border-border bg-surface px-4 font-display text-left touch-manipulation"
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
        {activeCount > 0 ? (
          <button
            type="button"
            data-testid="filter-clear"
            onClick={() => {
              const empty = { neighborhoods: [], radius: null, vibes: [] };
              openedWith.current = empty;
              onChange(empty);
              setResetKey((k) => k + 1);
            }}
            className="text-xs text-accent min-h-[44px] px-2 touch-manipulation underline-offset-4 hover:underline"
          >
            Clear
          </button>
        ) : null}
      </div>

      {expanded ? (
        <VibeTweak
          key={resetKey}
          initialTags={[...filters.vibes]}
          initialNeighborhoods={[...filters.neighborhoods]}
          // Every toggle lands in the caller's DRAFT so the sheet's
          // "Show N bars" counts live (T-01b); Apply just closes the panel,
          // Cancel restores what it opened with.
          onChange={(vibes, neighborhoods) => onChange({ ...filters, vibes, neighborhoods })}
          onApply={(vibes, neighborhoods) => {
            onChange({ ...filters, vibes, neighborhoods });
            setExpanded(false);
          }}
          onCancel={() => {
            onChange(openedWith.current);
            setExpanded(false);
          }}
        />
      ) : null}
    </div>
  );
}
