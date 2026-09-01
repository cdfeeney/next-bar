import { afterEach, describe, expect, test, vi } from 'vitest';

import { requestAccountDeletionOutcome } from './_deleteRequest';

/**
 * Three outcomes, because only three are honestly distinguishable.
 *
 * `src/app/api/account/delete/route.ts` answers with a distinct `error` string
 * per branch, and exactly three of them are emitted on a path that returns
 * BEFORE `deleteUser` runs. Those three are certain refusals. Everything else
 * — `server_error`, an unreadable body, a dropped connection — is not, and is
 * reported as unknown rather than guessed into the safe-sounding answer.
 */

const respond = (status: number, body: unknown): void => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    })),
  );
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('requestAccountDeletionOutcome', () => {
  test('reports a confirmed deletion', async () => {
    respond(200, { ok: true });

    expect(await requestAccountDeletionOutcome('t')).toBe('deleted');
  });

  test.each(['unauthorized', 'rate_limited', 'unavailable'])(
    'reports %s as a refusal — the route returns it before deleting anything',
    async (error) => {
      respond(401, { ok: false, error });

      expect(await requestAccountDeletionOutcome('t')).toBe('refused');
    },
  );

  test('reports server_error as UNKNOWN, not as a refusal', async () => {
    // That one code covers both a refused deleteUser (nothing removed) and a
    // transport throw around it (the delete may well have landed). It cannot
    // be read as "nothing was removed".
    respond(500, { ok: false, error: 'server_error' });

    expect(await requestAccountDeletionOutcome('t')).toBe('unknown');
  });

  test('reports a dropped connection as unknown — the delete may have committed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );

    expect(await requestAccountDeletionOutcome('t')).toBe('unknown');
  });

  test('reports an unreadable reply as unknown', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError('Unexpected end of JSON input');
        },
      })),
    );

    expect(await requestAccountDeletionOutcome('t')).toBe('unknown');
  });

  test('a 200 that does not actually say ok is not a deletion', async () => {
    respond(200, { ok: false });

    expect(await requestAccountDeletionOutcome('t')).toBe('unknown');
  });
});
