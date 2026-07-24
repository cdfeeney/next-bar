'use client';

import { useEffect, useState } from 'react';

/**
 * Location-blocked explainer (operator report 2026-07-25: on iPhone the
 * site "never asks" for location). Two distinct iOS blockers produce that
 * exact symptom, and neither can be fixed by the page — only explained:
 *
 *   1. Safari's per-site setting is Deny (user tapped "Don't Allow" once;
 *      iOS remembers silently).
 *   2. The OS-level toggle: Settings → Privacy & Security → Location
 *      Services → Safari Websites is off/Never — Safari then never shows
 *      ANY site a location prompt.
 *
 * Rendered only when the app KNOWS access is blocked (permission 'denied'
 * or a denied request outcome) — never as noise on the happy path. The
 * surrounding surface always keeps its no-location fallback usable.
 */
export default function LocationAccessHelp({
  onRetry,
}: {
  onRetry?: () => void;
}): JSX.Element {
  // UA sniff is for COPY only (which settings path to describe), never
  // behavior.
  const [isIos, setIsIos] = useState(false);
  useEffect(() => {
    setIsIos(/iPhone|iPad|iPod/.test(navigator.userAgent));
  }, []);

  return (
    <div
      role="note"
      aria-label="How to enable location"
      className="bg-surface border border-border rounded-2xl p-4 text-left"
    >
      <p className="font-display text-sm mb-2">
        Location is blocked for this site
      </p>
      {isIos ? (
        <ol className="text-xs text-muted leading-relaxed list-decimal pl-4 space-y-1.5">
          <li>
            In Safari, tap the <span className="text-text">ᴀA</span> button in
            the address bar → <span className="text-text">Website Settings</span>{' '}
            → <span className="text-text">Location</span> →{' '}
            <span className="text-text">Allow</span>.
          </li>
          <li>
            If Safari never even asks: open{' '}
            <span className="text-text">Settings → Privacy &amp; Security →
            Location Services</span>, make sure it&apos;s on, then scroll to{' '}
            <span className="text-text">Safari Websites</span> and pick{' '}
            <span className="text-text">While Using the App</span>.
          </li>
        </ol>
      ) : (
        <p className="text-xs text-muted leading-relaxed">
          Your browser has location turned off for this site — look for the
          location icon in the address bar (or the site settings menu) and
          set it to Allow.
        </p>
      )}
      <div className="mt-3 flex items-center gap-4">
        {onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            className="text-xs text-accent font-display min-h-[44px] inline-flex items-center touch-manipulation hover:underline underline-offset-4"
          >
            Try again
          </button>
        ) : null}
        <p className="text-[11px] text-muted">
          Everything still works without it — pick a bar or neighborhood
          instead.
        </p>
      </div>
    </div>
  );
}
