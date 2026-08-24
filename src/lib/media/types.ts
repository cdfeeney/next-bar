/**
 * Shared vocabulary for the media trust boundary (WP1).
 *
 * The result shape mirrors `src/lib/stories.server.ts`: a discriminated union
 * rather than a throw, so a caller cannot accidentally treat a failure as a
 * success. Every requirement in this lane has a "must not report success"
 * clause, and a union is what makes that checkable at the type level.
 */

export type MediaFailureReason =
  /** Supabase is unreachable or unconfigured. Nothing happened. */
  | 'unavailable'
  /** The caller is not the author / not authorized. */
  | 'denied'
  /** The bytes were rejected by inspection (V8-R-STO-014). */
  | 'rejected'
  /**
   * A legal request the product cannot store: the RE-ENCODED bytes exceed the
   * bucket's own file_size_limit. Distinct from 'rejected', which means the
   * bytes were refused on inspection, and from 'failed', which means we broke.
   * The caller answers 413, matching the over-sized-input rule.
   */
  | 'too_large'
  /** The operation was attempted and did not complete. */
  | 'failed';

export type MediaResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: MediaFailureReason; message: string };

export function mediaFailure<T>(
  reason: MediaFailureReason,
  message: string,
): MediaResult<T> {
  return { ok: false, reason, message };
}

export function mediaUnavailable<T>(): MediaResult<T> {
  return {
    ok: false,
    reason: 'unavailable',
    message: 'Media is unavailable right now.',
  };
}

/**
 * The bucket migration 0065 created. WP1 reuses it rather than minting a second
 * one: 0066's reference-count guard is attached to THIS bucket's delete policy,
 * and a second bucket would be a second set of policies to keep in step.
 */
export const MEDIA_BUCKET = 'story-media';

/** A destination kind from 0066's `media_destinations.kind` check constraint. */
export type DestinationKind = 'story' | 'feed' | 'group' | 'archive';

export const DESTINATION_KINDS: readonly DestinationKind[] = [
  'story',
  'feed',
  'group',
  'archive',
];

export function isDestinationKind(value: unknown): value is DestinationKind {
  return typeof value === 'string'
    && (DESTINATION_KINDS as readonly string[]).includes(value);
}
