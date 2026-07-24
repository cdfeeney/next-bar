/**
 * Bar visual identity (blueprint B5) — deterministic glyph + colors derived
 * from a bar's PRIMARY vibe tag (tags[0]) and price tier, plus the local
 * photo URL when the Places ingest has captured one.
 *
 * Pure functions only — same input always yields the same output, so cards
 * never "shuffle" identity between renders/builds. No React, no catalog
 * import (safe for server components and cheap to test).
 *
 * PHOTO FORMAT NOTE: scripts/refresh-places.mjs saves GetPhotoMedia bytes
 * as-is to public/bar-photos/<id>.jpg. Google serves JPEG from the media
 * redirect and converting to WebP would require adding `sharp` (not a dep —
 * kept dependency-free per B5). If that ever changes, update BOTH the
 * script's extension and PHOTO_EXT here.
 */

import type { Bar, VibeTag } from '@/types';

export type BarVisual = {
  /** Emoji for the primary vibe tag, or a 2-letter monogram when tagless. */
  glyph: string;
  /** CSS background color (hsl string). */
  bg: string;
  /** CSS foreground/text color (hsl string). */
  fg: string;
};

/**
 * Exhaustive tag → glyph map. `Record<VibeTag, string>` makes tsc enforce
 * that every VibeTag has a glyph and no unknown tag sneaks in (same pattern
 * as catalog.ts's TAG_BIT_INDEX). Insertion order is load-bearing: each
 * tag's hue is derived from its position here (golden-angle spacing), so
 * treat this map as APPEND-ONLY — reordering shifts every color.
 */
export const TAG_GLYPH: Record<VibeTag, string> = {
  // venue type
  dive: '🍺',
  cocktail: '🍸',
  wine: '🍷',
  beer: '🍻',
  dance: '🪩',
  lounge: '🛋️',
  speakeasy: '🗝️',
  pub: '☘️',
  rooftop: '🌇',
  garden: '🌿',
  // energy
  chill: '😌',
  buzzy: '⚡',
  loud: '🔊',
  // crowd
  locals: '📍',
  'post-work': '💼',
  date: '🌹',
  tourist: '🗽',
  industry: '🥃',
  // texture
  rough: '🧱',
  polished: '✨',
  romantic: '🕯️',
  instagrammable: '📸',
  'old-nyc': '🏛️',
  trendy: '🔥',
  // sound
  indie: '🎸',
  hiphop: '🎤',
  house: '🎧',
  jazz: '🎷',
  live: '🎶',
  // price
  cheap: '🪙',
  mid: '💵',
  pricey: '💳',
  splurge: '💎',
};

const TAG_ORDER = Object.keys(TAG_GLYPH) as VibeTag[];
const TAG_POSITION = new Map<VibeTag, number>(TAG_ORDER.map((t, i) => [t, i]));

/** Golden-angle hue spacing keeps 33 tags visually distinct without hand-picking hues. */
const GOLDEN_ANGLE_DEG = 137.508;

/** Background lightness per price tier — pricier reads darker/moodier. */
const BG_LIGHTNESS_BY_TIER: Record<Bar['priceTier'], number> = {
  1: 32,
  2: 29,
  3: 26,
  4: 23,
};

const BG_SATURATION = 42;
const FG_SATURATION = 70;
const FG_LIGHTNESS = 88;

/** The subset of Bar that visual identity depends on. */
type BarVisualInput = Pick<Bar, 'name' | 'tags' | 'priceTier'>;

function monogram(name: string): string {
  const words = name
    .split(/\s+/)
    .map((w) => w.replace(/[^a-zA-Z0-9]/g, ''))
    .filter(Boolean);
  const letters =
    words.length >= 2 ? words[0][0] + words[1][0] : (words[0] ?? '??').slice(0, 2);
  return letters.toUpperCase();
}

/** Deterministic string hash (djb2) for the tagless-color fallback. */
function hashString(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  }
  return h;
}

function hueForTag(tag: VibeTag): number {
  const pos = TAG_POSITION.get(tag) ?? 0;
  return Math.round((pos * GOLDEN_ANGLE_DEG) % 360);
}

/**
 * Deterministic visual identity for a bar: primary-tag emoji (or 2-letter
 * monogram when the bar has no tags) on a tag-hued tile whose lightness is
 * set by price tier. Stable across runs/builds by construction.
 */
export function barVisual(bar: BarVisualInput): BarVisual {
  const primary: VibeTag | undefined = bar.tags[0];
  const hue = primary != null ? hueForTag(primary) : hashString(bar.name) % 360;
  const glyph = primary != null ? TAG_GLYPH[primary] : monogram(bar.name);
  return {
    glyph,
    bg: `hsl(${hue}, ${BG_SATURATION}%, ${BG_LIGHTNESS_BY_TIER[bar.priceTier]}%)`,
    fg: `hsl(${hue}, ${FG_SATURATION}%, ${FG_LIGHTNESS}%)`,
  };
}

/**
 * Photos are saved as raw JPEG bytes from the Places media redirect —
 * dependency-free (no sharp/WebP re-encode). See header note.
 */
const PHOTO_EXT = 'jpg';

/**
 * Local photo URL for a bar, or null when the Places ingest has no photo
 * for it (render the glyph tile instead). The file itself is downloaded by
 * `scripts/refresh-places.mjs --photos`; photoRef in the sidecar is the
 * signal that a photo exists for this bar.
 */
export function barImageUrl(bar: Pick<Bar, 'id' | 'photoRef'>): string | null {
  return bar.photoRef ? `/bar-photos/${bar.id}.${PHOTO_EXT}` : null;
}
