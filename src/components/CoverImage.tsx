'use client';

import { useState } from 'react';
import { coverTemplateOf } from '@/lib/nightOutCovers';

/**
 * S-06b — a plan's cover, wherever it shows (form tile, plan board header,
 * invitation card). Renders nothing for no cover OR an unrecognised value.
 *
 * A FAILED IMAGE LOAD IS NOT AN EMPTY COVER: the states stay apart, as the
 * media components already do. On load failure the picture is dropped and the
 * template's name stays on the chip, so the owner still sees which cover the
 * plan carries; `data-cover-state` says which of the three it is.
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
  const [failed, setFailed] = useState(false);
  const template = coverTemplateOf(cover);
  if (template === null) return null;
  return (
    <div
      data-testid={testId}
      data-cover={template.key}
      data-cover-state={failed ? 'failed' : 'ok'}
      className={`relative overflow-hidden bg-surface ${className}`}
    >
      {!failed ? (
        // A bundled static asset under public/; next/image would only add an
        // optimizer hop in front of an SVG.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={template.src}
          alt={`${template.label} cover`}
          className="absolute inset-0 h-full w-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : null}
      {showLabel ? (
        <span className="absolute bottom-3 left-3 rounded-full bg-text/85 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.16em] text-bg">
          {template.label}
        </span>
      ) : null}
    </div>
  );
}
