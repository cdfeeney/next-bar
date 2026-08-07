import { describe, expect, it } from 'vitest';
import { AuthApiError, AuthRetryableFetchError } from '@supabase/supabase-js';

import { AUTH_COPY, authErrorMessage, classifyAuthError } from './authErrors';

/**
 * The regression that motivated this file: WebKit's fetch failure message is
 * the literal string "Load failed", and `auth-js` copies it verbatim into
 * `AuthRetryableFetchError`. Rendering `error.message` therefore showed users
 * an engine-internal string with no guidance. These tests pin that it can
 * never reach the UI again — from real SDK error instances, not hand-rolled
 * shapes, so an upstream change to the class is caught here.
 */

describe('classifyAuthError — transport failures', () => {
  it.each([
    ['Load failed', 'WebKit / iOS Safari'],
    ['Failed to fetch', 'Chromium'],
    ['NetworkError when attempting to fetch resource.', 'Firefox'],
  ])('classifies %s (%s) as network', (message) => {
    const error = new AuthRetryableFetchError(message, 0);
    expect(classifyAuthError(error)).toBe('network');
  });

  it('classifies a 503 retryable error as network', () => {
    expect(classifyAuthError(new AuthRetryableFetchError('Service Unavailable', 503))).toBe(
      'network',
    );
  });

  it('still classifies as network when the __isAuthError brand is absent', () => {
    // Two copies of auth-js in the tree break the branded guard; the name
    // fallback is what stops that silently degrading to generic copy.
    const unbranded = { name: 'AuthRetryableFetchError', message: 'Load failed', status: 0 };
    expect(classifyAuthError(unbranded)).toBe('network');
  });
});

describe('classifyAuthError — preserved, actionable distinctions', () => {
  it('classifies invalid credentials by stable code', () => {
    expect(
      classifyAuthError(new AuthApiError('whatever', 400, 'invalid_credentials')),
    ).toBe('invalid-credentials');
  });

  it('classifies invalid credentials by legacy message when code is absent', () => {
    // GoTrue responses without `error_code` and without an x-api-version
    // header arrive with `code === undefined` — the fallback keeps them
    // classified rather than degrading to generic copy.
    expect(
      classifyAuthError(new AuthApiError('Invalid login credentials', 400, undefined)),
    ).toBe('invalid-credentials');
  });

  it('classifies unconfirmed email', () => {
    expect(
      classifyAuthError(new AuthApiError('Email not confirmed', 400, 'email_not_confirmed')),
    ).toBe('email-not-confirmed');
  });

  it('classifies rate limiting by code, by status, and by message', () => {
    expect(
      classifyAuthError(new AuthApiError('x', 429, 'over_email_send_rate_limit')),
    ).toBe('rate-limited');
    expect(classifyAuthError(new AuthApiError('x', 429, undefined))).toBe('rate-limited');
    expect(
      classifyAuthError(new AuthApiError('Email rate limit exceeded', 400, undefined)),
    ).toBe('rate-limited');
  });

  it('classifies same-password', () => {
    expect(classifyAuthError(new AuthApiError('x', 422, 'same_password'))).toBe(
      'same-password',
    );
    expect(
      classifyAuthError(
        new AuthApiError(
          'New password should be different from the old password.',
          422,
          undefined,
        ),
      ),
    ).toBe('same-password');
  });

  it('classifies weak passwords', () => {
    expect(classifyAuthError(new AuthApiError('x', 422, 'weak_password'))).toBe(
      'weak-password',
    );
  });

  it('classifies an already-registered email', () => {
    expect(classifyAuthError(new AuthApiError('x', 422, 'user_already_exists'))).toBe(
      'email-exists',
    );
  });
});

describe('classifyAuthError — unknown inputs', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a bare string', 'kaboom'],
    ['a plain Error', new Error('database is on fire')],
    ['an unrecognised api error', new AuthApiError('teapot', 418, 'im_a_teapot')],
  ])('treats %s as unknown', (_label, input) => {
    expect(classifyAuthError(input)).toBe('unknown');
  });
});

describe('authErrorMessage — never leaks SDK wording', () => {
  it('returns connection guidance instead of "Load failed"', () => {
    const message = authErrorMessage(new AuthRetryableFetchError('Load failed', 0), 'reset');
    expect(message).toBe(AUTH_COPY.network);
    expect(message).not.toMatch(/load failed/i);
  });

  it('never returns the underlying message for ANY context', () => {
    const secret = 'Load failed';
    const contexts = ['signin', 'signup', 'reset', 'update'] as const;
    for (const context of contexts) {
      expect(authErrorMessage(new AuthRetryableFetchError(secret, 0), context)).not.toContain(
        secret,
      );
    }
  });

  it('falls back to generic app copy for unrecognised errors', () => {
    expect(authErrorMessage(new Error('Postgres exploded: relation "x" missing'), 'signin')).toBe(
      AUTH_COPY.generic,
    );
  });

  it('keeps rate-limit wording recognisable in both email and attempt contexts', () => {
    const limit = new AuthApiError('x', 429, 'over_email_send_rate_limit');
    expect(authErrorMessage(limit, 'reset')).toMatch(/rate limit/i);
    expect(authErrorMessage(limit, 'signin')).toMatch(/rate limit/i);
  });

  it('points a signed-in user at the right recovery for same-password', () => {
    expect(authErrorMessage(new AuthApiError('x', 422, 'same_password'), 'update')).toBe(
      AUTH_COPY.samePassword,
    );
  });
});
