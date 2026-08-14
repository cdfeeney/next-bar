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
    if (window.scrollY !== scrollY) window.scrollTo(0, scrollY);
  };
}
