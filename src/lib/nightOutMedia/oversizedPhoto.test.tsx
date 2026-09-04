import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * "TRY AGAIN IN A MOMENT" IS THE WRONG ADVICE FOR A PHOTO THAT IS TOO BIG.
 *
 * The platform caps the request body before this app's route ever runs —
 * measured against production 2026-09-03: a 3.70 MB body returns 200, a
 * 4.73 MB body returns 413 FUNCTION_PAYLOAD_TOO_LARGE from the edge. That
 * refusal is not transient, so an identical retry fails identically, and the
 * member is told to do the one thing guaranteed not to work.
 *
 * This surface never looked at the status at all: every non-ok response, 413
 * included, became "That photo didn't upload — try again in a moment."
 *
 * The platform's 413 also arrives as PLAIN TEXT rather than JSON, which is why
 * detecting it cannot be left to the body parse — the status is the only thing
 * that reliably says what happened. `GroupThread.onPickPhoto` already got this
 * right and reads `response.status === 413` directly; this file did not, and
 * an earlier note in the handoff wrongly named BOTH surfaces. Only this one
 * was defective.
 */

const fetchNightOutMedia = vi.fn();
const fetchNightOutMediaWindow = vi.fn();
const addNightOutMedia = vi.fn();
const getSession = vi.fn();

vi.mock('@/lib/supabase/client', () => ({
  getBrowserSupabase: () => ({ auth: { getSession: () => getSession() } }),
}));
vi.mock('@/lib/nightOutMedia/MediaThumb', () => ({ default: () => null }));
vi.mock('@/lib/nightOutMedia/server', () => ({
  fetchNightOutMedia: (...a: unknown[]) => fetchNightOutMedia(...a),
  fetchNightOutMediaWindow: (...a: unknown[]) => fetchNightOutMediaWindow(...a),
  addNightOutMedia: (...a: unknown[]) => addNightOutMedia(...a),
  archiveNightOut: vi.fn(),
}));

import NightOutMedia from '../../app/night-out/[token]/NightOutMedia';

const PLAN = '11111111-1111-4111-8111-111111111111';
const OPEN = {
  opensAt: '2026-08-20T01:00:00.000Z',
  expiresAt: '2026-08-21T01:00:00.000Z',
  isOpen: true,
  state: 'open' as const,
};

/** The platform's own refusal: a 413 whose body is PLAIN TEXT, not JSON. */
function edge413(): Response {
  return {
    ok: false,
    status: 413,
    json: async () => {
      throw new SyntaxError('Unexpected token F in JSON at position 0');
    },
  } as unknown as Response;
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchNightOutMedia.mockResolvedValue([]);
  fetchNightOutMediaWindow.mockResolvedValue(OPEN);
  getSession.mockResolvedValue({ data: { session: { access_token: 'tok' } } });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function pickPhoto(): Promise<void> {
  render(<NightOutMedia planId={PLAN} canAddPhoto />);
  const input = await waitFor(() => {
    const found = document.querySelector('input[type="file"]');
    if (found === null) throw new Error('no file input');
    return found as HTMLInputElement;
  });
  const file = new File(['x'], 'big.jpg', { type: 'image/jpeg' });
  fireEvent.change(input, { target: { files: [file] } });
}

describe('an oversized night-out photo', () => {
  test('is named as too large, not reported as something to retry', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => edge413()));

    await pickPhoto();

    const notice = await screen.findByText(/too large/i);
    expect(notice).toBeTruthy();
    // The specific failure this exists to prevent: telling someone to repeat
    // the exact request the platform has already refused for its size.
    expect(screen.queryByText(/try again in a moment/i)).toBeNull();
    expect(addNightOutMedia).not.toHaveBeenCalled();
  });

  test('a genuinely transient failure still says to try again', async () => {
    // The retry advice is correct HERE, and must not be lost to the fix above.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 503, json: async () => null }) as unknown as Response),
    );

    await pickPhoto();

    expect(await screen.findByText(/try again in a moment/i)).toBeTruthy();
    expect(screen.queryByText(/too large/i)).toBeNull();
  });
});
