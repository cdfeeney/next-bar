// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';

/**
 * The runtime kill switch must stop a widget BEFORE the SDK is even loaded:
 * a disabled or unreachable /api/flags means zero Google requests of any
 * kind — no script injection, no billable creation, just the fallback.
 *
 * The key is mocked as CONFIGURED here, because an unconfigured key would
 * short-circuit first and prove nothing about the flag gate.
 */
vi.mock('@/lib/placesUiKit', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/placesUiKit')>('@/lib/placesUiKit');
  return {
    ...actual,
    isPlacesUiKitConfigured: vi.fn(() => true),
    isRuntimeGoogleMediaEnabled: vi.fn(async () => false),
    loadPlacesUiKit: vi.fn(async () => {
      throw new Error('SDK load must never be attempted while the gate is closed');
    }),
  };
});

import GooglePlacePhoto from './GooglePlacePhoto';
import {
  __resetRequested,
  billableEventCount,
  isRuntimeGoogleMediaEnabled,
  loadPlacesUiKit,
} from '@/lib/placesUiKit';

const FALLBACK = <span data-testid="glyph-fallback">glyph</span>;

afterEach(() => {
  __resetRequested();
  vi.clearAllMocks();
});

describe('runtime kill switch gates the configured path', () => {
  test('disabled flags → fallback, no SDK load, zero billable events', async () => {
    render(<GooglePlacePhoto placeId="ChIJtest" fallback={FALLBACK} />);
    await waitFor(() => expect(screen.getByTestId('glyph-fallback')).toBeTruthy());
    expect(isRuntimeGoogleMediaEnabled).toHaveBeenCalled();
    expect(loadPlacesUiKit).not.toHaveBeenCalled();
    expect(billableEventCount()).toBe(0);
    expect(
      document.querySelectorAll('script[src*="maps.googleapis.com"]').length,
    ).toBe(0);
  });

  test('the gate is consulted per widget creation, not once per session', async () => {
    const first = render(
      <GooglePlacePhoto placeId="ChIJone" fallback={FALLBACK} />,
    );
    await waitFor(() => expect(screen.getByTestId('glyph-fallback')).toBeTruthy());
    first.unmount();
    render(<GooglePlacePhoto placeId="ChIJtwo" fallback={FALLBACK} />);
    await waitFor(() => expect(screen.getByTestId('glyph-fallback')).toBeTruthy());
    expect(vi.mocked(isRuntimeGoogleMediaEnabled).mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});
