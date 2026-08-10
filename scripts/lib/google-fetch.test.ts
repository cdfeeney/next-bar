import { describe, expect, it, vi } from 'vitest';

import { API_REJECTED, classifyError, BLOCKING_ERROR_CLASSES } from './coverage-manifest.mjs';
import { fetchJson } from './google-fetch.mjs';

/**
 * The defect these cover: the real transport threw `new Error(...)` without a
 * status, so `classifyError(error, error.status)` saw `undefined`, fell through
 * to the `network` default, and every permanent Google 4xx became a BLOCKING
 * class — unfixable by the engine and unwaivable by the operator at once.
 *
 * The fixture transport set `.status` by hand, which is exactly why 20 offline
 * checks passed over a broken production path. These tests exercise the real
 * transport instead of a double, so that gap cannot reopen.
 */
const noSleep = () => Promise.resolve();

/** What the transport throws: the status it saw, and whether it would try again. */
type Failure = Error & { status?: number; retryable?: boolean };

function respondWith(status: number, body: unknown = {}) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: `status ${status}`,
    json: async () => body,
  });
}

describe('fetchJson error status', () => {
  it('attaches the HTTP status to a permanent 4xx error', async () => {
    const fetchImpl = respondWith(400, { error: { message: 'Invalid includedTypes' } });

    const error = await fetchJson('https://x', {}, 'Google Nearby Search', {
      fetchImpl,
      sleep: noSleep,
    }).catch((caught: Error & { status?: number }) => caught);

    expect((error as Error & { status?: number }).status).toBe(400);
    // A permanent 400 throws immediately; it is not worth a retry.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('classifies a permanent 400 as the waivable http4xx, never as blocking network', async () => {
    const error = (await fetchJson('https://x', {}, 'Google Nearby Search', {
      fetchImpl: respondWith(400, { error: { message: 'Invalid includedTypes' } }),
      sleep: noSleep,
    }).catch((caught) => caught)) as Error & { status?: number };

    const errorClass = classifyError(error, error.status);

    expect(errorClass).toBe('http4xx');
    // This is the property the operator's waiver lever depends on.
    expect(BLOCKING_ERROR_CLASSES).not.toContain(errorClass);
  });

  it('still classifies a 429 as quota and a 500 as http5xx after exhausting retries', async () => {
    const quota = (await fetchJson('https://x', {}, 'Google Nearby Search', {
      fetchImpl: respondWith(429, { error: { message: 'Quota exceeded per day' } }),
      sleep: noSleep,
    }).catch((caught) => caught)) as Error & { status?: number };
    expect(quota.status).toBe(429);
    expect(classifyError(quota, quota.status)).toBe('quota');

    const server = (await fetchJson('https://x', {}, 'Google Nearby Search', {
      fetchImpl: respondWith(500, { error: { message: 'backend error' } }),
      sleep: noSleep,
    }).catch((caught) => caught)) as Error & { status?: number };
    expect(server.status).toBe(500);
    expect(classifyError(server, server.status)).toBe('http5xx');
  });

  it('keeps the status when the body fails to parse, so a WAF page is still http4xx', async () => {
    // A permanent 403 behind a proxy or WAF returns an HTML error page, so
    // `response.json()` throws. The response HAD arrived and its status was
    // known; discarding it put the cell back in the unfixable-and-unwaivable
    // state this module exists to prevent.
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      statusText: 'Forbidden',
      json: async () => {
        throw new SyntaxError('Unexpected token < in JSON at position 0');
      },
    });

    const error = (await fetchJson('https://x', {}, 'Google Nearby Search', {
      fetchImpl,
      sleep: noSleep,
    }).catch((caught) => caught)) as Error & { status?: number };

    expect(error.status).toBe(403);
    expect(classifyError(error, error.status)).toBe('http4xx');
    expect(BLOCKING_ERROR_CLASSES).not.toContain(classifyError(error, error.status));
    // Permanent: not worth burning all four attempts on.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("trusts Google's own error.code over a 200 envelope", async () => {
    // A gateway can wrap a real 403 in HTTP 200. Classifying by the envelope
    // matched no numeric guard, fell through to blocking `network`, and threw
    // at once because 200 is not retryable -- permanently stuck, no lever.
    const error = (await fetchJson('https://x', {}, 'Google Nearby Search', {
      fetchImpl: vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({ error: { code: 403, message: 'PERMISSION_DENIED: key blocked' } }),
      }),
      sleep: noSleep,
    }).catch((caught) => caught)) as Error & { status?: number };

    expect(error.status).toBe(403);
    expect(classifyError(error, error.status)).toBe('http4xx');
  });

  it('classifies a 200 error body with no numeric code as waivable, not blocking', async () => {
    // The last door into the "neither fixable nor waivable" state. A 200 wrapping
    // an error body matches no numeric guard in classifyError, so it used to fall
    // through to the blocking `network` default -- and because 200 is not
    // retryable it threw at once, leaving the cell permanently stuck with the
    // waiver refused on the promise that a retry might help.
    const error = (await fetchJson('https://x', {}, 'Google Nearby Search', {
      fetchImpl: vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        // No numeric `code`, so there is nothing left to key a status on.
        json: async () => ({ error: { message: 'request rejected' } }),
      }),
      sleep: noSleep,
    }).catch((caught) => caught)) as Failure;

    expect(error.retryable).toBe(false);
    const errorClass = classifyError(error, error.status);
    expect(errorClass).toBe(API_REJECTED);
    expect(BLOCKING_ERROR_CLASSES).not.toContain(errorClass);
  });

  it('does not mark a retryable failure permanent', async () => {
    // The complement: marking everything permanent would hand the operator a
    // waiver over geography a resume would have covered.
    const error = (await fetchJson('https://x', {}, 'Google Nearby Search', {
      fetchImpl: vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
        json: async () => ({ error: { message: 'backend unavailable' } }),
      }),
      sleep: noSleep,
    }).catch((caught) => caught)) as Failure;

    expect(error.retryable).toBe(true);
    expect(classifyError(error, error.status)).toBe('http5xx');
  });

  // A non-retryable 5xx: the transport will not try again, so the classifier
  // must not file it as blocking http5xx and refuse the operator a waiver.
  it.each([501, 505, 508, 511, 520])(
    'keeps a non-retryable %i waivable instead of filing it as blocking http5xx',
    async (status) => {
      const error = (await fetchJson('https://x', {}, 'Google Nearby Search', {
        fetchImpl: vi.fn().mockResolvedValue({
          ok: false,
          status,
          statusText: 'nope',
          json: async () => ({ error: { message: 'not implemented' } }),
        }),
        sleep: noSleep,
      }).catch((caught) => caught)) as Failure;

      expect(error.retryable).toBe(false);
      const errorClass = classifyError(error, error.status);
      expect(BLOCKING_ERROR_CLASSES).not.toContain(errorClass);
    },
  );

  // gRPC canonical codes share the `error.code` field with REST HTTP statuses,
  // and both of these mean "try again later".
  it.each([
    [8, 'RESOURCE_EXHAUSTED'],
    [14, 'UNAVAILABLE'],
  ])('does not read canonical code %i (%s) as an HTTP status', async (code) => {
    const error = (await fetchJson('https://x', {}, 'Google Nearby Search', {
      fetchImpl: vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
        json: async () => ({ error: { code, message: 'backend' } }),
      }),
      sleep: noSleep,
    }).catch((caught) => caught)) as Failure;

    // The envelope status stands; the canonical code is not a status.
    expect(error.status).toBe(503);
    const errorClass = classifyError(error, error.status);
    expect(errorClass).toBe('http5xx');
    // Transient, so it must stay blocking -- a resume is the right answer.
    expect(BLOCKING_ERROR_CLASSES).toContain(errorClass);
  });

  it.each([8, 14])(
    'keeps a transient canonical code %i blocking even inside a healthy 200 envelope',
    async (code) => {
      // Refusing the code as a status was only half the fix: the envelope was
      // then 200, which is not retryable, so a temporary backend outage was
      // still offered to the operator as a permanently-failed cell.
      const fetchImpl = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({ error: { code, message: 'backend' } }),
      });

      const error = (await fetchJson('https://x', {}, 'Google Nearby Search', {
        fetchImpl,
        sleep: noSleep,
      }).catch((caught) => caught)) as Failure;

      expect(fetchImpl.mock.calls.length).toBeGreaterThan(1);
      expect(error.retryable).toBe(true);
      expect(BLOCKING_ERROR_CLASSES).toContain(classifyError(error, error.status));
    },
  );

  // Transient client errors. Treated as permanent, they became a waiver over
  // geography the next attempt would have collected.
  it.each([408, 425])('retries a transient %i and keeps it blocking', async (status) => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status,
      statusText: 'transient',
      json: async () => ({ error: { message: 'timeout' } }),
    });

    const error = (await fetchJson('https://x', {}, 'Google Nearby Search', {
      fetchImpl,
      sleep: noSleep,
    }).catch((caught) => caught)) as Failure;

    expect(fetchImpl.mock.calls.length).toBeGreaterThan(1);
    expect(error.retryable).toBe(true);
    expect(BLOCKING_ERROR_CLASSES).toContain(classifyError(error, error.status));
  });

  it('retries a torn body on a healthy response, then stops promising a resume', async () => {
    // A 2xx whose body fails to read is a truncated read: worth retrying. But a
    // body that never once parses has disproved that optimism, and a cell whose
    // every read fails must stay waivable rather than blocking forever.
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => {
        throw new SyntaxError('Unexpected end of JSON input');
      },
    });

    const error = (await fetchJson('https://x', {}, 'Google Nearby Search', {
      fetchImpl,
      sleep: noSleep,
    }).catch((caught) => caught)) as Failure;

    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(error.retryable).toBe(false);
    expect(BLOCKING_ERROR_CLASSES).not.toContain(classifyError(error, error.status));
  });

  it('treats a 403 quota rejection as blocking, since a daily cap reopens', async () => {
    const error = (await fetchJson('https://x', {}, 'Google Nearby Search', {
      fetchImpl: vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        json: async () => ({ error: { message: 'Quota exceeded per day' } }),
      }),
      sleep: noSleep,
    }).catch((caught) => caught)) as Failure;

    expect(classifyError(error, error.status)).toBe('quota');
  });

  it('does not call an ordinary permanent 403 a quota block on message alone', async () => {
    // The regex used to run against every status, so any permanent error whose
    // text mentioned a rate limit was filed blocking and lost its waiver.
    const error = (await fetchJson('https://x', {}, 'Google Nearby Search', {
      fetchImpl: vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        json: async () => ({ error: { message: 'invalid argument near rate limit field' } }),
      }),
      sleep: noSleep,
    }).catch((caught) => caught)) as Failure;

    const errorClass = classifyError(error, error.status);
    expect(errorClass).toBe('http4xx');
    expect(BLOCKING_ERROR_CLASSES).not.toContain(errorClass);
  });

  it('leaves a genuine socket failure without a status, so it stays network', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('ECONNRESET'));

    const error = (await fetchJson('https://x', {}, 'Google Nearby Search', {
      fetchImpl,
      sleep: noSleep,
    }).catch((caught) => caught)) as Error & { status?: number };

    expect(error.status).toBeUndefined();
    expect(classifyError(error, error.status)).toBe('network');
  });

  it('returns the body on success', async () => {
    await expect(
      fetchJson('https://x', {}, 'Google Nearby Search', {
        fetchImpl: respondWith(200, { places: [{ id: 'a' }] }),
        sleep: noSleep,
      }),
    ).resolves.toEqual({ places: [{ id: 'a' }] });
  });
});
