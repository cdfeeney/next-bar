'use client';

import { useMemo, useState } from 'react';
import VibeAxisAccordion, {
  initialOpenAxis,
} from '@/components/VibeAxisAccordion';
import type { VibeAxis } from '@/lib/vibeAxes';
import { displayHood } from '@/lib/hoodDisplay';
import {
  NEIGHBORHOOD_CENTROIDS,
  RADIUS_ANYWHERE,
  RADIUS_CAB,
  RADIUS_WALK,
} from '@/lib/constants';
import {
  EMPTY_FILTERS,
  countActiveFilters,
  toggleSelection,
  type FindBarFilters,
} from '@/lib/findBarFilters';
import type { Neighborhood, Radius, VibeTag } from '@/types';

/** Canonical service area — same source of truth the quiz picker serves. */
const NEIGHBORHOODS = Object.keys(NEIGHBORHOOD_CENTROIDS) as Neighborhood[];

/** Same intent semantics as the results surface (E3.2 DistanceChips). */
const DISTANCE_CHIPS: ReadonlyArray<{ label: string; radius: Radius }> = [
  { label: 'Walkable', radius: { kind: 'walking', maxMiles: RADIUS_WALK } },
  { label: 'Worth a cab', radius: { kind: 'cab', maxMiles: RADIUS_CAB } },
  { label: 'Anywhere', radius: { kind: 'anywhere', maxMiles: RADIUS_ANYWHERE } },
];

const PRIMARY_BTN =
  'min-h-[44px] touch-manipulation rounded-full px-6 py-3 font-display text-lg bg-accent text-bg';
const SECONDARY_BTN =
  'min-h-[44px] touch-manipulation rounded-full px-6 py-3 font-display text-lg bg-surface border border-border text-text';

const CHIP_BASE =
  'min-h-[44px] min-w-[44px] touch-manipulation px-4 py-2 rounded-full font-display text-sm border transition-colors';
const CHIP_ACTIVE = 'bg-accent text-bg border-accent';
const CHIP_INACTIVE = 'bg-surface border-border text-muted';

type MapFilterSheetProps = {
  /** The APPLIED filters. Seeds the draft; never mutated by this component. */
  filters: FindBarFilters;
  /** Distance needs a usable location; without one those chips disable with a hint. */
  hasLocation: boolean;
  onApply: (next: FindBarFilters) => void;
  onCancel: () => void;
};

/**
 * MapFilterSheet — /map's "Tweak the vibe" surface (goal g-12d33864).
 *
 * REPLACES FindBarFilterChips, which was three horizontal-scroll chip rails
 * (neighborhood / distance / 33 flat vibe chips). The operator rejected the
 * rails, and then rejected the follow-up that merely collapsed the same rails
 * behind a disclosure button — "do not merely hide the same rails behind a
 * button". So this is a different control, not the old one with a lid:
 *
 *  - the vibe picker is the SHARED six-axis accordion (VibeAxisAccordion), the
 *    identical control the Next Bar? flow uses, so Club (Setting), Dancing
 *    (Energy) and House (Sound) each sit in their own labelled axis and are
 *    reachable without horizontal scrolling;
 *  - neighborhood and distance are two more accordion rows INSIDE this surface
 *    rather than separate top-level rails, so location is part of one coherent
 *    choice;
 *  - choices are a DRAFT until Apply, and Cancel discards them. The rails
 *    applied live, which is fine for a chip you can see but wrong for a sheet
 *    covering the map you are filtering.
 *
 * Filter SEMANTICS are untouched and still live in lib/findBarFilters:
 * OR within one axis, AND across axes. This component only produces the
 * FindBarFilters value; it never decides what one means.
 *
 * Neighborhood is multi-select here (it always was on /map) while the Next Bar?
 * flow's VibeTweak keeps its single-neighborhood contract — that difference is
 * exactly why the two shells stayed separate and only the axes are shared.
 */
