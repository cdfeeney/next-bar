// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { Bar } from '@/types';

/**
 * BarLightbox is the hours/details/actions dialog — it must issue ZERO
 * Google widget requests (santa BLOCK, 2026-08-06). ResultCard's widget is
 * the app's only billable Google surface; a second widget per bar in the
 * lightbox would double the bill for the same content.
 */

let widgetMounts = 0;
vi.mock('@/components/GooglePlacePhotoLazy', () => ({
  default: () => {
    widgetMounts += 1;
    return <div data-testid="google-place-photo-mock" />;
  },
}));
vi.mock('@/components/OpenNowBadge', () => ({ default: () => null }));
vi.mock('@/components/WantToGoToggle', () => ({ default: () => null }));

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub);
Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? ((): void => {});

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
  widgetMounts = 0;
  vi.unstubAllEnvs();
});

describe('BarLightbox issues zero Google widget requests', () => {
  test('open → close → reopen with google-live active creates zero widgets', () => {
    vi.stubEnv('NEXT_PUBLIC_GOOGLE_MEDIA', '1');
    const first = render(<BarLightbox bar={BAR} onClose={() => {}} />);
    first.unmount();
    const second = render(<BarLightbox bar={BAR} onClose={() => {}} />);
    second.unmount();
    render(<BarLightbox bar={BAR} onClose={() => {}} />);
    expect(widgetMounts).toBe(0);
    expect(screen.queryByTestId('google-place-photo-mock')).toBeNull();
  });

  test('google-live renders NO media section and NO legacy carousel', () => {
    vi.stubEnv('NEXT_PUBLIC_GOOGLE_MEDIA', '1');
    render(<BarLightbox bar={BAR} onClose={() => {}} />);
    expect(document.querySelector('img[src*="/bar-photos/"]')).toBeNull();
    // The dialog's actual job still renders.
    expect(screen.getByText('Attaboy')).toBeTruthy();
  });

  test('the module has no GooglePlacePhoto consumer at the source level', () => {
    const source = readFileSync(
      join(__dirname, 'BarLightbox.tsx'),
      'utf8',
    );
    expect(source).not.toMatch(/GooglePlacePhoto/);
  });

  test('the legacy carousel path is unchanged when only legacy is enabled', () => {
    vi.stubEnv('NEXT_PUBLIC_LEGACY_PHOTOS', '1');
    render(<BarLightbox bar={BAR} onClose={() => {}} />);
    expect(document.querySelector('img[src*="/bar-photos/attaboy"]')).toBeTruthy();
    expect(widgetMounts).toBe(0);
  });
});
