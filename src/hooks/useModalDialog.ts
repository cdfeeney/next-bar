'use client';

import { useEffect, useRef } from 'react';
import { cycleFocusWithin } from '@/lib/focusTrap';

/**
 * The modal-dialog shell contract, as one hook: focus moves in on open, CYCLES
 * inside while open, Escape closes, and focus returns to the opener on unmount.
 *
 * `Sheet.tsx` carried this inline and was, until this hook, the only overlay in
 * the story/capture tree that honoured `aria-modal` — the six full-screen
 * dialogs beside it declared the attribute and let Tab walk into the
 * backdropped page underneath, which is the same drift `src/lib/focusTrap.ts`
 * was extracted to stop. Anything that renders `role="dialog"
 * aria-modal="true"` mounts this instead of re-deriving it.
 *
 * `enabled` exists for NESTED overlays. A sheet or lightbox opened from inside
 * a dialog installs its own trap on the same document, and two live traps race:
 * the outer one fires first and pulls focus back out of the inner panel. The
 * outer dialog turns its own keys off for as long as something is open above
 * it, so exactly one trap is ever armed.
 */
export function useModalDialog<T extends HTMLElement>(
  onClose: (() => void) | null,
  enabled = true,
): React.RefObject<T> {
  const ref = useRef<T>(null);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    ref.current?.focus({ preventScroll: true });
    return () => opener?.focus?.({ preventScroll: true });
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && onClose !== null) {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key === 'Tab') cycleFocusWithin(ref.current, event);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose, enabled]);

  return ref;
}
