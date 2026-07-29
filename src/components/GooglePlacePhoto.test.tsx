import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import GooglePlacePhoto from './GooglePlacePhoto';
import { __resetLoader, __resetRequested, requestedCount } from '@/lib/placesUiKit';

/**
 * The default path must cost nothing and break nothing.
 *
 * No Google Maps API key is configured in this repo yet, so every render here
 * exercises the unconfigured path — which is exactly the state a fresh deploy,
 * a preview branch, or a rollback would be in. It must degrade to the caller's
 * fallback, issue zero requests, and inject no script.
 */

const FALLBACK = <span data-testid="glyph-fallback">glyph</span>;

beforeEach(() => {
  __resetLoader();
  __resetRequested();
  document.head.querySelectorAll('script[src*="maps.googleapis.com"]').forEach((s) => s.remove());
});

describe('GooglePlacePhoto with no API key configured', () => {
  test('renders the fallback rather than an empty box', async () => {
    render(<GooglePlacePhoto placeId="ChIJtest" fallback={FALLBACK} />);
    await waitFor(() => expect(screen.getByTestId('glyph-fallback')).toBeTruthy());
    expect(screen.queryByTestId('google-place-photo')).toBeNull();
  });

  test('issues zero billable requests', async () => {
    render(<GooglePlacePhoto placeId="ChIJtest" fallback={FALLBACK} />);
    await waitFor(() => expect(screen.getByTestId('glyph-fallback')).toBeTruthy());
    expect(requestedCount()).toBe(0);
  });

  test('never injects the Google Maps script', async () => {
    render(<GooglePlacePhoto placeId="ChIJtest" fallback={FALLBACK} />);
    await waitFor(() => expect(screen.getByTestId('glyph-fallback')).toBeTruthy());
    expect(document.querySelectorAll('script[src*="maps.googleapis.com"]').length).toBe(0);
  });

  test('does not fire the billing callback', async () => {
    const onBillableRequest = vi.fn();
    render(
      <GooglePlacePhoto placeId="ChIJtest" fallback={FALLBACK} onBillableRequest={onBillableRequest} />,
    );
    await waitFor(() => expect(screen.getByTestId('glyph-fallback')).toBeTruthy());
    expect(onBillableRequest).not.toHaveBeenCalled();
  });
});

describe('surface exclusion', () => {
  // Criterion 12 surfaces (pickers, saved lists, recaps, dense maps, markers)
  // must never bill. They should not render this component at all — this is the
  // second gate behind that, so a stray google-live decision cannot leak.
  test('allowed={false} renders the fallback and issues nothing', async () => {
    const onBillableRequest = vi.fn();
    render(
      <GooglePlacePhoto
        placeId="ChIJtest"
        allowed={false}
        fallback={FALLBACK}
        onBillableRequest={onBillableRequest}
      />,
    );
    await waitFor(() => expect(screen.getByTestId('glyph-fallback')).toBeTruthy());
    expect(requestedCount()).toBe(0);
    expect(onBillableRequest).not.toHaveBeenCalled();
  });

  test('an empty placeId is treated as unavailable, not requested', async () => {
    render(<GooglePlacePhoto placeId="" fallback={FALLBACK} />);
    await waitFor(() => expect(screen.getByTestId('glyph-fallback')).toBeTruthy());
    expect(requestedCount()).toBe(0);
  });
});
