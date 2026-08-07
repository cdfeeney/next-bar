/**
 * authConfirmDiagnostics — the privacy-safe server-side record for a failed
 * `/auth/confirm`.
 *
 * WHY THIS EXISTS (santa round 1 on g-3fc3789d; Claude/FABLE and Kimi found it
 * independently). The route deliberately logged NOTHING, which made users
 * legible and operators blind. The runbook's own warned-against mistake — a
 * template sending `type=signup` instead of `type=email`, or dropping
 * `token_hash` — surfaces to every user as "that link has expired or was
 * already used", and the resend button mints another link that fails the same
 * way. With no server-side signal, that is indistinguishable from a genuinely
 * expired token and only a wave of support reports would reveal it.
 *
 * The user-facing guarantee is UNCHANGED: the redirect still carries only a
 * fixed sentinel, and no SDK prose ever reaches the page. This adds a
 * server-side category and nothing else.
 *
 * WHAT MUST NEVER APPEAR HERE: the token hash (whole, partial, or hashed), an
 * email address, the query string, the full URL, session or cookie data, an
 * internal hostname, the raw SDK message, or any credential. `buildConfirmFailureRecord`
 * is pure precisely so that guarantee is testable without spying on console.
 */

import { CALLBACK_ERROR } from './authCallbackErrors';

/** Stable across wording changes — alert on this, not on a log line. */
export const CONFIRM_FAILURE_EVENT = 'auth.confirm.failure';

/** Which gate rejected the request. `validation` is the misconfigured-template signal. */
export type ConfirmFailureStage = 'validation' | 'unconfigured' | 'verification';

/**
 * `recovery` and `email` are the only types this app sends. The rest are the
 * remaining `EmailOtpType` values in `@supabase/auth-js` — seeing one of those
 * is the fingerprint of a template pointed at the wrong verification type,
 * which is exactly the failure this record exists to make visible.
 */
const ALLOWED_TYPES: readonly string[] = ['recovery', 'email'];
const OTHER_SUPABASE_EMAIL_TYPES: readonly string[] = [
  'signup',
  'invite',
  'magiclink',
  'email_change',
];

export type OtpTypeCategory =
  | 'allowed'
  | 'known-supabase-type'
  | 'unrecognized'
  | 'absent';

/**
 * The raw `type` is attacker-controlled and unbounded, so it is classified,
 * never logged. A bounded category answers the only question the record is for
 * ("is the template sending the wrong type?") while making CRLF log-forging and
 * multi-kilobyte values structurally impossible.
 */
export function classifyOtpType(raw: string | null | undefined): OtpTypeCategory {
  if (raw === null || raw === undefined || raw === '') return 'absent';
  if (ALLOWED_TYPES.includes(raw)) return 'allowed';
  if (OTHER_SUPABASE_EMAIL_TYPES.includes(raw)) return 'known-supabase-type';
  return 'unrecognized';
}

const MAX_TOKEN_LENGTH = 48;
const SAFE_TOKEN = /^[a-z0-9_]+$/;

/**
 * Bounds an SDK-supplied identifier before it reaches a log sink.
 *
 * A routed consultant argued `error.code` and `error.name` are safe verbatim
 * because the SDK sets them from hardcoded literals. That is true of the
 * shipped subclasses but NOT structurally guaranteed: `CustomAuthError`
 * (auth-js `errors.js`) assigns `this.name` from a constructor PARAMETER, and
 * `code` originates in the GoTrue response body, not in this codebase. Both are
 * therefore treated as untrusted. The cost of bounding them is one regex; the
 * cost of being wrong is injected log records.
 */
export function boundedToken(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return undefined;
  if (normalized.length > MAX_TOKEN_LENGTH) return 'unrecognized';
  return SAFE_TOKEN.test(normalized) ? normalized : 'unrecognized';
}

