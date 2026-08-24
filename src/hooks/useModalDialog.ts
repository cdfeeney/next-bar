'use client';

import { useEffect, useRef } from 'react';
import { lockBodyScroll } from '@/lib/bodyScrollLock';
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
 *
 * THE TAB CYCLE IS NOT THE WHOLE CONTRACT, which is what this hook used to
 * assume. `aria-modal="true"` tells assistive technology that everything
 * outside the dialog does not exist, and a keyboard trap is only one of the
 * ways in: a screen-reader cursor, a touch-exploration gesture or a
 * programmatic `focus()` all reach the backdropped page regardless of what Tab
 * does. `inert` is the attribute that makes the claim true — it removes the
 * subtree from focus, from hit-testing and from the accessibility tree — so it
 * is applied here, to every sibling on the path from the dialog up to
 * `<body>`, rather than left to each caller to remember.
 *
 * SCROLL LOCK MOVED HERE FOR THE SAME REASON. Exactly one of the seven dialogs
 * in the story/capture tree called `lockBodyScroll`, so wheel and touch
 * scrolling moved the Social page underneath the capture and compose screens.
 * A shared contract that half the callers implement is not a contract.
 */
export function useModalDialog<T extends HTMLElement>(
  onClose: (() => void) | null,
  enabled = true,
): React.RefObject<T> {
  const ref = useRef<T>(null);

  /**
   * Focus in, background inert — and on close, UN-INERT BEFORE RESTORING FOCUS.
   *
   * These were two separate effects, and React runs cleanups in the order the
   * effects were declared: the focus-restore cleanup fired first, while the
   * opener was still inside the inert subtree. `inert` removes a subtree from
   * focus, so `opener.focus()` was a silent no-op and focus was lost to the
   * body — exactly the dead-end the dialog contract exists to prevent, and
   * invisible in any test that only asserts the dialog closed.
   *
   * They are ONE effect now so the ordering is explicit rather than an
   * emergent property of declaration order that the next edit can quietly
   * reverse. Scroll unlock goes with them; it has no ordering constraint.
   */
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const unlockScroll = lockBodyScroll();
    const marked = markBackgroundInert(ref.current);
    ref.current?.focus({ preventScroll: true });
    return () => {
      // 1. Make the opener focusable again...
      for (const element of marked) element.removeAttribute('inert');
      unlockScroll();
      // 2. ...only then hand focus back to it.
      opener?.focus?.({ preventScroll: true });
    };
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

/**
 * Mark everything outside `dialog` inert, and return what was marked.
 *
 * Walks from the dialog to `<body>` marking each ancestor's OTHER children.
 * That is what leaves exactly the dialog's own subtree live: these dialogs are
 * `position: fixed` but they are not portalled, so they sit inside the page's
 * own element tree and "inert every child of body except this one" would inert
 * nothing at all — the app root contains the dialog.
 *
 * Anything ALREADY inert is skipped and not returned, so a nested sheet cannot
 * un-inert what the dialog beneath it marked when the sheet closes.
 */
function markBackgroundInert(dialog: HTMLElement | null): HTMLElement[] {
  if (dialog === null) return [];
  const marked: HTMLElement[] = [];
  let node: HTMLElement = dialog;
  while (node.parentElement !== null && node !== document.body) {
    for (const sibling of Array.from(node.parentElement.children)) {
      if (sibling === node) continue;
      if (!(sibling instanceof HTMLElement)) continue;
      if (sibling.hasAttribute('inert')) continue;
      sibling.setAttribute('inert', '');
      marked.push(sibling);
    }
    node = node.parentElement;
  }
  return marked;
}
