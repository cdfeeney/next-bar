'use client';

import { getBarById } from '@/lib/catalog';
import { barVisual } from '@/lib/barVisual';
import type { StoryPhoto } from './storyStore';

/**
 * The photo area of a story or a Feed memory: the captured image when there
 * are bytes behind it, otherwise a deterministic tag-hued field derived from
 * the bar the poster chose — the same `barVisual` identity every other
 * photoless surface in the app falls back to (`BarVisualTile`).
 *
 * The dual-shot inset is anchored LOWER-RIGHT and is drawn here, not by the
 * viewer, so a single photo and a pair place their metadata identically:
 * "the inset never moves the tags" (story-tag-placement).
 */
export default function StoryFrame({
  photo,
  barId,
  className = '',
  insetClassName = 'w-24',
  fit = 'cover',
}: {
  photo: StoryPhoto;
  barId: string | null;
  className?: string;
  /** Inset width — narrower inside a Feed card than inside the viewer. */
  insetClassName?: string;
  /**
   * How the MAIN photo meets the box. Feed cards and thumbnails crop to fill
   * ('cover'); the full-screen viewer letterboxes instead ('contain') so a
   * portrait phone box never crops a landscape photo's top edge — the tagged
   * people at the top of a laptop-posted shot were being cut off on iPhone.
   * The dual-shot inset always covers: it is a thumbnail by definition.
   */
  fit?: 'cover' | 'contain';
}): JSX.Element {
  return (
    <div
      data-testid="story-frame"
      data-photo-kind={photo.kind}
      className={`relative overflow-hidden bg-surface ${className}`}
    >
      <Surface url={photo.main} barId={barId} state={photo.state} fit={fit} />
      {photo.kind === 'dual' ? (
        <div
          data-testid="story-frame-inset"
          className={`absolute bottom-3 right-3 aspect-[3/4] overflow-hidden rounded-xl border border-border ${insetClassName}`}
        >
          <Surface url={photo.inset ?? null} barId={barId} />
        </div>
      ) : null}
    </div>
  );
}

function Surface({
  url,
  barId,
  state = 'ok',
  fit = 'cover',
}: {
  url: string | null;
  barId: string | null;
  state?: 'ok' | 'expired' | 'unsigned';
  fit?: 'cover' | 'contain';
}): JSX.Element {
  // AN OUTAGE IS NOT AN ABSENT PHOTO. A failed signing used to fall through to
  // the decorative bar glyph below, which is the same thing a story with no
  // image shows — so the user saw a story that looked fine and simply had no
  // picture, rather than being told the photo could not be loaded. The glyph
  // stays the fallback for 'ok' and 'expired'; only a real failure says so.
  if (url === null && state === 'unsigned') {
    return (
      <span
        data-testid="story-media-unavailable"
        className="w-full h-full flex items-center justify-center select-none bg-surface text-muted text-xs text-center px-4"
      >
        This photo could not be loaded.
      </span>
    );
  }
  if (url !== null) {
    // Plain <img>: the source is a capture-time data URL, which next/image
    // cannot optimise and would only re-encode.
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={url}
        alt=""
        className={`w-full h-full ${
          fit === 'contain' ? 'object-contain' : 'object-cover'
        }`}
      />
    );
  }
  const bar = barId !== null ? getBarById(barId) : undefined;
  const visual = bar ? barVisual(bar) : null;
  return (
    <span
      aria-hidden="true"
      className="w-full h-full flex items-center justify-center select-none"
      style={
        visual
          ? { backgroundColor: visual.bg, color: visual.fg }
          : undefined
      }
    >
      <span className="font-display text-3xl leading-none">
        {visual?.glyph ?? ''}
      </span>
    </span>
  );
}
