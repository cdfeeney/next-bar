import { afterEach, describe, expect, it, vi } from 'vitest';
import { lockBodyScroll } from './bodyScrollLock';

describe('lockBodyScroll', () => {
  afterEach(() => {
    document.body.removeAttribute('style');
    vi.restoreAllMocks();
  });

  it('restores body styles and the prior page position', () => {
    document.body.style.overflow = 'auto';
    vi.spyOn(window, 'scrollY', 'get').mockReturnValueOnce(240).mockReturnValue(0);
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});

    const unlock = lockBodyScroll();
    expect(document.body.style.position).toBe('fixed');
    expect(document.body.style.top).toBe('-240px');

    unlock();
    expect(document.body.style.overflow).toBe('auto');
    expect(document.body.style.position).toBe('');
    // Suppressing smooth scrolling is load-bearing, not cosmetic — globals.css
    // sets `html { scroll-behavior: smooth }`, which would otherwise ANIMATE
    // the restore and leave the page mid-glide after an overlay closes. It is
    // done via inline scroll-behavior (understood everywhere) rather than the
    // newer ScrollToOptions `behavior: 'instant'` enum, which a WebView could
    // reject and turn the whole call into a silent no-op.
    expect(scrollTo).toHaveBeenCalledWith(0, 240);
    // ...and the root's scroll-behavior is left exactly as it was found.
    expect(document.documentElement.style.scrollBehavior).toBe('');
  });

  it('suppresses smooth scrolling only for the duration of the restore', () => {
    vi.spyOn(window, 'scrollY', 'get').mockReturnValueOnce(500).mockReturnValue(0);
    const observed: string[] = [];
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {
      observed.push(document.documentElement.style.scrollBehavior);
    });

    lockBodyScroll()();

    expect(observed, 'scroll-behavior must be auto AT the moment of the scroll').toEqual(['auto']);
  });
});