/**
 * `outcome` is meant to be one of this app's own sentinels. Every shipped
 * caller passes one, so copying it verbatim was safe in practice — but the
 * guarantee belonged to the callers, not to this function, and a future caller
 * could hand it user-derived text (santa round 1, Codex). Bounding it against
 * the sentinel set moves the guarantee into the module.
 */
function boundedOutcome(value: string): string {
  return (Object.values(CALLBACK_ERROR) as string[]).includes(value)
    ? value
    : 'unrecognized';
}

/** Length only — never a prefix, suffix, or hash of the credential itself. */
function boundedLength(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) return 0;
  return value;
}

function boundedStatus(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isInteger(value)) return undefined;
  return value >= 100 && value <= 599 ? value : undefined;
}

function readUnknown(error: unknown, key: string): unknown {
  if (typeof error !== 'object' || error === null) return undefined;
  return (error as Record<string, unknown>)[key];
}

export interface ConfirmFailureRecord {
  event: typeof CONFIRM_FAILURE_EVENT;
  stage: ConfirmFailureStage;
  /** One of this app's own fixed sentinels — never SDK-derived. */
  outcome: string;
  typeCategory: OtpTypeCategory;
  /**
   * Emitted ONLY when the category is `allowed` or `known-supabase-type`, so it
   * can be one of six literals and nothing else. With two templates in play,
   * the category alone does not say which one produced the failing link.
   */
  typeValue?: string;
  /** Presence only. The value is a bearer credential and never appears. */
  hasTokenHash: boolean;
  /**
   * Length only. Without it a TRUNCATED token and a genuinely expired one are
   * byte-identical records, which defeats the whole point of this module
   * (santa round 1, GLM). For a fixed-format hash the length is constant, so it
   * discloses nothing about the secret.
   */
  tokenHashLength: number;
  sdkCode?: string;
  sdkName?: string;
  sdkStatus?: number;
}

export function buildConfirmFailureRecord(input: {
  stage: ConfirmFailureStage;
  outcome: string;
  rawType: string | null | undefined;
  tokenHashLength: number;
  error?: unknown;
}): ConfirmFailureRecord {
  // Snapshot ONCE. Reading `input.rawType` again below would let a getter or
  // Proxy return one value to the classifier and a different one to the record
  // — verified: a two-read getter produced `typeCategory: 'allowed'` with an
  // email in `typeValue` (santa round 2, Codex).
  const rawType = input.rawType;
  const typeCategory = classifyOtpType(rawType);
  const tokenHashLength = boundedLength(input.tokenHashLength);

  const record: ConfirmFailureRecord = {
    event: CONFIRM_FAILURE_EVENT,
    stage: input.stage,
    outcome: boundedOutcome(input.outcome),
    typeCategory,
    hasTokenHash: tokenHashLength > 0,
    tokenHashLength,
  };

  // Safe precisely because it already matched a closed set — see the field doc.
  if (typeCategory === 'allowed' || typeCategory === 'known-supabase-type') {
    record.typeValue = rawType as string;
  }

  // `error.message` is read NOWHERE in this function — that omission is the
  // point, and `authConfirmDiagnostics.test.ts` pins it with a leaky message.
  if (input.error !== undefined && input.error !== null) {
    const code = boundedToken(readUnknown(input.error, 'code'));
    const name = boundedToken(readUnknown(input.error, 'name'));
    const status = boundedStatus(readUnknown(input.error, 'status'));
    if (code !== undefined) record.sdkCode = code;
    if (name !== undefined) record.sdkName = name;
    if (status !== undefined) record.sdkStatus = status;
  }

  return record;
}

/** Matches the repo's `[scope] message` server-log convention. */
export function logConfirmFailure(input: {
  stage: ConfirmFailureStage;
  outcome: string;
  rawType: string | null | undefined;
  tokenHashLength: number;
  error?: unknown;
}): void {
  console.error('[auth/confirm] rejected', buildConfirmFailureRecord(input));
}
