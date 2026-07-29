import type { Bar } from '@/types';
import { barImageUrls } from '@/lib/barVisual';

/**
 * ONE place that decides where a bar's imagery may come from.
 *
 * Google's Places policy permits storing the place_id indefinitely and
 * little else; the ~3,435 photo files currently in public/bar-photos are
 * Google Place photos we downloaded, re-encoded and now serve from our own
 * domain. That is the thing Phase 1 exists to stop.
 *
 * So the legacy files are NOT modelled as "ours". They get their own
 * source (`legacy-google-cached`) and their own kill switch, which makes
 * the non-compliant state visible in the type system instead of hidden
 * behind a filename. When first-party media exists we flip one flag and
 * the app stops serving them — deletion then becomes a cleanup, not a
 * cutover.
 */

export type MediaSource =
  | 'nextbar'
  | 'venue'
  | 'user'
  | 'google-live'
  | 'legacy-google-cached'
  | 'glyph';

export type MediaDecision =
  | { source: Exclude<MediaSource, 'glyph' | 'google-live'>; urls: string[] }
  | { source: 'google-live'; placeId: string }
  | { source: 'glyph' };

/** A photo we hold rights to (bar_photos rows), newest-first per bar. */
export type OwnedPhoto = {
  url: string;
  source: 'nextbar' | 'venue' | 'user';
  isPrimary: boolean;
};

export type MediaFlags = {
  /** Live Google UI Kit media. */
  googleLive: boolean;
  /** The legacy re-hosted Google photo files still on disk. */
  legacyCache: boolean;
};

/**
 * Flags are PASSED IN, never held in module scope.
 *
 * The obvious implementation is a mutable module-level `let` plus a
 * setter — and on the server that is a cross-request contamination bug,
 * because Next.js module scope is process-global and shared by every
 * concurrent request. One request flipping the kill switch would silently
 * change what another request renders. (Caught in review, 2026-07-27.)
 *
 * BOTH defaults are now fail-closed: absence of configuration can never
 * serve Google-derived media.
 *
 * googleLive is OFF until the UI Kit integration is reviewed and its spend
 * caps are in place, because an accidental enable is a billable event on
 * every card render.
 *
 * legacyCache WAS `!== '0'` — opt-OUT — which meant the ~3,435 re-hosted
 * Google photo files served whenever the variable was absent, empty,
 * misspelled, or set to something reasonable-looking like 'false'. Google's
 * Places policy permits storing place_id indefinitely and explicitly does
 * NOT permit re-hosting photo content, so "absent config" was defaulting to
 * the non-compliant state. The dangerous case is an emergency ROLLBACK: a
 * redeploy of a build that predates the variable has it compiled in as
 * undefined, and nobody audits env vars during a rollback.
 *
 * Note the guarantee is weaker than it looks, and deliberately so: these are
 * NEXT_PUBLIC_*, inlined at BUILD time. A build shipped without the variable
 * keeps its value for that build's entire life. Making the flip runtime-
 * controllable is the unresolved kill-switch-transport decision (D1) — see
 * docs/UI-KIT-BUILD-PLAN.md. This change fixes the DEFAULT, not the latency.
 */
export function defaultMediaFlags(): MediaFlags {
  return {
    googleLive: process.env.NEXT_PUBLIC_GOOGLE_MEDIA === '1',
    legacyCache: process.env.NEXT_PUBLIC_LEGACY_PHOTOS === '1',
  };
}

/**
 * Flags for a surface that criterion 12 EXCLUDES from Google media —
 * pickers, saved/list views, recaps, dense maps, markers.
 *
 * Passing these still lets a surface show media we actually own; it only
 * refuses the Google-derived tiers. Expressed here rather than as a
 * per-component `if` so "which surfaces may load Google media" stays one
 * decision in one file.
 */
export const NO_GOOGLE_MEDIA: MediaFlags = {
  googleLive: false,
  legacyCache: false,
};

/**
 * Resolve imagery for a bar in strict priority order:
 *   owned → venue → approved user → live Google → legacy cache → glyph
 *
 * `owned` is passed in (from bar_photos) rather than read here so this
 * stays a pure function: the same bar + same photos always yields the same
 * decision, which is what makes it testable and keeps cards from flapping
 * between renders.
 */
export function resolveMedia(
  bar: Pick<Bar, 'id' | 'photoRef' | 'photoCount' | 'googlePlaceId'>,
  owned: readonly OwnedPhoto[] = [],
  flags: MediaFlags = defaultMediaFlags(),
): MediaDecision {
  for (const source of ['nextbar', 'venue', 'user'] as const) {
    const matching = owned.filter((p) => p.source === source);
    if (matching.length > 0) {
      const sorted = [...matching].sort(
        (a, b) => Number(b.isPrimary) - Number(a.isPrimary),
      );
      return { source, urls: sorted.map((p) => p.url) };
    }
  }

  if (flags.googleLive && bar.googlePlaceId) {
    return { source: 'google-live', placeId: bar.googlePlaceId };
  }

  if (flags.legacyCache) {
    const urls = barImageUrls(bar);
    if (urls.length > 0) return { source: 'legacy-google-cached', urls };
  }

  return { source: 'glyph' };
}

/** True when the decision requires a visible Google attribution. */
export function needsGoogleAttribution(decision: MediaDecision): boolean {
  return (
    decision.source === 'google-live' ||
    decision.source === 'legacy-google-cached'
  );
}
