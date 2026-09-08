'use client';

import type { Bar } from '@/types';
import { barVisual } from '@/lib/barVisual';

type BarVisualTileProps = {
  bar: Bar;
  /** Tile edge in px — 56 on ResultCard, 32 on BarPicker rows. */
  size: 32 | 56;
};

/** Decorative identity tile for surfaces without Google media. */
export default function BarVisualTile({ bar, size }: BarVisualTileProps) {
  const visual = barVisual(bar);

  return (
    <span
      data-testid="bar-visual"
      aria-hidden="true"
      className={`shrink-0 overflow-hidden flex items-center justify-center select-none ${
        size === 56 ? 'rounded-2xl' : 'rounded-lg'
      }`}
      style={{
        width: size,
        height: size,
        backgroundColor: visual.bg,
        color: visual.fg,
        fontSize: size === 56 ? 26 : 15,
      }}
    >
      <span className="font-display leading-none">{visual.glyph}</span>
    </span>
  );
}
