'use client';

import type { ManhattanNeighborhood } from '@/types';
import { displayHood } from '@/lib/hoodDisplay';

type NeighborhoodPickerProps = {
  selected: ManhattanNeighborhood[];
  onChange: (next: ManhattanNeighborhood[]) => void;
  title?: string;
  helper?: string;
  multi?: boolean;
};

const ALL: ManhattanNeighborhood[] = [
  // Manhattan
  'FiDi',
  'LES',
  'SoHo',
  'East Village',
  'West Village',
  'Chelsea',
  'Midtown',
  "Hell's Kitchen",
  'UWS',
  'UES',
  'Harlem',
  'Tribeca',
  'Battery Park City',
  'Hamilton Heights',
  'Flatiron',
  // Brooklyn
  'Williamsburg',
  'Greenpoint',
  'Bushwick',
  'Park Slope',
  'Fort Greene',
  'Gowanus',
  // Queens
  'Astoria',
  'LIC',
  'Ridgewood',
];

export default function NeighborhoodPicker({
  selected,
  onChange,
  title = 'Pick a neighborhood',
  helper,
  multi = true,
}: NeighborhoodPickerProps) {
  const handleToggle = (neighborhood: ManhattanNeighborhood) => {
    if (!multi) {
      onChange([neighborhood]);
      return;
    }

    const isSelected = selected.includes(neighborhood);
    const next = isSelected
      ? selected.filter((n) => n !== neighborhood)
      : [...selected, neighborhood];
    onChange(next);
  };

  return (
    <section className="max-w-2xl mx-auto px-6">
      <h2 className="font-display text-2xl md:text-3xl text-center mb-2">
        {title}
      </h2>
      {helper ? (
        <p className="text-muted text-sm text-center mb-6">{helper}</p>
      ) : (
        <div className="mb-6" />
      )}

      <div
        role="group"
        aria-label={title}
        className="grid grid-cols-2 md:grid-cols-4 gap-3"
      >
        {ALL.map((neighborhood) => {
          const isSelected = selected.includes(neighborhood);
          return (
            <button
              key={neighborhood}
              type="button"
              aria-pressed={isSelected}
              onClick={() => handleToggle(neighborhood)}
              className={[
                'min-h-[44px] py-3 px-4 rounded-2xl touch-manipulation',
                'font-display text-base text-center',
                'transition-colors',
                isSelected
                  ? 'bg-accent text-bg border border-accent'
                  : 'bg-surface text-text border border-border hover:border-accent',
              ].join(' ')}
            >
              {displayHood(neighborhood)}
            </button>
          );
        })}
      </div>
    </section>
  );
}
