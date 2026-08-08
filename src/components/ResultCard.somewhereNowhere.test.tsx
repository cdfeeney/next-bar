// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';

/**
 * Item 7 (goal g-bfb6937a), criterion 6 — the Somewhere Nowhere card driven
 * against a deterministic MOCKED SUCCESSFUL Google response.
 *
 * This is the local half of "why does this card show no photos": if the card
 * renders the widget correctly the moment a successful response is mocked,
 * then eligibility, mounting, sizing, and the app's own render path are all
 * exonerated, and whatever remains is provider data or deployed
 * configuration — which is attended-only.
 *
 * next/dynamic is bypassed so the REAL GooglePlacePhoto lifecycle runs
 * (effect -> runtime gate -> SDK load -> element build -> gmp-load -> ready)
 * rather than a stand-in. No network, no live widget, no Staging.
 */

vi.mock('@/lib/placesUiKit', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/placesUiKit')>('@/lib/placesUiKit');
  return {
    ...actual,
    isPlacesUiKitConfigured: vi.fn(() => true),
    isRuntimeGoogleMediaEnabled: vi.fn(async () => true),
    loadPlacesUiKit: vi.fn(async () => true),
  };
});

// The lazy wrapper is next/dynamic; swap in the real component directly.
vi.mock('@/components/GooglePlacePhotoLazy', async () => ({
  default: (await vi.importActual<{ default: unknown }>(
    './GooglePlacePhoto',
  )).default,
}));

/**
 * The telemetry beacon is mocked so §11's "no network" claim is ENFORCED
 * rather than asserted in prose.
 *
 * `reportGoogleMediaRequest` fires on the real success path and calls
 * `sendMediaMetric`, which reaches for `navigator.sendBeacon` and then
 * `fetch('/api/media-metric')`. Both are swallowed by its own try/catch, so an
 * attempted request could never fail this test — it would simply happen, unseen,
 * while the document claimed no network was touched. (santa: Codex.)
 */
const { beacon } = vi.hoisted(() => ({ beacon: vi.fn() }));
vi.mock('@/lib/mediaMetric', () => ({
  MEDIA_METRIC_PATH: '/api/media-metric',
  sendMediaMetric: beacon,
  reportGoogleMediaRequest: beacon,
}));

// Children irrelevant to the media branch.
vi.mock('@/components/OpenNowBadge', () => ({ default: () => null }));
vi.mock('@/components/RatingBadge', () => ({ default: () => null }));
vi.mock('@/components/WantToGoToggle', () => ({ default: () => null }));
vi.mock('@/components/ShareButton', () => ({ default: () => null }));
vi.mock('@/components/BarLightbox', () => ({ default: () => null }));

import ResultCard from './ResultCard';
import { bars } from '@/lib/bars';
import { __resetRequested, billableEventCount } from '@/lib/placesUiKit';

const BAR = bars.find((b) => b.id === 'somewhere-nowhere-nyc')!;

afterEach(() => {
  __resetRequested();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('Item 7 — Somewhere Nowhere against a mocked SUCCESSFUL Google response', () => {
  test('the widget mounts, is handed the real place id, and reaches ready', async () => {
    vi.stubEnv('NEXT_PUBLIC_GOOGLE_MEDIA', '1');
    const { container } = render(
      <ResultCard bar={BAR} rank={1} miles={0.4} userTags={[]} />,
    );

    // Eligibility + mounting: the card took the google-live branch at all.
    const host = await screen.findByTestId('google-place-photo');

    // The widget was built and handed THIS bar's place id.
    await waitFor(() =>
      expect(host.querySelector('gmp-place-details-compact')).not.toBeNull(),
    );
    const request = host.querySelector('gmp-place-details-place-request');
    expect(request?.getAttribute('place')).toBe(BAR.googlePlaceId);

    // Exactly one billable creation for the card.
    expect(billableEventCount()).toBe(1);

    // Google's own success signal flips the card to ready…
    host
      .querySelector('gmp-place-details-compact')!
      .dispatchEvent(new Event('gmp-load'));
    await waitFor(() => expect(host.getAttribute('data-status')).toBe('ready'));

    // …and the ready host imposes no ratio, height cap, or clipping, so a
    // tall widget (and Google's required attribution) cannot be cut off.
    expect(host.className).not.toMatch(/aspect-\[/);
    expect(host.className).not.toMatch(/overflow-hidden/);
    expect(host.className).not.toMatch(/max-h-/);

    // The billable callback fired exactly once — and, because the transport is
    // mocked, provably reached no network. This is the enforced half of §11.
    expect(beacon).toHaveBeenCalledTimes(1);

    // No re-hosted legacy photo is served on this path, ever.
    expect(container.querySelectorAll('img[src*="/bar-photos/"]')).toHaveLength(0);
    // The fallback glyph is NOT showing — the widget really did render.
    expect(screen.queryByTestId('google-fallback-glyph')).toBeNull();
  });

  test('with google media OFF the card serves NO image at all — only the glyph tile', async () => {
    vi.stubEnv('NEXT_PUBLIC_GOOGLE_MEDIA', '');
    vi.stubEnv('NEXT_PUBLIC_LEGACY_PHOTOS', '');
    const { container } = render(
      <ResultCard bar={BAR} rank={1} miles={0.4} userTags={[]} />,
    );

    // No widget host, no billing — the shipped fail-closed default.
    expect(screen.queryByTestId('google-place-photo')).toBeNull();
    expect(billableEventCount()).toBe(0);

    // NOT just "no /bar-photos URL": no <img> and no CSS background image
    // anywhere on the card. Checking only the /bar-photos substring would
    // still pass if the glyph branch ever started serving a photo from
    // somewhere else. (santa: Codex.)
    expect(container.querySelectorAll('img')).toHaveLength(0);
    expect(container.querySelectorAll('picture, source')).toHaveLength(0);
    const withBackgroundImage = [...container.querySelectorAll<HTMLElement>('*')].filter(
      (el) => /url\(/i.test(el.style.backgroundImage || ''),
    );
    expect(withBackgroundImage).toHaveLength(0);

    // The deterministic glyph tile IS the intended surface in this state —
    // the card is not blank, it simply has no photograph.
    expect(screen.getByTestId('bar-visual')).toBeTruthy();
    // The card still identifies its bar and its rank.
    expect(screen.getByTestId('card-name').textContent).toBe('Somewhere Nowhere NYC');
    expect(screen.getByTestId('card-rank').textContent).toBe('1');
  });
});
