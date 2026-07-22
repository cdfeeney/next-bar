'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

const DISMISS_KEY = 'next-bar:install-nudge-dismissed:v1';

/**
 * A subtle, dismissible one-line install hint for use inside FUNCTIONAL flows
 * (e.g. quiz results) — deliberately not the full-page `AppStoreCta` marketing
 * block, which belongs only on `/install` + Settings. Tapping through routes to
 * `/install`, where the actual install machinery (`InstallPrompt`) lives, so
 * functional pages stay free of marketing weight.
 *
 * Shows only on phones where "add to home screen" is a real path, never when
 * already installed, and never again once dismissed (persisted in localStorage).
 */
function isEligible(): boolean {
  if (typeof window === 'undefined') return false;

  // Already installed — running in standalone display mode.
  const isStandalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as { standalone?: boolean }).standalone === true;
  if (isStandalone) return false;

  const ua = window.navigator.userAgent;
  return /iPad|iPhone|iPod|Android/.test(ua);
}

export default function InstallNudge() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!isEligible()) return;
    try {
      if (window.localStorage.getItem(DISMISS_KEY) === '1') return;
    } catch {
      // Storage blocked (private mode) — still fine to show.
    }
    setVisible(true);
  }, []);

  if (!visible) return null;

  const dismiss = () => {
    setVisible(false);
    try {
      window.localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      // Ignore quota / private-mode errors.
    }
  };

  return (
    <div
      data-testid="install-nudge"
      className="mx-6 my-4 flex items-center gap-3 rounded-2xl border border-border bg-surface/60 px-4 py-3"
    >
      <span aria-hidden="true" className="text-lg leading-none">
        📲
      </span>
      <p className="flex-1 text-sm text-muted leading-snug">
        Like these picks?{' '}
        <Link
          href="/install"
          className="text-accent underline-offset-4 hover:underline"
        >
          Add Next Bar to your home screen
        </Link>{' '}
        for one-tap nights.
      </p>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss install prompt"
        className="-mr-2 inline-flex min-h-[44px] min-w-[44px] touch-manipulation items-center justify-center text-xl text-muted hover:text-text"
      >
        ×
      </button>
    </div>
  );
}
