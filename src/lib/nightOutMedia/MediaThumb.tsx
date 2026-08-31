'use client';

import { useMediaUrl } from './useMediaUrl';

/**
 * One photo, resolved through the media boundary.
 *
 * Small on purpose: every Night Out and Saved Nights Out surface renders photos
 * the same way, and the four states — still loading, here, gone, and couldn't
 * load — are the part that must not drift. A photo whose bytes the author
 * deleted everywhere renders as an explicit, worded absence rather than as a
 * broken image or a decorative placeholder that reads like a picture.
 *
 * GONE AND COULDN'T-LOAD ARE DIFFERENT CLAIMS (round-4 panel, Codex). Telling
 * the owner of a saved night that a photo "is no longer available" because the
 * network dropped is a statement about their archive that we have no evidence
 * for — and one a retention hold is specifically keeping false. The temporary
 * state says so and offers the retry.
 *
 * Plain <img>: the source is a short-lived signed URL, which next/image cannot
 * optimise and would only proxy.
 */
export default function MediaThumb({
  mediaId,
  alt,
  className = '',
}: {
  mediaId: string;
  /**
   * REQUIRED, and empty string is a legitimate value. A photo that carries no
   * caption is decorative to a screen reader and `alt=""` is the correct way to
   * say so; leaving the attribute off entirely is not.
   */
  alt: string;
  className?: string;
}): JSX.Element {
  const state = useMediaUrl(mediaId);
  const box = `bg-surface border border-border overflow-hidden ${className}`;

  if (state.status === 'loading') {
    return <span className={box} aria-hidden="true" data-testid="media-loading" />;
  }

  if (state.status === 'gone') {
    return (
      <span
        className={`${box} flex items-center justify-center p-2`}
        data-testid="media-gone"
      >
        <span className="text-muted text-[11px] text-center leading-tight">
          Photo no longer available
        </span>
      </span>
    );
  }

  if (state.status === 'unavailable') {
    return (
      <span
        className={`${box} flex items-center justify-center p-2`}
        data-testid="media-unavailable"
      >
        <button
          type="button"
          onClick={state.retry}
          data-testid="media-retry"
          className="text-muted text-[11px] text-center leading-tight underline underline-offset-2"
        >
          Couldn&apos;t load this photo. Tap to try again.
        </button>
      </span>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={state.url}
      alt={alt}
      data-testid="media-photo"
      className={`${box} object-cover`}
    />
  );
}
