import type { ServerContentErrorKind } from '@/lib/accountContent.server';

/**
 * accountContent.capability — is the account_content_state surface usable in
 * this deployment? (v2.1)
 *
 *   unknown     — nothing proven yet, or only network failures so far.
 *                 Retryable.
 *   available   — at least one request succeeded this epoch.
 *   unavailable — the table is missing (42P01/PGRST205). NOT retryable: a
 *                 missing table does not appear between retries, and a retry
 *                 storm against it is pure noise. A capability epoch reset
 *                 (new sign-in, page load) re-probes once.
 *
 * Auth rejections deliberately do NOT change capability: the surface exists;
 * the caller's token was refused. They surface to the UI instead.
 */

export type AccountContentCapability = 'unknown' | 'available' | 'unavailable';

let capability: AccountContentCapability = 'unknown';

export function getAccountContentCapability(): AccountContentCapability {
  return capability;
}

export function noteAccountContentServerResult(
  kind: 'ok' | ServerContentErrorKind,
): void {
  if (kind === 'ok') {
    capability = 'available';
    authRejected = false;
    return;
  }
  if (kind === 'unavailable') {
    capability = 'unavailable';
    return;
  }
  if (kind === 'auth-rejected') {
    authRejected = true;
    return;
  }
  // failed (network) keeps the current verdict: an outage does not un-deploy
  // a table, and an unknown surface stays unknown/retryable.
  // too-large says nothing about the table's existence.
}

let authRejected = false;

/** Auth/RLS rejections are SURFACED (banner), never blindly retried. */
export function wasAccountContentAuthRejected(): boolean {
  return authRejected;
}

export function noteAccountContentAuthRejection(rejected: boolean): void {
  authRejected = rejected;
}

/** New auth session or page lifecycle: re-probe once. */
export function resetAccountContentCapability(): void {
  capability = 'unknown';
  authRejected = false;
}
