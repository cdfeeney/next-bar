export function lockBodyScroll(): () => void {
  const { body } = document;
  const scrollY = window.scrollY;
  const previous = {
    overflow: body.style.overflow,
    position: body.style.position,
    top: body.style.top,
    left: body.style.left,
    right: body.style.right,
  };

  Object.assign(body.style, {
    overflow: 'hidden',
    position: 'fixed',
    top: `-${scrollY}px`,
    left: '0',
    right: '0',
  });

  return () => {
    Object.assign(body.style, previous);
    // `behavior: 'instant'` overrides the global `html { scroll-behavior:
    // smooth }`. Without it the restore ANIMATES back to the saved offset:
    // the user watches the page glide after closing an overlay, and anything
    // reading scrollY before the animation finishes sees a partial value
    // (measured 223 of an expected 398).
    if (window.scrollY !== scrollY) {
      window.scrollTo({ top: scrollY, left: 0, behavior: 'instant' });
    }
  };
}
