'use client';

import { useMemo, useState } from 'react';
import { displayTag } from '@/lib/tagDisplay';
import { displayHood } from '@/lib/hoodDisplay';
import { NEIGHBORHOOD_CENTROIDS } from '@/lib/constants';
import { AXIS_ORDER, VIBE_AXES, type VibeAxis } from '@/lib/vibeAxes';
import type { Neighborhood, VibeTag } from '@/types';

const NEIGHBORHOODS = Object.keys(NEIGHBORHOOD_CENTROIDS) as Neighborhood[];

type VibeTweakProps = {
  initialTags: VibeTag[];
  initialNeighborhoods?: Neighborhood[];
  onApply: (tags: VibeTag[], neighborhoods: Neighborhood[]) => void;
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
 * VibeTweak — the vibe surface, rebuilt on the six axes (E2.2).
 *
 * Progressive disclosure per DESIGN-SYSTEM R1: ONE axis open at a time
 * (accordion). Collapsed rows summarize their active picks as human
 * labels, so the whole vibe is scannable without opening anything —
 * 33 tags of expressiveness behind six rows instead of a chip wall.
 * All labels render through displayTag (E0.1 — price shows as $–$$$$).
 */
export default function VibeTweak({
  initialTags,
  initialNeighborhoods,
  onApply,
  onCancel,
}: VibeTweakProps) {
  const [active, setActive] = useState<Set<VibeTag>>(
    () => new Set(initialTags),
  );
  const [neighborhoods, setNeighborhoods] = useState<Set<Neighborhood>>(
    () => new Set(initialNeighborhoods),
  );
  // The first axis carrying an active pick opens initially — the likeliest
  // one the user came to change. Nothing active → start closed.
  const [openAxis, setOpenAxis] = useState<VibeAxis | 'Neighborhood' | null>(() => {
    if (initialNeighborhoods?.length) return 'Neighborhood';
    const seeded = new Set(initialTags);
    return AXIS_ORDER.find((a) => VIBE_AXES[a].some((t) => seeded.has(t))) ?? null;
  });

  const summaries = useMemo(() => {
    const out = new Map<VibeAxis, string>();
    for (const axis of AXIS_ORDER) {
      const picked = VIBE_AXES[axis].filter((t) => active.has(t));
      out.set(axis, picked.map(displayTag).join(' · '));
    }
    return out;
  }, [active]);

  const toggle = (tag: VibeTag) => {
    setActive((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  };

  return (
    // pb-28 clears the FIXED bottom nav (R5). Without it Cancel is the last
    // element on the page and the nav sits on top of it: visually present,
    // pointer events intercepted. Caught on iPhone 13 by
    // e2e/vibe-tweak-ranking.spec.ts — the same class as the results
    // surface's "Pick a different bar" spacer.
    <section className="max-w-2xl mx-auto px-6 pt-8 pb-28">
      <h2 className="font-display text-2xl mb-2 text-center">
        Tweak the vibe
      </h2>
      <p className="text-muted text-sm text-center mb-6">
        Remove what you don&rsquo;t want. Add what you do.
      </p>

      <div className="space-y-2 mb-8">
        {initialNeighborhoods ? (
          <div className="bg-surface border border-border rounded-3xl overflow-hidden">
            <button
              type="button"
              aria-expanded={openAxis === 'Neighborhood'}
              onClick={() => setOpenAxis(openAxis === 'Neighborhood' ? null : 'Neighborhood')}
              className="w-full min-h-[56px] touch-manipulation flex items-center justify-between gap-3 px-5 py-3 text-left"
            >
              <span className="font-display text-base">Neighborhood</span>
              <span className="text-muted text-xs truncate max-w-[60%]">
                {[...neighborhoods].map(displayHood).join(' · ') || 'Anywhere'}
              </span>
            </button>
            {openAxis === 'Neighborhood' ? (
              <div
                role="group"
                aria-label="Neighborhood"
                className="flex flex-wrap gap-2 px-5 pb-5"
              >
                {NEIGHBORHOODS.map((neighborhood) => {
                  const isActive = neighborhoods.has(neighborhood);
                  return (
                    <button
                      key={neighborhood}
                      type="button"
                      aria-pressed={isActive}
                      onClick={() => setNeighborhoods((prev) => {
                        const next = new Set(prev);
                        if (next.has(neighborhood)) next.delete(neighborhood);
                        else next.add(neighborhood);
                        return next;
                      })}
                      className={[
                        CHIP_BASE,
                        isActive ? CHIP_ACTIVE : CHIP_INACTIVE,
                      ].join(' ')}
                    >
                      {displayHood(neighborhood)}
                      {isActive ? ' ×' : ''}
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
        ) : null}
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
                onClick={() => setOpenAxis(isOpen ? null : axis)}
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
                        onClick={() => toggle(tag)}
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

      <div className="flex flex-col md:flex-row gap-3 justify-center items-center">
        <button
          type="button"
          onClick={() => onApply(Array.from(active), Array.from(neighborhoods))}
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
