import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * "Gone" is a claim about somebody's photos, and it has to be earned.
 *
 * Round-4 panel (Codex): every failure — a dropped connection, a 503, an
 * expired token — collapsed into `gone`, so the owner of a SAVED night was told
 * their photo "is no longer available" during a transient outage, about bytes a
 * retention hold is specifically keeping alive (V8-R-NO-009), with no way to
 * retry. Only the server's 404 is authoritative, and it stays undifferentiated
 * on purpose: the boundary route answers 404 for a refusal too, so whether a
 * given media id exists is never leaked.
 */

const getSession = vi.fn();
vi.mock('@/lib/supabase/client', () => ({
  getBrowserSupabase: () => ({ auth: { getSession } }),
}));

import MediaThumb from './MediaThumb';

const MEDIA_ID = '11111111-1111-1111-1111-111111111111';

beforeEach(() => {
  vi.clearAllMocks();
  getSession.mockResolvedValue({ data: { session: { access_token: 't' } } });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(response: unknown): void {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
}

describe('a photo the server says is gone', () => {
  test('404 is the one authoritative "no", and it is terminal', async () => {
    stubFetch({ status: 404, ok: false });
    render(<MediaThumb mediaId={MEDIA_ID} alt="" />);
    await waitFor(() => expect(screen.getByTestId('media-gone')).toBeTruthy());
    expect(screen.queryByTestId('media-retry')).toBeNull();
  });
});

describe('a photo we could not ask about', () => {
  test('a 5xx is temporary and offers a retry, not a deletion', async () => {
    stubFetch({ status: 503, ok: false });
    render(<MediaThumb mediaId={MEDIA_ID} alt="" />);
    await waitFor(() =>
      expect(screen.getByTestId('media-unavailable')).toBeTruthy(),
    );
    expect(
      screen.queryByTestId('media-gone'),
      'a transient outage was reported as a deleted photo',
    ).toBeNull();
  });

  test('a thrown fetch is temporary too', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    render(<MediaThumb mediaId={MEDIA_ID} alt="" />);
    await waitFor(() =>
      expect(screen.getByTestId('media-unavailable')).toBeTruthy(),
    );
  });

  test('an expired token is temporary — signing in again is the retry', async () => {
    stubFetch({ status: 401, ok: false });
    render(<MediaThumb mediaId={MEDIA_ID} alt="" />);
    await waitFor(() =>
      expect(screen.getByTestId('media-unavailable')).toBeTruthy(),
    );
  });

  test('the retry actually re-asks, and a photo that comes back renders', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ status: 503, ok: false })
      .mockResolvedValueOnce({
        status: 200,
        ok: true,
        json: async () => ({ ok: true, url: 'https://example.test/photo.jpg' }),
      });
    vi.stubGlobal('fetch', fetchMock);

    render(<MediaThumb mediaId={MEDIA_ID} alt="" />);
    const retry = await screen.findByTestId('media-retry');
    retry.click();

    await waitFor(() => expect(screen.getByTestId('media-photo')).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('a photo that loads', () => {
  test('renders the signed URL the route returned', async () => {
    stubFetch({
      status: 200,
      ok: true,
      json: async () => ({ ok: true, url: 'https://example.test/photo.jpg' }),
    });
    render(<MediaThumb mediaId={MEDIA_ID} alt="A photo" />);
    const img = await screen.findByTestId('media-photo');
    expect(img.getAttribute('src')).toBe('https://example.test/photo.jpg');
    expect(img.getAttribute('alt')).toBe('A photo');
  });
});
