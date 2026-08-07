import { describe, expect, it, vi } from 'vitest';
import { AuthApiError } from '@supabase/supabase-js';
import {
  CONFIRM_FAILURE_EVENT,
  boundedToken,
  buildConfirmFailureRecord,
  classifyOtpType,
  logConfirmFailure,
} from './authConfirmDiagnostics';

/**
 * These tests are the redaction contract. The record is emitted to a server log
 * sink, so anything that reaches it is retained by whatever ships those logs —
 * which is why the assertions below are written as "this value must appear
 * NOWHERE in the serialised record" rather than as field-by-field checks. A
 * field added later that happens to carry a token would pass a field check and
 * fail these.
 */

const SENTINEL_TOKEN = 'pkce-sentinel-token-hash-do-not-log';
const SENTINEL_EMAIL = 'victim@example.com';

function serialise(value: unknown): string {
  return JSON.stringify(value);
}

describe('classifyOtpType — bounded, never the raw value', () => {
  it.each([
    ['recovery', 'allowed'],
    ['email', 'allowed'],
  ] as const)('classifies the supported type %s as %s', (raw, expected) => {
    expect(classifyOtpType(raw)).toBe(expected);
  });

  /**
   * The whole diagnostic purpose: `signup` is the obvious-but-wrong value an
   * operator reaches for, and the runbook explicitly warns against it. It must
   * land in its own bucket, distinct from garbage, or the log cannot tell a
   * misconfigured template from a mangled link.
   */
  it.each(['signup', 'invite', 'magiclink', 'email_change'])(
    'classifies the unsupported Supabase type %s as known-supabase-type',
    (raw) => {
      expect(classifyOtpType(raw)).toBe('known-supabase-type');
    },
  );

  it.each([null, undefined, ''])('classifies a missing type (%s) as absent', (raw) => {
    expect(classifyOtpType(raw)).toBe('absent');
  });

  it('classifies anything else as unrecognized', () => {
    expect(classifyOtpType('../../etc/passwd')).toBe('unrecognized');
  });
});

describe('boundedToken — kills log injection and unbounded values', () => {
  it('passes a normal SDK code through, lowercased', () => {
    expect(boundedToken('OTP_Expired')).toBe('otp_expired');
  });

  it.each([
    ['CRLF forging', 'ok\r\nevent=fake.admin.login'],
    ['ANSI escape', '\u001b[31mred'],
    ['null byte', 'ok\u0000injected'],
    ['whitespace split', 'two words'],
    ['punctuation', 'code:with:colons'],
  ])('reduces a %s payload to a fixed marker', (_label, raw) => {
    expect(boundedToken(raw)).toBe('unrecognized');
  });

  it('caps an oversized value instead of forwarding it', () => {
    expect(boundedToken('a'.repeat(4096))).toBe('unrecognized');
  });

  it.each([undefined, null, 42, {}, ''])('drops the non-string value %s', (raw) => {
    expect(boundedToken(raw)).toBeUndefined();
  });
});

