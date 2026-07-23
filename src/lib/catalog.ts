/**
 * Catalog access layer (blueprint B1) — the SINGLE accessor for the bar
 * catalog. Every UI import site reads bars through this module instead of
 * importing the static `bars` array directly, so the future static→server
 * swap (Supabase `bars` table with the static array as fallback — see
 * docs/BARS-TABLE-SCHEMA.md) is a change to THIS file only.
 *
 * Shape today:
 *   - The cache is initialized synchronously from the static import, so
 *     `getBars()` resolves instantly and `useBars()` renders with data on
 *     the first paint (no loading flash).
 *   - `getBars()` is async FROM DAY ONE so call sites are already shaped
 *     for a server-backed catalog.
 *   - `useBars()` subscribes via useSyncExternalStore; `replaceCatalog()`
 *     is the future refresh entry point that notifies every subscriber.
 *   - Per-bar tag BITMASKS over the global VibeTag vocabulary are
 *     precomputed at load for the future matching perf path (B7).
 *     `matching.ts` still uses its set-based jaccard — do not rewire it
 *     here; `jaccardByMask` is exported + tested for B7 to adopt.
 *
 * This module is imported by both server components (share page, OG image)
 * and client components, so it carries no 'use client' directive — the
 * hook is only legal to call from client components, the plain accessors
 * work everywhere.
 */

import type { Bar, VibeTag } from '@/types';
import { bars as staticBars } from '@/lib/bars';

// ---------------------------------------------------------------------------
// Global tag vocabulary → bit positions.
//
// Record<VibeTag, number> makes tsc enforce that every VibeTag has exactly
// one bit and no unknown tags sneak in: adding a tag to the union without
// adding it here is a compile error, and vice versa. Bit positions are
// APPEND-ONLY — masks may eventually be persisted/compared across builds,
// so never renumber an existing tag.
// ---------------------------------------------------------------------------

const TAG_BIT_INDEX: Record<VibeTag, number> = {
  // venue type
  dive: 0,
  cocktail: 1,
  wine: 2,
  beer: 3,
  dance: 4,
  lounge: 5,
  speakeasy: 6,
  pub: 7,
  rooftop: 8,
  garden: 9,
  // energy
  chill: 10,
  buzzy: 11,
  loud: 12,
  // crowd
  locals: 13,
  'post-work': 14,
  date: 15,
  tourist: 16,
  industry: 17,
  // texture
  rough: 18,
  polished: 19,
  romantic: 20,
  instagrammable: 21,
  'old-nyc': 22,
  trendy: 23,
  // sound
  indie: 24,
  hiphop: 25,
  house: 26,
  jazz: 27,
  live: 28,
  // price
  cheap: 29,
  mid: 30,
  pricey: 31,
  splurge: 32,
};

/** Every known VibeTag, ordered by bit position (bit i = TAG_VOCABULARY[i]). */
export const TAG_VOCABULARY: readonly VibeTag[] = (
  Object.entries(TAG_BIT_INDEX) as Array<[VibeTag, number]>
)
  .sort((a, b) => a[1] - b[1])
  .map(([tag]) => tag);

// Module-load invariant (Opus review): bit positions must be pairwise
// distinct — a copy-paste duplicate would compile fine and silently corrupt
// any persisted mask. Fail loudly at import time, not just in one test.
if (new Set(Object.values(TAG_BIT_INDEX)).size !== TAG_VOCABULARY.length) {
  throw new Error('catalog: TAG_BIT_INDEX bit positions must be distinct');
}

/** Fold a tag list into its bitmask over the global vocabulary. */
export function tagsToMask(tags: readonly VibeTag[]): bigint {
  let mask = 0n;
  for (const tag of tags) {
    mask |= 1n << BigInt(TAG_BIT_INDEX[tag]);
  }
  return mask;
}

function popcount(mask: bigint): number {
  let count = 0;
  let v = mask;
  while (v !== 0n) {
    v &= v - 1n; // clear lowest set bit
    count += 1;
  }
  return count;
}

/**
 * Jaccard similarity of two tag bitmasks: |A∩B| / |A∪B| via AND/OR +
 * popcount. Agrees exactly with `jaccard()` in matching.ts for tag sets
 * drawn from the vocabulary (both return 0 for two empty sets). This is
 * the future perf path — B7 adopts it inside matching; nothing routes
 * through it in the hot path yet.
 */
export function jaccardByMask(a: bigint, b: bigint): number {
  const union = popcount(a | b);
  if (union === 0) return 0;
  return popcount(a & b) / union;
}

// ---------------------------------------------------------------------------
// Catalog store.
// ---------------------------------------------------------------------------

type CatalogState = {
  bars: Bar[];
  byId: Map<string, Bar>;
  maskById: Map<string, bigint>;
};

function buildState(bars: Bar[]): CatalogState {
  return {
    bars,
    byId: new Map(bars.map((b) => [b.id, b])),
    maskById: new Map(bars.map((b) => [b.id, tagsToMask(b.tags)])),
  };
}

let state: CatalogState = buildState(staticBars);
const listeners = new Set<() => void>();

/**
 * The catalog, async from day one. Resolves instantly from the module
 * cache today; when the server-backed catalog lands, this becomes the
 * fetch-with-static-fallback seam (see docs/BARS-TABLE-SCHEMA.md).
 */
export function getBars(): Promise<Bar[]> {
  return Promise.resolve(state.bars);
}

/**
 * Synchronous snapshot of the catalog for non-React lib code that can't
 * await (and for tests). UI code should prefer `useBars()`.
 */
export function getBarsSnapshot(): Bar[] {
  return state.bars;
}

/** Map-backed id lookup — O(1), replaces ad-hoc `bars.find(...)` sites. */
export function getBarById(id: string): Bar | undefined {
  return state.byId.get(id);
}

/**
 * Precomputed tag bitmask for a bar (undefined for unknown ids). Computed
 * once at module load / catalog replace, not per call.
 */
export function getTagMask(barId: string): bigint | undefined {
  return state.maskById.get(barId);
}

/**
 * Subscription point for the client hook (src/lib/useBars.ts). Exported
 * rather than hook-local because THIS module must stay React-free: it is
 * imported by server components (share page, edge OG image), and Next 14's
 * RSC compiler rejects `useSyncExternalStore` in a server module — a real
 * production-build failure Codex review caught (vitest/tsc cannot see it).
 */
export function subscribeCatalog(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Swap in a new catalog and notify every `useBars` subscriber. Today this
 * is exercised only by tests; it is the seam the server-backed refresh
 * will call after fetching the `bars` table. Builds a fresh state object
 * (indexes + masks) rather than mutating the old one.
 *
 * SWAP-DAY CHECKLIST (Opus + Codex reviews): only `useBars()` subscribers
 * re-render on a live swap. Non-reactive `getBarById` readers will show
 * stale bar objects until their own deps change — RatingControl (deps
 * [promptForThisBar]), rankings/page (deps [ratings]), and demo/index's
 * `barById` (feeds FriendCard etc.). Give each a `useBars()` subscription
 * when wiring the live refresh. ALSO: server routes (share page, OG image)
 * never call async `getBars()` — the swap step must add an awaited server
 * accessor there, and client replacement must be deferred until after
 * hydration or SSR/browser snapshots can mismatch. Details in
 * docs/BARS-TABLE-SCHEMA.md §swap plan.
 */
export function replaceCatalog(next: Bar[]): void {
  state = buildState(next);
  for (const listener of listeners) listener();
}
