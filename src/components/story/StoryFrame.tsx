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
}: {
  photo: StoryPhoto;
  barId: string | null;
  className?: string;
  /** Inset width — narrower inside a Feed card than inside the viewer. */
  insetClassName?: string;
}): JSX.Element {
  return (
    <div
      data-testid="story-frame"
      data-photo-kind={photo.kind}
      className={`relative overflow-hidden bg-surface ${className}`}
    >
      <Surface url={photo.main} barId={barId} />
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
}: {
  url: string | null;
  barId: string | null;
}): JSX.Element {
  if (url !== null) {
    // Plain <img>: the source is a capture-time data URL, which next/image
    // cannot optimise and would only re-encode.
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt="" className="w-full h-full object-cover" />;
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
