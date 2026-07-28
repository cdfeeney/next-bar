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
 * The ONE component that puts a bar's picture on screen.
 *
 * Every surface renders through here so the media-source rules live in a
 * single place: owned → venue → approved user → live Google → legacy cache
 * → glyph (src/lib/mediaPolicy.ts). Before this existed, ResultCard,
 * BarVisualTile and BarLightbox each built their own `/bar-photos/...`
 * URLs, which is why "stop serving Google photos" had no single lever to
 * pull.
 *
 * When every Google source is switched off, this falls through to the
 * glyph tile at the SAME aspect ratio — the card must not resize, or the
 * kill switch becomes a layout regression instead of a safety control.
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

/** Exposed for callers that need to know whether to render attribution. */
export function mediaNeedsAttribution(
  bar: Bar,
  owned: readonly OwnedPhoto[] = [],
  flags: MediaFlags = defaultMediaFlags(),
): boolean {
  return needsGoogleAttribution(resolveMedia(bar, owned, flags));
}
