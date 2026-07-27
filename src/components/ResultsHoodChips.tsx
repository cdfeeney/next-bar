'use client';

import type { Neighborhood } from '@/types';
import { NEIGHBORHOOD_CENTROIDS } from '@/lib/constants';

/** Canonical service area — same source of truth the other pickers serve. */
const NEIGHBORHOODS = Object.keys(NEIGHBORHOOD_CENTROIDS) as Neighborhood[];

const CHIP_BASE =
  'shrink-0 min-h-[44px] px-4 rounded-full border font-display text-sm touch-manipulation transition-colors';
const CHIP_ON = 'bg-accent text-bg border-accent';
const CHIP_OFF = 'bg-surface text-text border-border hover:border-accent';

type ResultsHoodChipsProps = {
  /** null = ranked around the location anchor (coords / seed bar). */
  value: Neighborhood | null;
  onChange: (next: Neighborhood | null) => void;
  /** The no-hood chip's label — what "here" means on this surface. */
  anchorLabel: string;
};

/**
 * QA-6: the OPTIONAL neighborhood picker on the one results view.
 * Single-select scroll row; the anchor chip is the default and tapping a
 * selected hood toggles back to it — the picker narrows, never traps.
 */
export default function ResultsHoodChips({
  value,
  onChange,
  anchorLabel,
}: ResultsHoodChipsProps) {
  return (
    <div
      role="group"
      aria-label="Neighborhood"
      className="flex gap-2 overflow-x-auto pb-1 px-1 max-w-2xl mx-auto"
    >
      <button
        type="button"
        aria-pressed={value === null}
        onClick={() => onChange(null)}
        className={`${CHIP_BASE} ${value === null ? CHIP_ON : CHIP_OFF}`}
      >
        {anchorLabel}
      </button>
      {NEIGHBORHOODS.map((hood) => {
        const isOn = value === hood;
        return (
          <button
            key={hood}
            type="button"
            aria-pressed={isOn}
            onClick={() => onChange(isOn ? null : hood)}
            className={`${CHIP_BASE} ${isOn ? CHIP_ON : CHIP_OFF}`}
          >
            {hood}
          </button>
        );
      })}
    </div>
  );
}
