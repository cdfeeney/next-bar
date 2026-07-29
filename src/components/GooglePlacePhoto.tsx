'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  SDK_LOAD_TIMEOUT_MS,
  hasRequested,
  isPlacesUiKitConfigured,
  loadPlacesUiKit,
  markRequested,
} from '@/lib/placesUiKit';

/**
 * The compliant photo surface: Google's own Places UI Kit web component renders
 * the photo, so we never receive, store or re-host the bytes.
 *
 * This is the replacement for `public/bar-photos/` — 3,435 photo files
 * downloaded from Google, re-encoded and served from our domain, which Google's
 * Places policy does not permit (only `place_id` is exempt from its caching
 * restrictions). See docs/UI-KIT-BUILD-PLAN.md.
 *
 * COST. Each component request is one billable event ($1.00/1,000, first 10,000
 * per month free) regardless of how much content it renders, so the only lever
 * is issuing fewer requests. Two behaviours here do that work:
 *
 *   - Lazy mount. The widget is not created until the card scrolls into view, so
 *     a long result list bills for what the user actually reaches, not for
 *     everything rendered.
 *   - Keep mounted. Once created it is never torn down on scroll. A destroyed
 *     widget has nothing to show, so remounting necessarily refetches and
 *     rebills — re-mount amplification is what turns a ~$140/month bill into
 *     ~$590 at the same traffic.
 *
 * The elements are built imperatively rather than in JSX. They are custom
 * elements with no React typings, and more importantly this keeps the moment of
 * creation — the billable moment — explicit and in one place.
 */

type GooglePlacePhotoProps = {
  /** Google place_id. The only Google value we are permitted to retain. */
  placeId: string;
  /**
   * False on surfaces criterion 12 excludes (pickers, saved lists, recaps,
   * dense maps, markers). Defence in depth: those surfaces should not render
   * this component at all, so the SDK never reaches their bundle.
   */
  allowed?: boolean;
  className?: string;
  /** Rendered whenever a photo cannot be shown. Never a broken tile. */
  fallback: ReactNode;
  /** Fires once when a billable request is actually issued. For the meter. */
  onBillableRequest?: (placeId: string) => void;
};

type Status = 'pending' | 'ready' | 'unavailable';

export default function GooglePlacePhoto({
  placeId,
  allowed = true,
  className,
  fallback,
  onBillableRequest,
}: GooglePlacePhotoProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const builtRef = useRef(false);
  const [status, setStatus] = useState<Status>('pending');

  useEffect(() => {
    if (!allowed || !placeId || !isPlacesUiKitConfigured()) {
      setStatus('unavailable');
      return;
    }

    const host = hostRef.current;
    if (!host) return;

    let cancelled = false;
    let timer: number | undefined;

    const build = async () => {
      // StrictMode double-invokes effects in development. Without this guard
      // that is a duplicated billable request per card, every render.
      if (builtRef.current || cancelled) return;
      builtRef.current = true;

      const ok = await loadPlacesUiKit();
      if (cancelled) return;
      if (!ok) {
        setStatus('unavailable');
        return;
      }

      const details = document.createElement('gmp-place-details');

      const request = document.createElement('gmp-place-details-place-request');
      request.setAttribute('place', placeId);

      const config = document.createElement('gmp-place-content-config');

      const media = document.createElement('gmp-place-media');
      media.setAttribute('lightbox-preferred', '');

      // Attribution lives HERE, not in each consumer. Google treats missing
      // attribution as a policy violation, and making every surface remember it
      // is how one eventually forgets.
      const attribution = document.createElement('gmp-place-attribution');
      attribution.setAttribute('light-scheme-color', 'gray');
      attribution.setAttribute('dark-scheme-color', 'white');

      config.append(media, attribution);
      details.append(request, config);

      details.addEventListener('gmp-load', () => {
        if (cancelled) return;
        window.clearTimeout(timer);
        setStatus('ready');
      });

      // A widget that never loads must not sit as an empty box forever.
      timer = window.setTimeout(() => {
        if (!cancelled) setStatus('unavailable');
      }, SDK_LOAD_TIMEOUT_MS);

      // Appending is the billable moment — record it here and nowhere else.
      const alreadyCounted = hasRequested(placeId);
      host.appendChild(details);
      markRequested(placeId);
      if (!alreadyCounted) onBillableRequest?.(placeId);
    };

    // Lazy mount. IntersectionObserver is absent in some test environments;
    // fall back to building immediately rather than never showing a photo.
    if (typeof IntersectionObserver === 'undefined') {
      void build();
      return () => {
        cancelled = true;
        window.clearTimeout(timer);
      };
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          observer.disconnect();
          void build();
        }
      },
      // Start slightly before the card is visible so the photo is there by the
      // time the user reaches it, without prefetching the whole list.
      { rootMargin: '200px' },
    );
    observer.observe(host);

    return () => {
      cancelled = true;
      observer.disconnect();
      window.clearTimeout(timer);
    };
    // placeId is intentionally the only dependency: re-running this effect is a
    // billable event, so it must not be triggered by unrelated prop churn.
  }, [placeId, allowed, onBillableRequest]);

  if (status === 'unavailable') return <>{fallback}</>;

  return (
    <div
      ref={hostRef}
      data-testid="google-place-photo"
      data-status={status}
      // The 21/9 box is reserved from first paint, before the SDK has loaded,
      // so degrading to the glyph shifts nothing. CLS is the reason this is an
      // aspect-ratio container and not a height that grows with its content.
      className={className ?? 'w-full aspect-[21/9] overflow-hidden'}
    />
  );
}
