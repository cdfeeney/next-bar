'use client';

import { useEffect, useRef, type RefObject } from 'react';

/**
 * useDialogA11y — the house dialog lifecycle contract in one hook:
 * focus steal on open, Escape to close, minimal Tab trap, body scroll
 * lock, opener focus restore. The pattern comes from BarLightbox
 * ("per Opus review" there), which still carries its OWN inline copy —
 * migrating it onto this hook is tracked follow-up debt, and until then
 * the two implementations must not be assumed to share the stack below.
 *
 * STACKING: dialogs can nest (PinWhereIAm's picker opens a confirm on
 * top). Every mounted instance registers on a module-level stack and
 * only the TOPMOST one responds to Escape/Tab — without this, one
 * Escape press would bubble to every open dialog and close the whole
 * stack at once. Scroll lock is reference-counted for the same reason.
 */

const dialogStack: symbol[] = [];
let scrollLocks = 0;
let prevBodyOverflow = '';

function lockScroll(): void {
  if (scrollLocks === 0) {
    prevBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  scrollLocks += 1;
}

function unlockScroll(): void {
  scrollLocks = Math.max(0, scrollLocks - 1);
  if (scrollLocks === 0) {
    document.body.style.overflow = prevBodyOverflow;
  }
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function useDialogA11y(
  dialogRef: RefObject<HTMLElement>,
  onClose: () => void,
  initialFocusRef?: RefObject<HTMLElement>,
): void {
  // Handlers read refs so the listener never goes stale (BarLightbox
  // lesson: re-running the effect mid-interaction yanks focus).
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const initialRef = useRef(initialFocusRef?.current ?? null);
  initialRef.current = initialFocusRef?.current ?? null;

  useEffect(() => {
    const id = Symbol('dialog');
    dialogStack.push(id);
    const isTop = (): boolean => dialogStack[dialogStack.length - 1] === id;

    const opener =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const target =
      initialRef.current ??
      dialogRef.current?.querySelector<HTMLElement>(FOCUSABLE) ??
      null;
    target?.focus();

    const onKey = (e: KeyboardEvent): void => {
      if (!isTop()) return;
      if (e.key === 'Escape') {
        onCloseRef.current();
        return;
      }
      // Minimal focus trap: Tab cycles within the dialog.
      if (e.key === 'Tab' && dialogRef.current) {
        const focusables =
          dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE);
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement;
        if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        } else if (e.shiftKey && active === first) {
          e.preventDefault();
          last.focus();
        } else if (!dialogRef.current.contains(active)) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    window.addEventListener('keydown', onKey);
    lockScroll();
    return () => {
      window.removeEventListener('keydown', onKey);
      unlockScroll();
      const idx = dialogStack.indexOf(id);
      if (idx !== -1) dialogStack.splice(idx, 1);
      opener?.focus();
    };
    // Mount-once per dialog instance; handlers read refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
