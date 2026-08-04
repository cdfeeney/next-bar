'use client';

/**
 * PinConfirmDialog — the one confirmation every pin write goes through
 * (criterion 6: it names the BAR, the AUDIENCE, and the EXPIRATION).
 * Shared by PinWhereIAm (Friends → Tonight) and ImHereButton (bar
 * result surface) so the privacy copy can never drift between entries.
 */

import { useRef } from 'react';
import { useDialogA11y } from '@/hooks/useDialogA11y';
import { SOCIAL_NIGHT_END_LABEL } from '@/lib/socialNight';
import type { Bar } from '@/types';

type PinConfirmDialogProps = {
  bar: Bar;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export default function PinConfirmDialog({
  bar,
  busy,
  onConfirm,
  onCancel,
}: PinConfirmDialogProps): JSX.Element {
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  // House dialog contract: Escape cancels (never confirms), focus lands
  // on the non-destructive action, Tab stays inside, scroll locks.
  useDialogA11y(dialogRef, onCancel, cancelRef);

  return (
    <div
      ref={dialogRef}
      role="alertdialog"
      aria-modal="true"
      aria-label="Confirm pin"
      className="fixed inset-0 z-[1200] flex items-end sm:items-center justify-center bg-bg/80 p-6"
    >
      <div className="bg-surface border border-border rounded-3xl p-6 max-w-sm w-full mb-[env(safe-area-inset-bottom)]">
        <p className="text-sm leading-relaxed">
          Share that you&apos;re at{' '}
          <span className="font-display text-accent">{bar.name}</span> with
          friends until {SOCIAL_NIGHT_END_LABEL}?
        </p>
        <p className="text-muted text-xs mt-2">
          Only friends who follow each other back can see this. No location
          is shared — just the bar.
        </p>
        <div className="flex items-center justify-end gap-4 mt-4">
          <button
            type="button"
            ref={cancelRef}
            onClick={onCancel}
            disabled={busy}
            className="text-muted text-sm font-display min-h-[44px] touch-manipulation disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="bg-accent text-bg rounded-full px-5 py-2 min-h-[44px] font-display text-sm touch-manipulation disabled:opacity-50"
          >
            {busy ? 'Pinning…' : 'Pin it'}
          </button>
        </div>
      </div>
    </div>
  );
}
