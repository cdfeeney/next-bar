'use client';

import { useEffect, useRef } from 'react';
import { cycleFocusWithin } from '@/lib/focusTrap';

/**
 * The bottom-sheet shell every story sheet shares — tagged people, Where was
 * this?, Tag friends, Story audience. One implementation of the overlay
 * contract the rest of the app already keeps: dialog semantics, Escape and
 * backdrop close, focus moves in on open and CYCLES inside, and focus returns
 * to the opener on unmount.
 *
 * z-[1200] puts a sheet above the z-[1100] surface that opened it, which is
 * itself above the bottom nav's z-[1000].
 *
 * `position` exists because one caller (the tagged-people sheet) opens INSIDE
 * the story viewer, which is itself a fixed overlay, and must sit within it
 * rather than over the whole document.
 */
export default function Sheet({
  label,
  testId,
  position = 'fixed',
  onClose,
  children,
}: {
  label: string;
  testId: string;
  position?: 'fixed' | 'absolute';
  onClose: () => void;
  children: React.ReactNode;
}): JSX.Element {
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    return () => opener?.focus?.({ preventScroll: true });
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key === 'Tab' && cycleFocusWithin(panelRef.current, event)) {
        event.preventDefault();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div
      className={`${position} inset-0 z-[1200] flex items-end bg-bg/80`}
      onClick={onClose}
      data-testid={`${testId}-backdrop`}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        data-testid={testId}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        className="w-full rounded-t-3xl border-t border-border bg-surface px-5 pt-4 pb-8 max-h-[80%] overflow-y-auto outline-none"
      >
        <div className="flex items-center justify-between gap-3 mb-2">
          <h2 className="font-display text-base">{label}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={`Close ${label.toLowerCase()}`}
            className="w-11 h-11 -mr-2 flex items-center justify-center rounded-full text-muted touch-manipulation"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
