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
    expect(scrollTo).toHaveBeenCalledWith(0, 240);
  });
});
