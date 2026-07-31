'use client';

import { useState } from 'react';
import type { Bar } from '@/types';
import BarVisualTile from '@/components/BarVisualTile';
import GoogleAttribution from '@/components/GoogleAttribution';
import {
  defaultMediaFlags,
  needsGoogleAttribution,
  resolveMedia,
  type MediaFlags,
  type OwnedPhoto,
} from '@/lib/mediaPolicy';

/**
 * A ready-made media renderer: resolveMedia + glyph fallback + attribution.
 *
 * NOT CURRENTLY MOUNTED BY ANY PAGE. Read that literally — an earlier version
 * of this comment claimed to be "the ONE component that puts a bar's picture
 * on screen", and that was false. The surfaces that render imagery
 * (ResultCard, BarLightbox, RecapCard — and /discover until it was archived in
 * goal g-12d33864) call `resolveMedia` from
 * src/lib/mediaPolicy.ts directly, because each has bespoke chrome — gradient
 * overlay, photo-count badge, overlaid venue name, swipe transform — that this
 * component's markup cannot express.
 *
 * So the single boundary is **src/lib/mediaPolicy.ts**, not this file. That
 * boundary is real and verifiable: `barImageUrls` has exactly one caller, and
 * mediaPolicy is it. This component is a convenience wrapper for any future
 * surface that wants the default chrome, kept because it is the only place the
 * ordered fallback and attribution are composed together and tested end to
 * end.
 *
 * If no surface adopts it, delete it rather than letting it rot — a tested
 * component nothing renders is a liability that reads like a guarantee.
 *
 * When every Google source is switched off, this falls through to the glyph
 * tile at the SAME aspect ratio — the card must not resize, or the kill switch
 * becomes a layout regression instead of a safety control.
 */
export default function BarMedia({
  bar,
  owned = [],
  aspectClassName = 'aspect-[21/9]',
  eager = false,
  onClick,
  ariaLabel,
  flags,
}: {
  bar: Bar;
  owned?: readonly OwnedPhoto[];
  flags?: MediaFlags;
  aspectClassName?: string;
  eager?: boolean;
  onClick?: () => void;
  ariaLabel?: string;
}): JSX.Element {
  const decision = resolveMedia(bar, owned, flags ?? defaultMediaFlags());
  const urls = decision.source === 'google-live' || decision.source === 'glyph'
    ? []
    : decision.urls;

  const [idx, setIdx] = useState(0);
  const [failed, setFailed] = useState(false);

  // Google LIVE is not wired yet (UI Kit is pre-GA and its spend caps are
  // not in place). Until it is, a google-live decision renders the glyph
  // rather than a hole — the panel lands in Phase 1.5 behind this same
  // component, so no caller changes when it does.
  const showGlyph = urls.length === 0 || failed;

  const body = showGlyph ? (
    <div
      className={`w-full ${aspectClassName} flex items-center justify-center bg-surface`}
      data-testid="bar-media-glyph"
    >
      <BarVisualTile bar={bar} size={56} />
    </div>
  ) : (
    /* eslint-disable-next-line @next/next/no-img-element */
    <img
      src={urls[idx]}
      alt=""
      data-testid="bar-visual"
      data-media-source={decision.source}
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      className={`w-full ${aspectClassName} object-cover`}
      onError={() =>
        idx + 1 < urls.length ? setIdx(idx + 1) : setFailed(true)
      }
    />
  );

  const content = onClick ? (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className="block w-full touch-manipulation focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      {body}
    </button>
  ) : (
    body
  );

  return (
    <>
      {content}
      {needsGoogleAttribution(decision) && !showGlyph ? (
        /* VISIBLE, not sr-only. Google's terms require the attribution to be
         * shown; a screen-reader-only label is the absence of attribution for
         * every sighted user, which is precisely the exposure this closes. */
        <GoogleAttribution bar={bar} label="Photo via Google" className="mt-1" />
      ) : null}
    </>
  );
}
