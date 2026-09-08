import type { Bar } from '@/types';

/** Google media is rendered live by Places UI Kit; cached Google files are retired. */
export type MediaSource = 'nextbar' | 'venue' | 'user' | 'google-live' | 'glyph';

export type MediaDecision =
  | { source: Exclude<MediaSource, 'glyph' | 'google-live'>; urls: string[] }
  | { source: 'google-live'; placeId: string }
  | { source: 'glyph' };

/** A photo we hold rights to (bar_photos rows). */
export type OwnedPhoto = {
  url: string;
  source: 'nextbar' | 'venue' | 'user';
  isPrimary: boolean;
};

export type MediaFlags = { googleLive: boolean };

/** Read per call; absent configuration cannot enable billable requests. */
export function defaultMediaFlags(): MediaFlags {
  return { googleLive: process.env.NEXT_PUBLIC_GOOGLE_MEDIA === '1' };
}

/** Pickers, saved lists, recaps and maps do not request Google media. */
export const NO_GOOGLE_MEDIA: MediaFlags = { googleLive: false };

export function resolveMedia(
  bar: Pick<Bar, 'googlePlaceId'>,
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
  return { source: 'glyph' };
}

/** Widget failures use media we own or a glyph, never a cached Google photo. */
export function resolveFallbackMedia(
  bar: Pick<Bar, 'googlePlaceId'>,
  owned: readonly OwnedPhoto[] = [],
): MediaDecision {
  return resolveMedia(bar, owned, NO_GOOGLE_MEDIA);
}
