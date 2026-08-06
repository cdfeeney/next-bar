// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { Bar } from '@/types';

let captured: {
  placeId?: string;
  surface?: string;
  fallback?: ReactNode;
} | null = null;

vi.mock('@/components/GooglePlacePhotoLazy', () => ({
  default: (props: { placeId: string; surface?: string; fallback?: ReactNode }) => {
    captured = props;
    return <div data-testid="google-place-photo-mock" />;
  },
}));

vi.mock('@/components/OpenNowBadge', () => ({ default: () => null }));
vi.mock('@/components/WantToGoToggle', () => ({ default: () => null }));

// jsdom has neither ResizeObserver nor scrollIntoView; the lightbox's
// reflow watcher and carousel snap logic need stubs.
Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? ((): void => {});
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub);

import BarLightbox from './BarLightbox';

const BAR: Bar = {
  id: 'attaboy',
  name: 'Attaboy',
  lat: 40.719,
  lng: -73.99,
  tags: ['classy'],
  neighborhood: 'LES',
  priceTier: 3,
  blurb: '',
  googlePlaceId: 'ChIJattaboy123',
  photoRef: 'places/x/photos/y',
  photoCount: 3,
} as unknown as Bar;

afterEach(() => {
  captured = null;
  vi.unstubAllEnvs();
});

describe('BarLightbox google-live wiring', () => {
  test('the widget mounts with the bar place_id and the bar-lightbox surface', () => {
    vi.stubEnv('NEXT_PUBLIC_GOOGLE_MEDIA', '1');
    render(<BarLightbox bar={BAR} onClose={() => {}} />);
    expect(screen.getByTestId('google-place-photo-mock')).toBeTruthy();
    expect(captured?.placeId).toBe('ChIJattaboy123');
    expect(captured?.surface).toBe('bar-lightbox');
    // The legacy carousel must not render beside the widget.
    expect(document.querySelector('img[src*="/bar-photos/"]')).toBeNull();
  });

  test('the failure fallback never contains a /bar-photos/ legacy file', () => {
    vi.stubEnv('NEXT_PUBLIC_GOOGLE_MEDIA', '1');
    vi.stubEnv('NEXT_PUBLIC_LEGACY_PHOTOS', '1');
    render(<BarLightbox bar={BAR} onClose={() => {}} />);
    const { container } = render(<>{captured?.fallback}</>);
    expect(container.querySelector('img[src*="/bar-photos/"]')).toBeNull();
  });

  test('nothing overlays the widget inside its figure', () => {
    vi.stubEnv('NEXT_PUBLIC_GOOGLE_MEDIA', '1');
    render(<BarLightbox bar={BAR} onClose={() => {}} />);
    const widget = screen.getByTestId('google-place-photo-mock');
    let node: HTMLElement | null = widget.parentElement;
    while (node && node.tagName !== 'FIGURE') {
      expect(node.className).not.toMatch(/bg-gradient|absolute/);
      node = node.parentElement;
    }
  });

  test('google-live OFF: the legacy carousel path is unchanged', () => {
    vi.stubEnv('NEXT_PUBLIC_LEGACY_PHOTOS', '1');
    render(<BarLightbox bar={BAR} onClose={() => {}} />);
    expect(screen.queryByTestId('google-place-photo-mock')).toBeNull();
    expect(document.querySelector('img[src*="/bar-photos/attaboy"]')).toBeTruthy();
  });
});
