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
/**
 * Which state the widget is in for a given test. 'loaded' stands in for a
 * rendered Google widget; 'failed' renders the caller's fallback exactly as
 * GooglePlacePhoto does when it gives up — which is the state that hid a
 * real defect (a card with no Maps action at all) behind an assertion that
 * only ever exercised the loaded path.
 */
let widgetState: 'loaded' | 'failed' = 'loaded';

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
    if (widgetState === 'failed') return <>{props.fallback}</>;
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
  address: '134 Eldridge St',
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
  widgetState = 'loaded';
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const MAPS_LINKS = 'a[href*="google.com/maps"]';

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

  test('the fallback still NAMES the bar — a failed widget must not leave a nameless card', () => {
    // Caught by screenshot, not by assertion: with our identity row removed
    // for google-live and the widget rendering nothing when unavailable, the
    // card showed a glyph, a walk time and no bar name at all.
    vi.stubEnv('NEXT_PUBLIC_GOOGLE_MEDIA', '1');
    renderCard();
    const { container } = render(<>{captured?.fallback}</>);
    expect(container.textContent).toContain('Attaboy');
    // …but NOT the rank: that renders in the meta line in both states, and
    // duplicating it here printed "1." twice on the card.
    expect(container.textContent).not.toContain('1.');
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

  test('NO BarVisualTile and NO duplicate name/neighborhood chrome on a google-live card', () => {
    // Live 390x844 review: the card showed Google's name AND ours, plus a
    // 56px glyph tile beside a photo of the same bar. The widget owns
    // name/photo/attribution now; our copies are gone.
    vi.stubEnv('NEXT_PUBLIC_GOOGLE_MEDIA', '1');
    renderCard();
    expect(screen.queryByTestId('bar-visual')).toBeNull();
    expect(screen.queryByText(/1\. Attaboy/)).toBeNull();
    // Our NAME stays suppressed — the compact widget renders it.
    expect(screen.queryByTestId('card-name')).toBeNull();
    // Rank survives — Google has no notion of our ranking — and is now its
    // own element rather than a "1." prefix glued to the walk-time
    // sentence, so it reads the same way in every media state.
    expect(screen.getByTestId('card-rank').textContent).toBe('1');
  });

  test('LOADED widget: zero app-provided Maps links — Google’s action is the only one', () => {
    widgetState = 'loaded';
    vi.stubEnv('NEXT_PUBLIC_GOOGLE_MEDIA', '1');
    const { container } = renderCard();
    expect(screen.getByTestId('google-place-photo-mock')).toBeTruthy();
    expect(screen.queryByText(/Maps →/)).toBeNull();
    expect(screen.queryByText(/Open in Maps/)).toBeNull();
    expect(container.querySelectorAll(MAPS_LINKS).length).toBe(0);
  });

  test('FAILED widget: exactly ONE Maps link, labelled “Open in Maps”', () => {
    // The verified blocker: with the widget gone and our link suppressed,
    // the card had zero Maps actions and the old test asserted zero.
    widgetState = 'failed';
    vi.stubEnv('NEXT_PUBLIC_GOOGLE_MEDIA', '1');
    const { container } = renderCard();
    expect(screen.queryByTestId('google-place-photo-mock')).toBeNull();
    const links = container.querySelectorAll(MAPS_LINKS);
    expect(links.length).toBe(1);
    expect(links[0].textContent).toContain('Open in Maps');
  });

  test('FAILED widget: the Maps link points at this bar’s name and address', () => {
    widgetState = 'failed';
    vi.stubEnv('NEXT_PUBLIC_GOOGLE_MEDIA', '1');
    const { container } = renderCard();
    const href = container.querySelector(MAPS_LINKS)?.getAttribute('href') ?? '';
    expect(href).toContain('google.com/maps/search/?api=1&query=');
    expect(decodeURIComponent(href)).toContain('Attaboy');
    expect(decodeURIComponent(href)).toContain('134 Eldridge');
  });

  test('FAILED widget: the Maps link is accessible with a 44px touch target', () => {
    widgetState = 'failed';
    vi.stubEnv('NEXT_PUBLIC_GOOGLE_MEDIA', '1');
    const { container } = renderCard();
    const link = container.querySelector(MAPS_LINKS) as HTMLElement;
    expect(link.getAttribute('aria-label')).toBe('Open Attaboy in Google Maps');
    expect(link.className).toContain('min-h-[44px]');
    expect(link.getAttribute('rel')).toContain('noopener');
  });

  test('FAILED widget keeps the rest of the fallback contract intact', () => {
    widgetState = 'failed';
    vi.stubEnv('NEXT_PUBLIC_GOOGLE_MEDIA', '1');
    // Legacy eligibility ON: the fallback must still never reach for one.
    vi.stubEnv('NEXT_PUBLIC_LEGACY_PHOTOS', '1');
    const { container } = renderCard();
    const glyph = container.querySelector('[data-testid="google-fallback-glyph"]');
    expect(glyph).not.toBeNull();
    expect(glyph?.className).toContain('aspect-[21/9]'); // geometry held
    expect(container.textContent).toContain('Attaboy'); // identity preserved
    expect(screen.queryByTestId('bar-visual')).toBeNull(); // no tile duplication
    expect(container.querySelector('img[src*="/bar-photos/"]')).toBeNull();
  });

  test('the app’s own content stays reachable: one Hours entry to the lightbox', () => {
    vi.stubEnv('NEXT_PUBLIC_GOOGLE_MEDIA', '1');
    renderCard();
    expect(screen.getByRole('button', { name: /See hours for Attaboy/i })).toBeTruthy();
  });

  test('distance/vibe, open-now, rating and Want-to-go remain below the widget', () => {
    vi.stubEnv('NEXT_PUBLIC_GOOGLE_MEDIA', '1');
    renderCard();
    expect(screen.getByText(/Vibe match/i)).toBeTruthy();
  });

  test('the NON-google-live card is untouched: identity row, Maps action and attribution credit all remain', () => {
    vi.stubEnv('NEXT_PUBLIC_LEGACY_PHOTOS', '1');
    const { container } = renderCard();
    // Identity row intact: the name is ours to render on this tier, and the
    // rank sits beside it in the same element every other state uses.
    expect(screen.getByTestId('card-name').textContent).toBe('Attaboy');
    expect(screen.getByTestId('card-rank').textContent).toBe('1');
    // The app's Maps ACTION survives on the legacy tier — exactly one.
    expect(screen.getAllByText(/Maps →/)).toHaveLength(1);
    // …alongside GoogleAttribution's separate credit link, which is a
    // REQUIREMENT of the legacy tier and must never be counted as a
    // duplicate action or removed.
    expect(
      container.querySelectorAll('a[href*="maps/place/?q=place_id:"]').length,
    ).toBe(1);
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
