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
    if (window.scrollY === scrollY) return;

    // The restore must be INSTANT. globals.css sets `html { scroll-behavior:
    // smooth }`, which turns a plain scrollTo into an animation: the user
    // watches the page glide after closing an overlay, and anything reading
    // scrollY before it finishes sees a partial offset (measured 223 of an
    // expected 398).
    //
    // Suppressing it via the root's inline scroll-behavior rather than
    // ScrollToOptions `behavior: 'instant'` deliberately: 'instant' is a newer
    // CSSOM enum, and a WebView that rejects the dictionary value would make
    // the call a silent no-op — leaving the page unscrolled, which is worse
    // than the animation it replaced. Inline scroll-behavior plus positional
    // scrollTo is understood by every engine that ships this app.
    const root = document.documentElement;
    const previousScrollBehavior = root.style.scrollBehavior;
    root.style.scrollBehavior = 'auto';
    window.scrollTo(0, scrollY);
    root.style.scrollBehavior = previousScrollBehavior;
  };
}
