import type { Bar } from '@/types';
import { barVisual } from '@/lib/barVisual';

type BarVisualTileProps = {
  bar: Bar;
  /** Tile edge in px — 56 on cards, 32 on BarPicker rows. */
  size: 32 | 56;
};

/**
 * The bar's deterministic vibe-tag glyph on its tag-hued background.
 *
 * GLYPH ONLY, deliberately. This tile used to render the bar's ingested
 * photo photo-first with a glyph fallback, which put re-hosted Google Place
 * photos into BarPicker rows, the Want-to-go list, Tonight suggestions,
 * shared night pages and recap rows. Criterion 12 excludes exactly those
 * surfaces: Google media may appear only on a visible recommendation card
 * and in the open lightbox, both of which now go through BarMedia.
 *
 * So this component no longer decides anything about photos — there is one
 * media boundary (src/lib/mediaPolicy.ts) and this is not it. Surfaces that
 * ARE allowed imagery render <BarMedia>, which falls back to this tile.
 *
 * Decorative (the bar name is always adjacent text), so aria-hidden.
 */
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
