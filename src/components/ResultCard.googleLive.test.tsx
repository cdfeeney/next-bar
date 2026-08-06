// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { Bar } from '@/types';

/**
 * ResultCard's google-live wiring (fenced — no network, no real SDK):
 * the correct place_id and surface reach the widget, the fallback can never
 * be a /bar-photos/ legacy file, and nothing overlays the widget that could
 * obscure Google's own attribution.
 */

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

// Children irrelevant to the media branch — rendered shallow to keep this
// test on the wiring, not the card's badges.
vi.mock('@/components/OpenNowBadge', () => ({ default: () => null }));
vi.mock('@/components/RatingBadge', () => ({ default: () => null }));
vi.mock('@/components/WantToGoToggle', () => ({ default: () => null }));
vi.mock('@/components/ShareButton', () => ({ default: () => null }));
vi.mock('@/components/BarLightbox', () => ({ default: () => null }));

import ResultCard from './ResultCard';

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

function renderCard(bar: Bar = BAR): ReturnType<typeof render> {
  return render(
    <ResultCard
      bar={bar}
      rank={1}
      miles={0.4}
      userTags={[]}
      showShare={false}
      hasSavedVibe={false}
    />,
  );
}

afterEach(() => {
  captured = null;
  vi.unstubAllEnvs();
});

describe('google-live wiring', () => {
  test('the bar googlePlaceId and the result-card surface reach GooglePlacePhoto', () => {
    vi.stubEnv('NEXT_PUBLIC_GOOGLE_MEDIA', '1');
    renderCard();
    expect(screen.getByTestId('google-place-photo-mock')).toBeTruthy();
    expect(captured?.placeId).toBe('ChIJattaboy123');
    expect(captured?.surface).toBe('result-card');
  });

  test('the failure fallback NEVER contains a /bar-photos/ legacy file — even for a bar that has them', () => {
    vi.stubEnv('NEXT_PUBLIC_GOOGLE_MEDIA', '1');
    // Legacy eligibility ON deliberately: the fallback policy must force it
    // off regardless, or the compliance migration only LOOKS complete.
    vi.stubEnv('NEXT_PUBLIC_LEGACY_PHOTOS', '1');
    renderCard();
    const { container } = render(<>{captured?.fallback}</>);
    expect(container.querySelector('img[src*="/bar-photos/"]')).toBeNull();
  });

  test('nothing overlays the widget: no gradient/absolute chrome around it, and no app-side attribution line', () => {
    vi.stubEnv('NEXT_PUBLIC_GOOGLE_MEDIA', '1');
    renderCard();
    const widget = screen.getByTestId('google-place-photo-mock');
    // The widget renders its own attribution; painting our gradient/name
    // overlay above it could obscure that. Walk up to the article and
    // assert no ancestor of the widget is position-relative overlay chrome.
    let node: HTMLElement | null = widget.parentElement;
    while (node && node.tagName !== 'ARTICLE') {
      expect(node.className).not.toMatch(/bg-gradient|absolute/);
      node = node.parentElement;
    }
    // The legacy "Photo via Google" line belongs to the legacy tier only.
    expect(screen.queryByText(/photo via google/i)).toBeNull();
    // And the widget is not inside the lightbox button (clicks belong to
    // the widget's own lightbox).
    expect(widget.closest('button')).toBeNull();
  });

  test('the glyph body row still renders the bar identity alongside the widget', () => {
    vi.stubEnv('NEXT_PUBLIC_GOOGLE_MEDIA', '1');
    renderCard();
    expect(screen.getByText(/1\. Attaboy/)).toBeTruthy();
  });

  test('with google-live OFF the widget never mounts and legacy behavior is unchanged', () => {
    vi.stubEnv('NEXT_PUBLIC_LEGACY_PHOTOS', '1');
    renderCard();
    expect(screen.queryByTestId('google-place-photo-mock')).toBeNull();
    expect(document.querySelector('img[src*="/bar-photos/attaboy"]')).toBeTruthy();
  });

  test('with neither tier enabled the card is the plain glyph card', () => {
    renderCard();
    expect(screen.queryByTestId('google-place-photo-mock')).toBeNull();
    expect(document.querySelector('img[src*="/bar-photos/"]')).toBeNull();
  });
});
