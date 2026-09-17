'use client';

import { useEffect, useState } from 'react';
import { coverSourceOf } from '@/lib/nightOutCovers';
import { useMediaUrl } from '@/lib/nightOutMedia/useMediaUrl';

/**
 * A cover has no manual retry affordance the way NightOutMedia does, so a single
 * transient boundary blip — a 503 while the media env warms, a dropped request —
 * must not strand it at 'loading' forever. Retry the route a bounded number of
 * times, backing off, before giving up. The server's 404 ('gone') is terminal
 * and never retried; only 'unavailable' (we could not ask) is.
 */
const MAX_COVER_RETRIES = 4;
const COVER_RETRY_BASE_MS = 400;

/**
 * S-06b / S-06c — a plan's cover, wherever it shows (form tile, plan board
 * header, invitation card). Renders nothing for no cover OR an unrecognised
 * value. A template is a bundled asset; a library photo (`media:<id>`) resolves
 * through `/api/media/:id/url` — the boundary route that asks
 * `media_read_window` as the caller — never off Storage.
 *
 * A FAILED IMAGE LOAD IS NOT AN EMPTY COVER: the states stay apart, as the
 * media components already do. On load failure the picture is dropped; a
 * TEMPLATE keeps its label on the chip, so the owner still sees which cover
 * the plan carries, while a library photo carries no chip at all (it is seen
 * by every member, so "Your photo" was wrong for all but one — R-05a) and
 * shows its failed state by `data-cover-state` alone: `ok`, `failed`, or — for
 * a photo whose URL has not resolved yet — `loading`.
 */
export default function CoverImage({
  cover,
  className = '',
  showLabel = true,
  testId = 'cover-image',
}: {
  cover: string | null | undefined;
  className?: string;
  showLabel?: boolean;
  testId?: string;
}): JSX.Element | null {
  // Keyed on the VALUE that failed, not a bare boolean (round-1 panel, Codex
  // MEDIUM): the same instance is reused when the owner picks another
  // template, and a boolean would keep the new picture gated off forever.
  const [failedFor, setFailedFor] = useState<string | null>(null);
  const source = coverSourceOf(cover);
  const isMedia = source?.kind === 'media';
  // Hooks run unconditionally; a template asks the route for nothing.
  const media = useMediaUrl(isMedia ? source.mediaId : null);

  // Bounded auto-retry over a transient 'unavailable', reset when the cover
  // changes. 'gone' (the route's 404) and 'ready' are terminal and never retry.
  const [retries, setRetries] = useState(0);
  useEffect(() => {
    setRetries(0);
  }, [cover]);
  useEffect(() => {
    if (!isMedia || media.status !== 'unavailable' || retries >= MAX_COVER_RETRIES) {
      return undefined;
    }
    const timer = setTimeout(() => {
      setRetries((n) => n + 1);
      media.retry();
    }, COVER_RETRY_BASE_MS * (retries + 1));
    return () => clearTimeout(timer);
  }, [isMedia, media, retries]);

  if (source === null) return null;
  // The route's 404 is its one authoritative "no" (deleted, or not ours to
  // read); a transient 'unavailable' shows as loading WHILE we retry, and only
  // once the retries are spent does it settle to failed rather than spin forever.
  const exhausted = isMedia && media.status === 'unavailable' && retries >= MAX_COVER_RETRIES;
  const failed = failedFor === cover || (isMedia && media.status === 'gone') || exhausted;
  const src = isMedia
    ? media.status === 'ready' ? media.url : null
    : source.template.src;
  // A library cover is shown to EVERY viewer of the plan, so a chip reading
  // "Your photo" was wrong for everyone but the owner (S-06c panel, R-05a).
  // Templates keep their label; a media cover carries none.
  const label = isMedia ? null : source.template.label;
  const state = failed ? 'failed' : src === null ? 'loading' : 'ok';
  return (
    <div
      data-testid={testId}
      data-cover={isMedia ? 'media' : source.template.key}
      data-cover-state={state}
      className={`relative overflow-hidden bg-surface ${className}`}
    >
      {src !== null && !failed ? (
        // A bundled static asset or a signed URL; next/image would only add an
        // optimizer hop in front of it.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={label === null ? 'Cover photo' : `${label} cover`}
          className="absolute inset-0 h-full w-full object-cover"
          onError={() => setFailedFor(cover ?? null)}
        />
      ) : null}
      {showLabel && label !== null ? (
        <span className="absolute bottom-3 left-3 rounded-full bg-text/85 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.16em] text-bg">
          {label}
        </span>
      ) : null}
    </div>
  );
}
