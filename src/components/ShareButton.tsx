'use client';

import { useEffect, useRef, useState } from 'react';
import { isShareAbort } from '@/lib/share';

/**
 * The one share control.
 *
 * Extracted from GroupVote's SharePickButton so every shareable surface
 * behaves identically: native sheet where available (iOS PWA), clipboard
 * everywhere else, and — the part that is easy to get wrong — a dismissed
 * sheet is NOT treated as consent to hijack the clipboard.
 *
 * `path` is app-relative; the origin is read at click time rather than at
 * render, so this stays SSR-safe (no `window` during hydration).
 */
export type ShareButtonProps = {
  /** App-relative path to share, e.g. `/u/connor`. */
  path: string;
  /** Share-sheet text. Also the clipboard payload, prefixed to the URL. */
  text: string;
  /** Visible button label. */
  label: string;
  /** Accessible name, when the visible label is too terse on its own. */
  ariaLabel?: string;
  variant?: 'primary' | 'secondary';
  /** Fired only on a real share/copy — never on dismissal. */
  onShared?: (method: 'native' | 'clipboard') => void;
};

const BASE =
  'min-h-[44px] touch-manipulation px-6 rounded-full font-display text-sm border transition-colors inline-flex items-center justify-center';
const VARIANT = {
  primary: 'bg-accent border-accent text-bg',
  secondary: 'bg-transparent border-border text-muted hover:text-text',
} as const;

/** How long the "Copied ✓" confirmation stays up. */
const COPIED_MS = 2000;

export default function ShareButton({
  path,
  text,
  label,
  ariaLabel,
  variant = 'secondary',
  onShared,
}: ShareButtonProps): JSX.Element {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * Re-entrancy guard. `share()` is async and the button stays enabled, so
   * two fast taps would otherwise both complete — double-firing `onShared`
   * and inflating whatever share metric consumes it.
   */
  const inFlight = useRef(false);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const share = async (): Promise<void> => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      await attemptShare();
    } finally {
      inFlight.current = false;
    }
  };

  const attemptShare = async (): Promise<void> => {
    const url = `${window.location.origin}${path}`;

    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: text, text, url });
        onShared?.('native');
        return;
      } catch (err) {
        // Dismissed the sheet — dismiss ≠ consent. Do nothing at all.
        if (isShareAbort(err)) return;
        // Genuine share failure — fall through to clipboard.
      }
    }

    try {
      await navigator.clipboard.writeText(`${text} ${url}`);
      setCopied(true);
      onShared?.('clipboard');
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), COPIED_MS);
    } catch {
      // Clipboard blocked (permissions, insecure origin) — there is nothing
      // sensible left to do without inventing a fake success state.
    }
  };

  return (
    <button
      type="button"
      // The accessible name must track the visible state. A fixed label
      // would leave screen-reader users with no signal that the copy
      // succeeded, while sighted users see "Copied ✓".
      aria-label={copied ? 'Copied to clipboard' : (ariaLabel ?? label)}
      onClick={() => void share()}
      // ?? guards a caller that bypasses TS: a bad variant would otherwise
      // splice the string "undefined" into className and silently unstyle.
      className={[BASE, VARIANT[variant] ?? VARIANT.secondary].join(' ')}
    >
      {copied ? 'Copied ✓' : label}
    </button>
  );
}
