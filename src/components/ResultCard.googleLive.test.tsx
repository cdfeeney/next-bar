// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { useEffect, type ReactNode } from 'react';
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
  onBillableRequest?: (placeId: string) => void;
} | null = null;
let widgetMounts = 0;

vi.mock('@/components/GooglePlacePhotoLazy', () => ({
  default: (props: {
    placeId: string;
    surface?: string;
    fallback?: ReactNode;
    onBillableRequest?: (placeId: string) => void;
  }) => {
    captured = props;
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useEffect(() => {
      widgetMounts += 1;
    }, []);
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
  widgetMounts = 0;
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('google-live wiring', () => {
  test('the bar googlePlaceId and the result-card surface reach GooglePlacePhoto', () => {
    vi.stubEnv('NEXT_PUBLIC_GOOGLE_MEDIA', '1');
    renderCard();
    expect(screen.getByTestId('google-place-photo-mock')).toBeTruthy();
    expect(captured?.placeId).toBe('ChIJattaboy123');
    expect(captured?.surface).toBe('result-card');
  });

  test('the failure fallback is a stable 21/9 glyph surface — never null, never a /bar-photos/ file', () => {
    vi.stubEnv('NEXT_PUBLIC_GOOGLE_MEDIA', '1');
    // Legacy eligibility ON deliberately: even then, the fallback must not
    // reach for legacy files, or the compliance migration only LOOKS done.
    vi.stubEnv('NEXT_PUBLIC_LEGACY_PHOTOS', '1');
    renderCard();
    const { container } = render(<>{captured?.fallback}</>);
    const glyph = container.querySelector('[data-testid="google-fallback-glyph"]');
    expect(glyph).not.toBeNull();
    // The reserved hero height survives the degradation — no layout shift.
    expect(glyph?.className).toContain('aspect-[21/9]');
    expect(container.querySelector('img[src*="/bar-photos/"]')).toBeNull();
    expect(container.querySelector('img')).toBeNull(); // glyph only — no owned-photo claims
  });

  test('ordinary rerenders create AT MOST ONE widget for a bar', () => {
    vi.stubEnv('NEXT_PUBLIC_GOOGLE_MEDIA', '1');
    const view = renderCard();
    for (let i = 0; i < 4; i += 1) {
      view.rerender(
        <ResultCard
          bar={BAR}
          rank={1}
          miles={0.4 + i * 0.01} // unrelated prop churn
          userTags={[]}
          showShare={false}
          hasSavedVibe={false}
        />,
      );
    }
    expect(widgetMounts).toBe(1);
  });

  test('telemetry: one surface-only, non-blocking beacon per billable creation', () => {
    vi.stubEnv('NEXT_PUBLIC_GOOGLE_MEDIA', '1');
    const beacon = vi.fn(() => true);
    vi.stubGlobal('navigator', { ...navigator, sendBeacon: beacon });
    renderCard();
    // GooglePlacePhoto invokes this exactly once per widget creation (its
    // own suite pins that); here we pin what the wiring SENDS.
    captured?.onBillableRequest?.('ChIJattaboy123');
    expect(beacon).toHaveBeenCalledTimes(1);
    const [url, body] = beacon.mock.calls[0] as unknown as [string, string];
    expect(url).toBe('/api/media-metric');
    expect(JSON.parse(body)).toEqual({ surface: 'result-card' }); // enum ONLY
    expect(body).not.toContain('ChIJ'); // the reported placeId is dropped
  });

  test('telemetry failure never disturbs the photo path', () => {
    vi.stubEnv('NEXT_PUBLIC_GOOGLE_MEDIA', '1');
    vi.stubGlobal('navigator', {
      ...navigator,
      sendBeacon: () => {
        throw new Error('beacon blocked');
      },
    });
    renderCard();
    expect(() => captured?.onBillableRequest?.('ChIJattaboy123')).not.toThrow();
    expect(screen.getByTestId('google-place-photo-mock')).toBeTruthy();
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