export default function MapFilterSheet({
  filters,
  hasLocation,
  onApply,
  onCancel,
}: MapFilterSheetProps) {
  // Draft state. Seeded once per mount — /map unmounts this sheet on close, so
  // reopening always re-seeds from whatever is currently applied.
  const [vibes, setVibes] = useState<Set<VibeTag>>(
    () => new Set(filters.vibes),
  );
  const [hoods, setHoods] = useState<readonly Neighborhood[]>(
    () => filters.neighborhoods,
  );
  const [radius, setRadius] = useState<Radius | null>(() => filters.radius);

  const [openAxis, setOpenAxis] = useState<VibeAxis | null>(() =>
    initialOpenAxis(filters.vibes),
  );
  const [hoodOpen, setHoodOpen] = useState(false);
  const [distanceOpen, setDistanceOpen] = useState(false);

  const draft: FindBarFilters = useMemo(
    () => ({ neighborhoods: hoods, radius, vibes: Array.from(vibes) }),
    [hoods, radius, vibes],
  );

  /**
   * The count must reflect filters that are actually DOING something.
   *
   * A radius survives in `filters` after the user applies "Walkable" and then
   * loses or revokes location — and `filterBars` deliberately no-ops radius
   * when `userCoords` is null, so the results are the full unfiltered set. The
   * badge counting that radius would claim an active filter the user can
   * neither see the effect of nor switch off (the Distance chips are disabled
   * without a location). The Distance row's own summary already reads
   * "Anywhere" in that state; this keeps the numeral honest with it.
   *
   * The stored value is deliberately NOT cleared: the user asked for Walkable,
   * and if location comes back it should still mean Walkable rather than having
   * been silently discarded by opening a sheet.
   */
  const effectiveDraft = hasLocation ? draft : { ...draft, radius: null };
  const draftCount = countActiveFilters(effectiveDraft);

  const hoodSummary = hoods.length > 0 ? hoods.map(displayHood).join(' · ') : '';
  const radiusKind = radius?.kind ?? 'anywhere';
  const distanceSummary =
    DISTANCE_CHIPS.find((c) => c.radius.kind === radiusKind)?.label ?? 'Anywhere';

  const toggleVibe = (tag: VibeTag) => {
    setVibes((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  };

  const clearAll = () => {
    setVibes(new Set());
    setHoods(EMPTY_FILTERS.neighborhoods);
    setRadius(EMPTY_FILTERS.radius);
  };

  return (
    // NO bottom-clearance padding here, deliberately — and that is a difference
    // from VibeTweak worth stating, because copying its fix across looked
    // obviously right and was wrong.
    //
    // VibeTweak IS the whole screen: its action row is the last thing on the
    // page, so with nothing reserved it sits under the fixed BottomNav and
    // cannot be tapped (goal g-44007df6). This sheet is not the whole screen —
    // it renders inside /map's <header>, with the Leaflet section and the
    // count line after it. The nav can therefore never overlap Apply/Cancel;
    // the page simply scrolls past them. A copied `pb-[calc(6rem+...)]` bought
    // no reachability at all and inserted ~96px of dead space between Cancel
    // and the map. Measured, not assumed: with it, Apply at page-bottom scroll
    // sat at top=-212 on a 402x681 viewport — off the TOP, the opposite of the
    // defect the padding exists to prevent. See the MapFilterSheet block in
    // e2e/vibe-tweak-reachable.spec.ts for the assertion that holds here.
    <section data-testid="findbar-filters" className="mt-4 text-left pb-2">
      <div className="flex items-center justify-between px-1 mb-2">
        <span className="text-xs text-muted">
          Filters
          {draftCount > 0 && (
            <span
              data-testid="filter-count"
              className="ml-1.5 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-accent text-bg text-[11px] font-display"
            >
              {draftCount}
            </span>
          )}
        </span>
        {draftCount > 0 && (
          <button
            type="button"
            data-testid="filter-clear"
            onClick={clearAll}
            className="text-xs text-accent min-h-[44px] px-2 touch-manipulation underline-offset-4 hover:underline"
          >
            Clear
          </button>
        )}
      </div>

      <VibeAxisAccordion
        active={vibes}
        onToggle={toggleVibe}
        openAxis={openAxis}
        onOpenAxisChange={setOpenAxis}
      />

      {/* Neighborhood — multi-select, same accordion shape as an axis so it
          reads as one more dimension of the same choice. */}
      <div className="space-y-2 mt-2">
        <div className="bg-surface border border-border rounded-3xl overflow-hidden">
          <button
            type="button"
            aria-expanded={hoodOpen}
            onClick={() => setHoodOpen((open) => !open)}
            className="w-full min-h-[56px] touch-manipulation flex items-center justify-between gap-3 px-5 py-3 text-left"
          >
            <span className="font-display text-base">Neighborhood</span>
            <span className="text-muted text-xs truncate max-w-[60%]">
              {hoodSummary || 'Anywhere'}
            </span>
          </button>
          {hoodOpen ? (
            <div
              role="group"
              aria-label="Neighborhood"
              className="flex flex-wrap gap-2 px-5 pb-5"
            >
              {/* "Anywhere" is a real choice, not the absence of one — without
                  it there is no way to clear a multi-select in one tap. */}
              <button
                type="button"
                aria-pressed={hoods.length === 0}
                onClick={() => setHoods(EMPTY_FILTERS.neighborhoods)}
                className={[
                  CHIP_BASE,
                  hoods.length === 0 ? CHIP_ACTIVE : CHIP_INACTIVE,
                ].join(' ')}
              >
                Anywhere
              </button>
              {NEIGHBORHOODS.map((n) => {
                const isActive = hoods.includes(n);
                return (
                  <button
                    key={n}
                    type="button"
                    aria-pressed={isActive}
                    onClick={() => setHoods((prev) => toggleSelection(prev, n))}
                    className={[
                      CHIP_BASE,
                      isActive ? CHIP_ACTIVE : CHIP_INACTIVE,
                    ].join(' ')}
                  >
                    {displayHood(n)}
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
      </div>

      {/* Distance — Walkable / Worth a cab / Anywhere, inside this surface
          rather than as its own rail. Needs a location; disabled with a hint
          otherwise (filterBars also no-ops without coords, defensively). */}
      <div className="space-y-2 mt-2 mb-8">
        <div className="bg-surface border border-border rounded-3xl overflow-hidden">
          <button
            type="button"
            aria-expanded={distanceOpen}
            onClick={() => setDistanceOpen((open) => !open)}
            className="w-full min-h-[56px] touch-manipulation flex items-center justify-between gap-3 px-5 py-3 text-left"
          >
            <span className="font-display text-base">Distance</span>
            <span className="text-muted text-xs truncate max-w-[60%]">
              {hasLocation ? distanceSummary : 'Anywhere'}
            </span>
          </button>
          {distanceOpen ? (
            <div
              role="group"
              aria-label="Distance"
              className="flex flex-wrap gap-2 px-5 pb-5"
            >
              {DISTANCE_CHIPS.map((chip) => {
                const isOn = hasLocation && radiusKind === chip.radius.kind;
                return (
                  <button
                    key={chip.radius.kind}
                    type="button"
                    aria-pressed={isOn}
                    disabled={!hasLocation}
                    onClick={() =>
                      setRadius(
                        chip.radius.kind === 'anywhere' ? null : chip.radius,
                      )
                    }
                    className={[
                      CHIP_BASE,
                      isOn ? CHIP_ACTIVE : CHIP_INACTIVE,
                      'disabled:opacity-50 disabled:cursor-not-allowed',
                    ].join(' ')}
                  >
                    {chip.label}
                  </button>
                );
              })}
              {!hasLocation && (
                <span className="self-center text-xs text-muted">
                  Turn on location to filter by distance
                </span>
              )}
            </div>
          ) : null}
        </div>
      </div>

      <div className="flex flex-col md:flex-row gap-3 justify-center items-center">
        <button
          type="button"
          onClick={() => onApply(draft)}
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
