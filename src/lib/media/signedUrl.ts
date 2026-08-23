import type { SupabaseClient } from '@supabase/supabase-js';

import { MEDIA_BUCKET, mediaFailure, mediaUnavailable, type MediaResult } from './types';

/**
 * SERVER-DECIDED SIGNED-URL LIFETIME (V8-R-STO-015).
 *
 * `src/lib/stories.server.ts` records the hole this closes: "TTL IS CLAMPED
 * HERE, NOT IN THE DATABASE... the mint itself is a client call, and a client
 * may pass any `expiresIn` it likes: Storage checks the SELECT policy at mint
 * time, not the requested lifetime."
 *
 * The fix is not a bigger clamp on the client. It is that the mint moves behind
 * a route, and `expiresIn` stops being an input at all: the caller asks for a
 * URL, the SERVER reads the media's own window and decides. There is
 * deliberately no parameter on {@link mintSignedMediaUrl} through which a
 * caller could express a preference — a clamped client value is still a client
 * value, and the requirement says a client-side clamp is not enforcement.
 */

/**
 * Ceiling on any signed media URL, independent of how much life the media has
 * left. Matches `SIGNED_URL_MAX_SECONDS` in stories.server.ts: the two describe
 * the same product rule and would be a bug if they drifted apart.
 */
export const SIGNED_URL_MAX_SECONDS = 300;

/**
 * The effective lifetime: `min(ceiling, time the media itself has left)`.
 *
 * A URL that outlived its media would be a bearer link to content the database
 * has already stopped serving, which is the whole point of the expiry gate.
 *
 * Exported and pure so the rule is testable without a network: the arithmetic
 * IS the requirement, and a rule that only exists inside an async call is a
 * rule nobody can check.
 *
 * @param expiresAt when the media stops being readable; null means no expiry
 *                  of its own, so only the ceiling applies.
 */
export function serverTtlSeconds(
  expiresAt: string | null,
  now: number = Date.now(),
): number {
  if (expiresAt === null) return SIGNED_URL_MAX_SECONDS;

  const remainingMs = Date.parse(expiresAt) - now;
  // An unparseable timestamp is not a licence to mint the ceiling. Zero means
  // "nothing grantable", and the caller renders the honest missing-media state.
  if (!Number.isFinite(remainingMs)) return 0;

  // Under a second left is NOT a second of life: rounding up here hands out a
  // link that outlives `expires_at`. Below one second there is no grantable
  // lifetime, so nothing is minted.
  const remainingSeconds = Math.floor(remainingMs / 1000);
  if (remainingSeconds < 1) return 0;

  return Math.min(SIGNED_URL_MAX_SECONDS, remainingSeconds);
}

export type SignedMediaUrl = {
  url: string;
  /** What the server granted, so the caller can schedule its own refresh. */
  expiresInSeconds: number;
};

/**
 * Mint a signed URL for one object.
 *
 * `client` is deliberately the CALLER'S user-scoped client, not a service-role
 * one: Storage evaluates the bucket SELECT policies at mint time, so passing
 * the caller's own client is what keeps 0065's audience rules authoritative
 * over who may read the object. Service role here would mint for anyone who
 * could reach the route.
 *
 * The TTL, by contrast, is computed by the SERVER from `expiresAt` — which the
 * route reads from the database, never from the request.
 */
export async function mintSignedMediaUrl(
  client: SupabaseClient | null,
  storagePath: string,
  expiresAt: string | null,
  now: number = Date.now(),
): Promise<MediaResult<SignedMediaUrl>> {
  if (client === null) return mediaUnavailable();

  const ttl = serverTtlSeconds(expiresAt, now);
  if (ttl <= 0) {
    // Expired, or so close to it that no lifetime is grantable. "a signing
    // failure renders the honest media state, never a decorative placeholder".
    return mediaFailure('denied', 'That media is no longer available.');
  }

  try {
    const { data, error } = await client.storage
      .from(MEDIA_BUCKET)
      .createSignedUrl(storagePath, ttl);

    if (error || !data?.signedUrl) {
      // Includes the authorization case: the bucket policy refused this
      // caller. Reported as denied rather than dressed up as a missing file.
      return mediaFailure('denied', 'That media is no longer available.');
    }

    return { ok: true, value: { url: data.signedUrl, expiresInSeconds: ttl } };
  } catch {
    return mediaUnavailable();
  }
}
