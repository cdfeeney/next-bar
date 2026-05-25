'use client';

import { useMemo, useState } from 'react';
import type { Bar, ManhattanNeighborhood } from '@/types';
import { bars } from '@/lib/bars';
import RatingBadge from '@/components/RatingBadge';

type BarPickerProps = {
  onPick: (bar: Bar) => void;
  onNotListed?: () => void;
};

const NEIGHBORHOOD_ORDER: ManhattanNeighborhood[] = [
  'Midtown',
  'East Village',
  'LES',
  'West Village',
  'Chelsea',
  'UWS',
  'UES',
  'FiDi',
];

export default function BarPicker({ onPick, onNotListed }: BarPickerProps) {
  const [query, setQuery] = useState('');

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
  }, [query]);

  return (
    <section className="max-w-2xl mx-auto">
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search bars..."
        aria-label="Search bars"
        className="w-full bg-surface border border-border rounded-2xl px-4 py-3 mb-4 focus:border-accent outline-none text-base sticky top-0 z-10"
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
                {neighborhood}
              </h3>
              <ul>
                {list.map((bar) => (
                  <li key={bar.id}>
                    <button
                      type="button"
                      onClick={() => onPick(bar)}
                      className="w-full min-h-[56px] flex items-baseline justify-between gap-3 px-4 py-3 border-b border-border hover:bg-surface active:bg-surface touch-manipulation text-left"
                    >
                      <span className="font-display flex items-center gap-2 min-w-0">
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
