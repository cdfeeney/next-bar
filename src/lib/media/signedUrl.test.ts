import { describe, expect, it, vi } from 'vitest';

import { resolveMediaWindow } from './mediaWindow';
import {
  mintSignedMediaUrl,
  serverTtlSeconds,
  SIGNED_URL_MAX_SECONDS,
} from './signedUrl';

/**
 * V8-R-STO-015 — "The expiry of a signed media URL is decided and enforced
 * server-side. A minted URL must not outlive the media's own window or survive
 * its deletion."
 */

const NOW = Date.parse('2026-08-24T12:00:00.000Z');
const at = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();

describe('serverTtlSeconds — V8-R-STO-015', () => {
  it('never exceeds the media window', () => {
    expect(serverTtlSeconds(at(60_000), NOW)).toBe(60);
  });

  it('never exceeds the ceiling even when the media lives much longer', () => {
    expect(serverTtlSeconds(at(24 * 60 * 60 * 1000), NOW)).toBe(SIGNED_URL_MAX_SECONDS);
  });

  it('grants nothing once the media has expired', () => {
    expect(serverTtlSeconds(at(-1), NOW)).toBe(0);
    expect(serverTtlSeconds(at(-60_000), NOW)).toBe(0);
  });

  it('grants nothing for a sub-second remainder', () => {
    // Rounding 999ms up to a one-second URL hands out a link that outlives
    // expires_at — a bearer link to content the database has stopped serving.
    expect(serverTtlSeconds(at(999), NOW)).toBe(0);
    expect(serverTtlSeconds(at(1), NOW)).toBe(0);
  });

  it('grants exactly the floor of the remaining seconds', () => {
    expect(serverTtlSeconds(at(1_999), NOW)).toBe(1);
    expect(serverTtlSeconds(at(90_500), NOW)).toBe(90);
  });

  it('grants nothing for an unparseable expiry rather than defaulting to the ceiling', () => {
    expect(serverTtlSeconds('not-a-timestamp', NOW)).toBe(0);
  });

  it('applies the ceiling when the media has no expiry of its own', () => {
    expect(serverTtlSeconds(null, NOW)).toBe(SIGNED_URL_MAX_SECONDS);
  });
});

describe('mintSignedMediaUrl — the server decides, the caller cannot ask', () => {
  function fakeClient(signedUrl: string | null) {
    const createSignedUrl = vi.fn(async (_path: string, _expiresIn: number) =>
      signedUrl === null
        ? { data: null, error: { message: 'denied' } }
        : { data: { signedUrl }, error: null });
    return {
      client: { storage: { from: () => ({ createSignedUrl }) } },
      createSignedUrl,
    };
  }

  it('passes the SERVER-computed lifetime to Storage', async () => {
    const { client, createSignedUrl } = fakeClient('https://example.test/signed');

    const result = await mintSignedMediaUrl(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client as any,
      'user/media',
      at(45_000),
      NOW,
    );

    expect(result.ok).toBe(true);
    // 45 seconds of media life, not the 300-second ceiling and not anything a
    // caller could have named — there is no parameter through which to name it.
    expect(createSignedUrl).toHaveBeenCalledWith('user/media', 45);
  });

  it('does not call Storage at all once the window has closed', async () => {
    const { client, createSignedUrl } = fakeClient('https://example.test/signed');

    const result = await mintSignedMediaUrl(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client as any,
      'user/media',
      at(-1_000),
      NOW,
    );

    expect(result.ok).toBe(false);
    expect(createSignedUrl).not.toHaveBeenCalled();
  });

  it('reports a refused mint honestly instead of a placeholder', async () => {
    const { client } = fakeClient(null);
    const result = await mintSignedMediaUrl(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client as any,
      'user/media',
      at(60_000),
      NOW,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('denied');
  });

  it('is unavailable rather than silently successful with no client', async () => {
    const result = await mintSignedMediaUrl(null, 'user/media', at(60_000), NOW);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('unavailable');
  });
});

describe('resolveMediaWindow — the window is the LAST live destination', () => {
  it('is not readable with no live destination', () => {
    expect(resolveMediaWindow([])).toEqual({ readable: false });
  });

  it('takes the latest expiry, so a shorter destination cannot cut a longer one short', () => {
    const window = resolveMediaWindow([
      { kind: 'story', expiresAt: at(10_000) },
      { kind: 'story', expiresAt: at(90_000) },
    ]);
    expect(window).toEqual({ readable: true, expiresAt: at(90_000) });
  });

  it('treats a destination with no expiry as unbounded', () => {
    const window = resolveMediaWindow([
      { kind: 'story', expiresAt: at(10_000) },
      { kind: 'archive', expiresAt: null },
    ]);
    expect(window).toEqual({ readable: true, expiresAt: null });
  });

  it('does not turn corrupt timestamps into an unbounded window', () => {
    expect(resolveMediaWindow([{ kind: 'story', expiresAt: 'nonsense' }]))
      .toEqual({ readable: false });
  });
});
