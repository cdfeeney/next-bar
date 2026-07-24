'use client';

import { useState } from 'react';
import type { Bar } from '@/types';
import { barImageUrl, barVisual } from '@/lib/barVisual';

type BarVisualTileProps = {
  bar: Bar;
  /** Tile edge in px — 56 on ResultCard, 32 on BarPicker rows. */
  size: 32 | 56;
};

/**
 * B5 visual identity tile: the bar's ingested photo when one exists, else
 * the deterministic vibe-tag glyph on its tag-hued background. Photo-first
 * with a live fallback — if the local image 404s (e.g. sidecar has a
 * photoRef but the --photos download hasn't run), onError flips the tile
 * back to the glyph instead of showing a broken image.
 *
 * Decorative (the bar name is always adjacent text), so aria-hidden.
 * Plain <img>, not next/image: the assets are small local static files and
 * the glyph fallback needs a synchronous onError.
 */
export default function BarVisualTile({ bar, size }: BarVisualTileProps) {
  const [imgFailed, setImgFailed] = useState(false);
  const url = barImageUrl(bar);
  const visual = barVisual(bar);
  const showPhoto = url !== null && !imgFailed;

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
      {showPhoto ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt=""
          width={size}
          height={size}
          loading="lazy"
          className="w-full h-full object-cover"
          onError={() => setImgFailed(true)}
        />
      ) : (
        <span className="font-display leading-none">{visual.glyph}</span>
      )}
    </span>
  );
}
