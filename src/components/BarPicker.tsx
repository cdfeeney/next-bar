'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Bar, ManhattanNeighborhood } from '@/types';
import { useBars } from '@/lib/useBars';
import { displayHood } from '@/lib/hoodDisplay';
import { watchSearchVisibility, type WatchHandle } from '@/lib/searchBarAutoHide';
import RatingBadge from '@/components/RatingBadge';
import BarVisualTile from '@/components/BarVisualTile';

type BarPickerProps = {
  onPick: (bar: Bar) => void;
  onNotListed?: () => void;
  /**
   * Hide the sticky search bar while the user scrolls down; reveal on
   * scroll-up, near the top, or on focus (g-90f908bc). Opt-in per call site:
   * on `/` the picker fills the document scroller and a pinned opaque bar
   * over ~975 rows leaves whatever row rests under it untappable
   * (mobile-controls pass 2 proves it). The dialog and inline call sites
   * keep today's always-pinned behavior until reviewed separately.
   */
  autoHideSearchOnScroll?: boolean;
};

const NEIGHBORHOOD_ORDER: ManhattanNeighborhood[] = [
  'Midtown',
  "Hell's Kitchen",
  'East Village',
  'LES',
  'SoHo',
  'West Village',
  'Chelsea',
  'UWS',
  'UES',
  'Harlem',
  'FiDi',
  'Williamsburg',
  'Greenpoint',
  'Bushwick',
  'Park Slope',
  'Fort Greene',
  'Astoria',
  'LIC',
];

export default function BarPicker({
  onPick,
  onNotListed,
  autoHideSearchOnScroll = false,
}: BarPickerProps) {
  const [query, setQuery] = useState('');
  const bars = useBars();

  // Auto-hide (opt-in): opacity/pointer-events only — layout is untouched, so
  // hiding can never reflow the list (which is what deferredCatalogSwap
  // protects against). The input stays in the a11y tree and focusable while
  // hidden; focus forces it visible (see searchBarAutoHide.ts for why
  // aria-hidden is the worse trade).
  //
  // Opacity and pointer-events must flip ATOMICALLY (never transition
  // opacity): a fading bar is a state where opacity≠0 while hit-testing
  // already passes through, which reads as "covered" to any observer that
  // samples computed style + elementFromPoint — mobile-controls pass 2
  // caught exactly that race. Only the transform animates.
  const [searchVisible, setSearchVisible] = useState(true);
  const searchRef = useRef<HTMLInputElement>(null);
  const watchRef = useRef<WatchHandle | null>(null);
  useEffect(() => {
    if (!autoHideSearchOnScroll) return;
    const handle = watchSearchVisibility({
      isFocused: () => document.activeElement === searchRef.current,
      onChange: setSearchVisible,
      anchor: () => searchRef.current,
    });
    watchRef.current = handle;
    return () => {
      watchRef.current = null;
      handle.stop();
    };
  }, [autoHideSearchOnScroll]);

  const grouped = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const filtered = normalized
      ? bars.filter((b) => b.name.toLowerCase().includes(normalized))
      : bars;

    const groups = new Map<ManhattanNeighborhood, Bar[]>();
    for (const bar of filtered) {
      const existing = groups.get(bar.neighborhood);
      if (existing) {
        existing.push(bar);
      } else {
        groups.set(bar.neighborhood, [bar]);
      }
    }

    for (const list of groups.values()) {
      list.sort((a, b) => a.name.localeCompare(b.name));
    }

    return groups;
  }, [query, bars]);

  return (
    /*
      Deliberately NO bottom-nav clearance here. This component has four call
      sites and only ONE of them sits in normal flow under the fixed nav
      (WhereNextFlow, the / page) — which is where the clearance now lives. The
      other three are two `fixed inset-0 z-[1100]` dialogs that render ABOVE the
      z-[1000] nav and already have their own pb-8, plus an inline expand-in-place
      panel on /lists where extra padding shows as dead space inside a card.
      A page-shell artifact like a fixed nav is the consumer's concern, not this
      component's.
    */
    <section className="max-w-2xl mx-auto">
      <input
        ref={searchRef}
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => {
          // Through the watcher, never setSearchVisible directly: the watcher
          // is the single writer, and a direct write desyncs its change-dedup
          // cache (the bar would stick visible after focus→blur→scroll-down).
          watchRef.current?.reveal();
        }}
        placeholder="Search bars..."
        aria-label="Search bars"
        className={`w-full bg-surface border border-border rounded-2xl px-4 py-3 mb-4 focus:border-accent outline-none text-base sticky top-0 z-10 transition-transform duration-200 ${
          searchVisible ? '' : 'opacity-0 pointer-events-none -translate-y-2'
        }`}
      />

      <div>
        {NEIGHBORHOOD_ORDER.map((neighborhood) => {
          const list = grouped.get(neighborhood);
          if (!list || list.length === 0) {
            return null;
          }
          return (
            <div key={neighborhood}>
              <h3 className="font-display text-sm uppercase tracking-wider text-muted px-4 py-2">
                {displayHood(neighborhood)}
              </h3>
              <ul>
                {list.map((bar) => (
                  <li key={bar.id}>
                    <button
                      type="button"
                      onClick={() => onPick(bar)}
                      className="w-full min-h-[56px] flex items-center justify-between gap-3 px-4 py-3 border-b border-border hover:bg-surface active:bg-surface touch-manipulation text-left"
                    >
                      <span className="font-display flex items-center gap-2 min-w-0">
                        <BarVisualTile bar={bar} size={32} />
                        <span className="truncate">{bar.name}</span>
                        <RatingBadge barId={bar.id} />
                      </span>
                      <span className="text-muted text-xs shrink-0">
                        {bar.address}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>

      {onNotListed ? (
        <div className="px-4 py-6 text-center border-t border-border mt-4">
          <button
            type="button"
            onClick={onNotListed}
            className="text-accent underline-offset-4 hover:underline text-sm min-h-[44px] touch-manipulation"
          >
            Not listed? Tell us where you are &rarr;
          </button>
        </div>
      ) : null}
    </section>
  );
}
