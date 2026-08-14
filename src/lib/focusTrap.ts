/**
 * focusTrap — the Tab-cycling half of the modal contract, in one place.
 *
 * Three overlays now share `lockBodyScroll` but had diverged on focus: the
 * lightbox carried an inline trap while QuickAddBar and TonightSuggestions —
 * both `role="dialog" aria-modal="true"` — let Tab walk into the backdropped
 * content that aria-modal tells assistive tech does not exist. Triplicating the
 * trap is how that drift happened, so it lives here instead.
 *
 * Deliberately minimal: it cycles focus within the container and pulls focus
 * back if it has escaped. It does not manage initial focus or Escape — those
 * differ per overlay and stay at the call site.
 */

/** Tabbable elements, in DOM order. Matches the set the lightbox already used. */
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Handle a keydown for a modal container. Returns true when it consumed the
 * event (so callers can skip their own handling), false otherwise.
 */
export function cycleFocusWithin(container: HTMLElement | null, event: KeyboardEvent): boolean {
  if (!container || event.key !== 'Tab') return false;

  // No visibility filtering: `offsetParent` is null for position:fixed elements
  // (which every one of these dialogs is) and in jsdom, so filtering on it
  // collapsed the list to a single element and broke the cycle. The selector
  // already excludes `disabled` and `tabindex="-1"`; carousel ends use
  // aria-disabled precisely so they stay in the ring.
  const focusables = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE));
  if (focusables.length === 0) return false;

  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  const active = document.activeElement;

  if (!container.contains(active)) {
    event.preventDefault();
    first.focus({ preventScroll: true });
    return true;
  }
  if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus({ preventScroll: true });
    return true;
  }
  if (event.shiftKey && active === first) {
    event.preventDefault();
    last.focus({ preventScroll: true });
    return true;
  }
  return false;
}
