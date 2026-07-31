'use client';

import { useState } from 'react';
import VibeAxisAccordion, {
  initialOpenAxis,
} from '@/components/VibeAxisAccordion';
import type { VibeAxis } from '@/lib/vibeAxes';
import { displayHood } from '@/lib/hoodDisplay';
import { NEIGHBORHOOD_CENTROIDS } from '@/lib/constants';
import type { Neighborhood, VibeTag } from '@/types';

/** Canonical service area — same source of truth the quiz picker serves. */
const NEIGHBORHOODS = Object.keys(NEIGHBORHOOD_CENTROIDS) as Neighborhood[];

type VibeTweakProps = {
  initialTags: VibeTag[];
  /**
   * H3 (goal g-44007df6): neighborhood moved INSIDE this surface, alongside the
   * drink/vibe axes, instead of sitting as its own top-level rail. Optional so
   * callers that genuinely have no location dimension can omit it rather than
   * being forced to pass a stub.
   */
  initialNeighborhood?: Neighborhood | null;
  onApply: (tags: VibeTag[], neighborhood?: Neighborhood | null) => void;
  onCancel: () => void;
};

const PRIMARY_BTN =
  'min-h-[44px] touch-manipulation rounded-full px-6 py-3 font-display text-lg bg-accent text-bg';
const SECONDARY_BTN =
  'min-h-[44px] touch-manipulation rounded-full px-6 py-3 font-display text-lg bg-surface border border-border text-text';

const CHIP_BASE =
  'min-h-[44px] touch-manipulation px-4 py-2 rounded-full font-display text-sm border transition-colors';
const CHIP_ACTIVE = 'bg-accent text-bg border-accent';
const CHIP_INACTIVE = 'bg-surface border-border text-muted';

/**
 * VibeTweak — the Next Bar? flow's vibe surface (E2.2).
 *
 * The six axis rows now come from the shared VibeAxisAccordion (goal
 * g-12d33864) so that /map renders the identical control instead of the flat
 * chip rails it used to have. This component's props, apply/cancel contract and
 * single-neighborhood behavior are UNCHANGED — WhereNextFlow's night-cached
 * vibe pick round-trips exactly as before. Only the axis markup moved.
 */
export default function VibeTweak({
  initialTags,
  initialNeighborhood = null,
  onApply,
  onCancel,
}: VibeTweakProps) {
  const [active, setActive] = useState<Set<VibeTag>>(
    () => new Set(initialTags),
  );
  const [hood, setHood] = useState<Neighborhood | null>(initialNeighborhood);
  const [hoodOpen, setHoodOpen] = useState(false);
  const [openAxis, setOpenAxis] = useState<VibeAxis | null>(() =>
    initialOpenAxis(initialTags),
  );

  const toggle = (tag: VibeTag) => {
    setActive((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  };

  return (
    // BOTTOM CLEARANCE (goal g-44007df6). BottomNav is `fixed bottom-0 z-[1000]`
    // with `pb-[max(0.5rem,env(safe-area-inset-bottom))]`, and this section's
    // action row is its LAST child — so on a short viewport (402x681) Apply and
    // Cancel sat UNDERNEATH the nav and could not be tapped at all. Reserve the
    // nav's height plus the iOS home-indicator inset, so the row always clears
    // both. Padding rather than a margin: this element scrolls, and the space
    // must belong to the scrollable content.
    <section className="max-w-2xl mx-auto px-6 pt-8 pb-[calc(6rem+env(safe-area-inset-bottom))]">
      <h2 className="font-display text-2xl mb-2 text-center">
        Tweak the vibe
      </h2>
      <p className="text-muted text-sm text-center mb-6">
        Remove what you don&rsquo;t want. Add what you do.
      </p>

      <div className="mb-8">
        <VibeAxisAccordion
          active={active}
          onToggle={toggle}
          openAxis={openAxis}
          onOpenAxisChange={setOpenAxis}
        />
      </div>

      {/*
        H3: neighborhood lives HERE now, as a seventh row alongside the six vibe
        axes, instead of being its own always-on rail on the results surface.
        Same accordion shape as the axes above so it reads as one more dimension
        of the same choice, not a special case.
      */}
      <div className="space-y-2 mb-8">
        <div className="bg-surface border border-border rounded-3xl overflow-hidden">
          <button
            type="button"
            aria-expanded={hoodOpen}
            onClick={() => setHoodOpen((open) => !open)}
            className="w-full min-h-[56px] touch-manipulation flex items-center justify-between gap-3 px-5 py-3 text-left"
          >
            <span className="font-display text-base">Neighborhood</span>
            <span className="text-muted text-xs truncate max-w-[60%]">
              {hood ? displayHood(hood) : 'Anywhere'}
            </span>
          </button>
          {hoodOpen ? (
            <div
              role="group"
              aria-label="Neighborhood"
              className="flex flex-wrap gap-2 px-5 pb-5"
            >
              {/* "Anywhere" is a real choice, not the absence of one — without
                  it there is no way to UNDO a neighborhood pick. */}
              <button
                type="button"
                aria-pressed={hood === null}
                onClick={() => setHood(null)}
                className={[CHIP_BASE, hood === null ? CHIP_ACTIVE : CHIP_INACTIVE].join(' ')}
              >
                Anywhere
              </button>
              {NEIGHBORHOODS.map((n) => {
                const isActive = hood === n;
                return (
                  <button
                    key={n}
                    type="button"
                    aria-pressed={isActive}
                    onClick={() => setHood(isActive ? null : n)}
                    className={[CHIP_BASE, isActive ? CHIP_ACTIVE : CHIP_INACTIVE].join(' ')}
                  >
                    {displayHood(n)}
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
      </div>

      <div className="flex flex-col md:flex-row gap-3 justify-center items-center">
        <button
          type="button"
          onClick={() => onApply(Array.from(active), hood)}
          className={PRIMARY_BTN}
        >
          Apply
        </button>
        <button type="button" onClick={onCancel} className={SECONDARY_BTN}>
          Cancel
        </button>
      </div>
    </section>
  );
}
