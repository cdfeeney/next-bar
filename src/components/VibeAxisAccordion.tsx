'use client';

import { useMemo } from 'react';
import { displayTag } from '@/lib/tagDisplay';
import { AXIS_ORDER, VIBE_AXES, type VibeAxis } from '@/lib/vibeAxes';
import type { VibeTag } from '@/types';

/**
 * VibeAxisAccordion — the six-axis vibe picker, extracted so that BOTH surfaces
 * that let you choose a vibe render the *same* control.
 *
 * Why this exists (goal g-12d33864). Two presentation layers had grown over one
 * vocabulary: this accordion (used by the Next Bar? flow via VibeTweak) and a
 * flat wall of horizontal chip rails (FindBarFilterChips, used by /map). The
 * operator rejected the rails outright, and rejected the earlier "fix" of
 * merely collapsing the same rails behind a button. The taxonomy was never the
 * problem — lib/findBarFilters already implements OR-within-axis /
 * AND-across-axes correctly, and lib/vibeAxes already homes `club` (Setting),
 * `dance` (Energy) and `house` (Sound) in three different axes so that
 * "Club + Dancing + House" ANDs. Only the *control* was wrong on /map.
 *
 * This component is deliberately presentational and uncontrolled-free: it owns
 * no selection state and no apply semantics. The two shells differ in ways that
 * do not belong in here — VibeTweak is a full-screen step with a single
 * neighborhood and no distance, MapFilterSheet is a sheet over a live map with
 * multi-neighborhood and a distance row — so keeping the shared part to the
 * axes is what stops the shells' differences leaking into each other.
 *
 * Progressive disclosure per DESIGN-SYSTEM R1: ONE axis open at a time.
 * Collapsed rows summarize their active picks as human labels, so the whole
 * vibe stays scannable without opening anything — 33 tags of expressiveness
 * behind six rows instead of a chip wall. All labels render through displayTag
 * (E0.1 — price shows as $–$$$$).
 */

const CHIP_BASE =
  'min-h-[44px] min-w-[44px] touch-manipulation px-4 py-2 rounded-full font-display text-sm border transition-colors';
const CHIP_ACTIVE = 'bg-accent text-bg border-accent';
const CHIP_INACTIVE = 'bg-surface border-border text-muted';

type VibeAxisAccordionProps = {
  /** Currently selected tags. Membership only — order is never read. */
  active: ReadonlySet<VibeTag>;
  onToggle: (tag: VibeTag) => void;
  /** Which axis is expanded; null = all collapsed. Owned by the shell. */
  openAxis: VibeAxis | null;
  onOpenAxisChange: (axis: VibeAxis | null) => void;
};

/**
 * The axis whose row should open first: the first one carrying a pick — the
 * likeliest one the user came to change. Nothing active → start closed.
 * Exported because both shells seed their own `openAxis` state with it.
 */
export function initialOpenAxis(tags: Iterable<VibeTag>): VibeAxis | null {
  const seeded = new Set(tags);
  return AXIS_ORDER.find((a) => VIBE_AXES[a].some((t) => seeded.has(t))) ?? null;
}

export default function VibeAxisAccordion({
  active,
  onToggle,
  openAxis,
  onOpenAxisChange,
}: VibeAxisAccordionProps) {
  const summaries = useMemo(() => {
    const out = new Map<VibeAxis, string>();
    for (const axis of AXIS_ORDER) {
      const picked = VIBE_AXES[axis].filter((t) => active.has(t));
      out.set(axis, picked.map(displayTag).join(' · '));
    }
    return out;
  }, [active]);

  return (
    <div className="space-y-2">
      {AXIS_ORDER.map((axis) => {
        const isOpen = openAxis === axis;
        const summary = summaries.get(axis) ?? '';
        return (
          <div
            key={axis}
            className="bg-surface border border-border rounded-3xl overflow-hidden"
          >
            <button
              type="button"
              aria-expanded={isOpen}
              onClick={() => onOpenAxisChange(isOpen ? null : axis)}
              className="w-full min-h-[56px] touch-manipulation flex items-center justify-between gap-3 px-5 py-3 text-left"
            >
              <span className="font-display text-base">{axis}</span>
              <span className="text-muted text-xs truncate max-w-[60%]">
                {summary || 'Anything'}
              </span>
            </button>
            {isOpen ? (
              <div
                role="group"
                aria-label={`${axis} vibes`}
                className="flex flex-wrap gap-2 px-5 pb-5"
              >
                {VIBE_AXES[axis].map((tag) => {
                  const isActive = active.has(tag);
                  return (
                    <button
                      key={tag}
                      type="button"
                      aria-pressed={isActive}
                      onClick={() => onToggle(tag)}
                      className={[
                        CHIP_BASE,
                        isActive ? CHIP_ACTIVE : CHIP_INACTIVE,
                      ].join(' ')}
                    >
                      {displayTag(tag)}
                      {isActive ? ' ×' : ''}
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
