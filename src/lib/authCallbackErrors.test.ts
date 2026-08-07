import { describe, expect, it } from 'vitest';
import { AuthApiError, AuthPKCECodeVerifierMissingError } from '@supabase/supabase-js';

import {
  CALLBACK_ERROR,
  callbackErrorCode,
  classifyCallbackError,
} from './authCallbackErrors';

/**
 * The P0 this file exists to prevent (audit 2026-08-06): the cross-browser
 * PKCE failure was being reported to users as "That link has expired or was
 * already used", because the SDK's PKCE message contains the words "not
 * found" and the broad expired-link rule tested first.
 *
 * The ordering assertion below is the load-bearing test. If someone reorders
 * the branches, this fails.
 */

const REAL_PKCE_MESSAGE = new AuthPKCECodeVerifierMissingError().message;

describe('the exact SDK error the TestFlight wrapper produces', () => {
  it('the real message contains "not found" — the substring that caused the misdiagnosis', () => {
    // Guards the premise of every other test here. If upstream rewords this,
    // we want a visible failure rather than a silently pointless suite.
    expect(REAL_PKCE_MESSAGE.toLowerCase()).toContain('not found');
    expect(REAL_PKCE_MESSAGE.toLowerCase()).toContain('different browser or device');
  });

  it('is classified as pkce-mismatch, NOT expired-link', () => {
    expect(classifyCallbackError(REAL_PKCE_MESSAGE)).toBe('pkce-mismatch');
  });

  it('collapses to the stable pkce sentinel at the route boundary', () => {
    expect(callbackErrorCode(new AuthPKCECodeVerifierMissingError())).toBe(
      CALLBACK_ERROR.pkceMismatch,
    );
  });
});

describe('callbackErrorCode — emits sentinels, never SDK prose', () => {
  it('maps an expired one-shot link to the otp sentinel', () => {
    expect(callbackErrorCode(new AuthApiError('x', 403, 'otp_expired'))).toBe(
      CALLBACK_ERROR.otpExpired,
    );
    expect(
      callbackErrorCode(new AuthApiError('Email link is invalid or has expired', 401, undefined)),
    ).toBe(CALLBACK_ERROR.otpExpired);
  });

  it('maps anything else to the generic exchange sentinel', () => {
    expect(callbackErrorCode(new AuthApiError('teapot', 418, 'im_a_teapot'))).toBe(
      CALLBACK_ERROR.exchangeFailed,
    );
    expect(callbackErrorCode(new Error('connection reset by peer'))).toBe(
      CALLBACK_ERROR.exchangeFailed,
    );
  });

  it('never returns a value containing the original message', () => {
    const leaky = new AuthApiError(
      'connect ECONNREFUSED 10.0.0.7:5432 while reading user_secrets',
      500,
      undefined,
    );
    const code = callbackErrorCode(leaky);
    expect(code).not.toContain('ECONNREFUSED');
    expect(code).not.toContain('10.0.0.7');
    expect(Object.values(CALLBACK_ERROR)).toContain(code);
  });
});

describe('classifyCallbackError — banner kinds', () => {
  it('routes the pkce sentinel to its own kind', () => {
    expect(classifyCallbackError(CALLBACK_ERROR.pkceMismatch)).toBe('pkce-mismatch');
  });

  it('routes unconfigured to its own kind', () => {
    expect(classifyCallbackError(CALLBACK_ERROR.unconfigured)).toBe('unconfigured');
  });

  it.each([
    CALLBACK_ERROR.missingCode,
    CALLBACK_ERROR.otpExpired,
    CALLBACK_ERROR.invalidConfirmationLink,
    CALLBACK_ERROR.confirmationFailed,
  ])('routes %s to expired-link (resend is the right recovery)', (sentinel) => {
    expect(classifyCallbackError(sentinel)).toBe('expired-link');
  });

  it('routes the generic exchange sentinel to generic', () => {
    expect(classifyCallbackError(CALLBACK_ERROR.exchangeFailed)).toBe('generic');
  });

  it('treats an empty or whitespace value as generic', () => {
    expect(classifyCallbackError('')).toBe('generic');
    expect(classifyCallbackError('   ')).toBe('generic');
  });

  it('still classifies legacy raw messages from an already-deployed build', () => {
    // Links minted before this change redirect with URL-decoded SDK prose.
    // Those users must keep getting a correct banner.
    expect(classifyCallbackError('Email link is invalid or has expired')).toBe('expired-link');
    expect(classifyCallbackError('flow state not found')).toBe('expired-link');
    expect(classifyCallbackError('server_error')).toBe('generic');
  });

  it('is case-insensitive', () => {
    expect(classifyCallbackError('PKCE_CODE_VERIFIER_NOT_FOUND')).toBe('pkce-mismatch');
  });
});