describe('buildConfirmFailureRecord — the redaction contract', () => {
  it('records a stable event and the diagnostic category', () => {
    const record = buildConfirmFailureRecord({
      stage: 'validation',
      outcome: 'invalid_confirmation_link',
      rawType: 'signup',
      tokenHashLength: 64,
    });

    expect(record.event).toBe(CONFIRM_FAILURE_EVENT);
    expect(record.stage).toBe('validation');
    expect(record.typeCategory).toBe('known-supabase-type');
    expect(record.hasTokenHash).toBe(true);
  });

  /**
   * The load-bearing assertion. Every forbidden value is fed in at once and the
   * SERIALISED record is searched — so a future field that forwards any of them
   * fails here regardless of what it is named.
   */
  it('never emits the token, an email, the raw SDK message, a URL, or a host', () => {
    const leaky = new AuthApiError(
      `Token ${SENTINEL_TOKEN} for ${SENTINEL_EMAIL} failed at https://internal.db.local:5432`,
      500,
      'otp_expired',
    );

    const record = buildConfirmFailureRecord({
      stage: 'verification',
      outcome: 'otp_expired',
      rawType: 'recovery',
      tokenHashLength: 64,
      error: leaky,
    });
    const dumped = serialise(record);

    expect(dumped).not.toContain(SENTINEL_TOKEN);
    expect(dumped).not.toContain(SENTINEL_EMAIL);
    expect(dumped).not.toContain('internal.db.local');
    expect(dumped).not.toContain('https://');
    expect(dumped).not.toContain('5432');
    expect(dumped).not.toContain('Token ');
    // The safe, bounded parts still survive — redaction must not gut the signal.
    expect(record.sdkCode).toBe('otp_expired');
    expect(record.sdkStatus).toBe(500);
  });

  it('never emits the raw type, even when it is hostile', () => {
    const record = buildConfirmFailureRecord({
      stage: 'validation',
      outcome: 'invalid_confirmation_link',
      rawType: 'recovery\r\nevent=auth.confirm.success',
      tokenHashLength: 64,
    });
    const dumped = serialise(record);

    expect(dumped).not.toContain('auth.confirm.success');
    expect(dumped).not.toContain('\r');
    expect(record.typeCategory).toBe('unrecognized');
  });

  it('bounds a hostile SDK name rather than trusting the class literal', () => {
    // auth-js CustomAuthError assigns `name` from a constructor parameter, so a
    // runtime-named error can carry arbitrary text into this field.
    const record = buildConfirmFailureRecord({
      stage: 'verification',
      outcome: 'confirmation_failed',
      rawType: 'email',
      tokenHashLength: 64,
      error: { name: `Auth\r\n${SENTINEL_EMAIL}`, code: 'x'.repeat(500), status: 99999 },
    });

    expect(record.sdkName).toBe('unrecognized');
    expect(record.sdkCode).toBe('unrecognized');
    expect(record.sdkStatus).toBeUndefined();
    expect(serialise(record)).not.toContain(SENTINEL_EMAIL);
  });

  /**
   * Santa round 1, GLM (HIGH). `hasTokenHash` alone is a boolean, so a template
   * that TRUNCATES the token and a link whose token genuinely expired produce
   * byte-identical records — which is precisely the distinction this module
   * exists to make. The length is a non-sensitive integer: for a fixed-format
   * hash it is constant, so it reveals nothing about the secret while making
   * "the template mangled it" obvious at a glance.
   */
  it('records the token length so a truncated token is distinguishable from an expired one', () => {
    const truncated = buildConfirmFailureRecord({
      stage: 'verification',
      outcome: 'confirmation_failed',
      rawType: 'recovery',
      tokenHashLength: 40,
    });
    const wellFormed = buildConfirmFailureRecord({
      stage: 'verification',
      outcome: 'otp_expired',
      rawType: 'recovery',
      tokenHashLength: 64,
    });

    expect(truncated.tokenHashLength).toBe(40);
    expect(wellFormed.tokenHashLength).toBe(64);
    // Both still report presence; the length is what separates them.
    expect(truncated.hasTokenHash).toBe(true);
    expect(wellFormed.hasTokenHash).toBe(true);
  });

  it('derives hasTokenHash from the length and rejects a nonsense length', () => {
    const absent = buildConfirmFailureRecord({
      stage: 'validation',
      outcome: 'invalid_confirmation_link',
      rawType: null,
      tokenHashLength: 0,
    });
    expect(absent.hasTokenHash).toBe(false);
    expect(absent.tokenHashLength).toBe(0);

    const bogus = buildConfirmFailureRecord({
      stage: 'validation',
      outcome: 'invalid_confirmation_link',
      rawType: null,
      tokenHashLength: -5 as number,
    });
    expect(bogus.tokenHashLength).toBe(0);
  });

  /**
   * Santa round 1, GLM (MEDIUM). With two templates in play, `typeCategory:
   * 'allowed'` does not say WHICH one produced the failing link. The value is
   * safe to emit here precisely because it is only emitted when it already
   * matched a closed set — it can be one of six literals and nothing else.
   */
  it('names the type only when it came from the closed set', () => {
    const allowed = buildConfirmFailureRecord({
      stage: 'verification',
      outcome: 'otp_expired',
      rawType: 'recovery',
      tokenHashLength: 64,
    });
    expect(allowed.typeValue).toBe('recovery');

    const known = buildConfirmFailureRecord({
      stage: 'validation',
      outcome: 'invalid_confirmation_link',
      rawType: 'signup',
      tokenHashLength: 64,
    });
    expect(known.typeValue).toBe('signup');
  });

  it('never names a hostile type, only its category', () => {
    const record = buildConfirmFailureRecord({
      stage: 'validation',
      outcome: 'invalid_confirmation_link',
      rawType: 'recovery\r\nevent=auth.confirm.success',
      tokenHashLength: 64,
    });

    expect(record).not.toHaveProperty('typeValue');
    expect(record.typeCategory).toBe('unrecognized');
    expect(serialise(record)).not.toContain('auth.confirm.success');
  });

  /**
   * Santa round 1, Codex (MEDIUM). `outcome` was copied verbatim, so the
   * module's "structurally safe" claim held only because every SHIPPED caller
   * happens to pass an app-owned constant. Bounding it against the sentinel set
   * makes the guarantee true of the function rather than of its current callers.
   */
  it('bounds an outcome that is not one of our own sentinels', () => {
    const record = buildConfirmFailureRecord({
      stage: 'verification',
      outcome: `leaked ${SENTINEL_EMAIL}`,
      rawType: 'recovery',
      tokenHashLength: 64,
    });

    expect(record.outcome).toBe('unrecognized');
    expect(serialise(record)).not.toContain(SENTINEL_EMAIL);
  });

  it('passes each real sentinel through unchanged', () => {
    for (const sentinel of ['invalid_confirmation_link', 'supabase_unconfigured', 'otp_expired', 'confirmation_failed']) {
      const record = buildConfirmFailureRecord({
        stage: 'verification',
        outcome: sentinel,
        rawType: 'recovery',
        tokenHashLength: 64,
      });
      expect(record.outcome).toBe(sentinel);
    }
  });

  it('omits SDK fields entirely when there is no error object', () => {
    const record = buildConfirmFailureRecord({
      stage: 'validation',
      outcome: 'invalid_confirmation_link',
      rawType: null,
      tokenHashLength: 0,
    });

    expect(record).not.toHaveProperty('sdkCode');
    expect(record).not.toHaveProperty('sdkName');
    expect(record).not.toHaveProperty('sdkStatus');
    expect(record.typeCategory).toBe('absent');
  });
});

describe('logConfirmFailure — emission', () => {
  it('writes one scoped record and leaks nothing through console', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    logConfirmFailure({
      stage: 'verification',
      outcome: 'confirmation_failed',
      rawType: 'recovery',
      tokenHashLength: 64,
      error: new AuthApiError(`fail ${SENTINEL_TOKEN} ${SENTINEL_EMAIL}`, 400, 'bad'),
    });

    expect(spy).toHaveBeenCalledTimes(1);
    const dumped = serialise(spy.mock.calls[0]);
    expect(dumped).toContain('[auth/confirm]');
    expect(dumped).not.toContain(SENTINEL_TOKEN);
    expect(dumped).not.toContain(SENTINEL_EMAIL);

    spy.mockRestore();
  });
});
