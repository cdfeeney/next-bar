/**
 * "Want to go" — the fixed save-for-later list, now a FACADE over the
 * Lists model (goal g-ac3a291c crit 4): the saves live in the reserved
 * 'want-to-go' list inside `next-bar:lists:v1`, so Rankings' list
 * switcher, /lists, and the rating flow all see one model.
 *
 * The public API is byte-compatible with the old fixed-key store —
 * WantToGoToggle (map detail, Next Bar result, /search rows/lightbox) and
 * useWantToGo keep working untouched — except WantToGoEntry no longer
 * carries `addedAt` (nothing ever rendered it; order in the list IS the
 * oldest-first order).
 *
 * LEGACY FOLD: the old key (`next-bar:list:want-to-go:v1`, array of
 * {barId, addedAt}) folds into the reserved list exactly once, salvaging
 * what a partially-corrupt array allows (same tolerant read as before)
 * and never losing a save. The key is then removed. Every public entry
 * point folds first, so the migration needs no boot hook and is
 * idempotent.
 *
 * EVENTS: mutations dispatch BOTH the lists key (via lists.ts) and the
 * legacy want-to-go key, so old consumers keyed on either refresh.
 */

import {
  deleteList,
  foldIntoList,
  loadLists,
  pruneBarsFromList,
  removeBarFromList,
} from '@/lib/lists';

export type WantToGoEntry = {
  barId: string;
};

export const WANT_TO_GO_KEY = 'next-bar:list:want-to-go:v1';
export const WANT_TO_GO_LIST_ID = 'want-to-go';
const WANT_TO_GO_NAME = 'Want to go';

function notifyChange(): void {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(new StorageEvent('storage', { key: WANT_TO_GO_KEY }));
  } catch {
    // Ignore — some environments may not support StorageEvent constructor.
  }
}

/** Tolerant legacy read: corrupt shells → [], malformed entries dropped, dupes collapse. */
function readLegacy(): string[] {
  try {
    const raw = window.localStorage.getItem(WANT_TO_GO_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    const barIds: string[] = [];
    for (const item of parsed) {
      if (item === null || typeof item !== 'object') continue;
      const barId = (item as Record<string, unknown>).barId;
      if (typeof barId !== 'string' || seen.has(barId)) continue;
      seen.add(barId);
      barIds.push(barId);
    }
    return barIds;
  } catch {
    return [];
  }
}

/**
 * Fold the legacy store into the reserved list, once. Idempotent: after
 * the fold the key is gone and this is a single getItem miss.
 *
 * LOSSLESS UNDER QUOTA FAILURE (santa: DeepSeek-lens, g-ac3a291c): the
 * lists write is a silent no-op when localStorage is full, and removing
 * the legacy key after a failed write would DESTROY the saves. So the key
 * is only removed once the reserved list verifiably contains every
 * legacy id — otherwise it stays and the fold retries on the next call.
 */
function foldLegacy(): void {
  if (typeof window === 'undefined') return;
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(WANT_TO_GO_KEY);
  } catch {
    return;
  }
  if (raw === null) return;
  const barIds = readLegacy();
  if (barIds.length > 0) {
    foldIntoList(WANT_TO_GO_LIST_ID, WANT_TO_GO_NAME, barIds);
    // Verify the fold actually landed before destroying the source.
    const folded = loadLists().find((l) => l.id === WANT_TO_GO_LIST_ID);
    const have = new Set(folded?.barIds ?? []);
    if (!barIds.every((b) => have.has(b))) return;
  }
  try {
    window.localStorage.removeItem(WANT_TO_GO_KEY);
  } catch {
    // removeItem cannot hit quota; belt-and-braces for exotic embedders —
    // the fold simply retries next call.
  }
  notifyChange();
}

/**
 * The saved list, oldest-first. Corrupt storage reads as [].
 *
 * NOT a pure read (santa: Claude): the first call after an app upgrade
 * runs the legacy fold above, which can WRITE localStorage and dispatch
 * storage events synchronously. Call it from effects/handlers — never
 * from a render body or useMemo.
 */
export function loadWantToGo(): WantToGoEntry[] {
  if (typeof window === 'undefined') return [];
  foldLegacy();
  const list = loadLists().find((l) => l.id === WANT_TO_GO_LIST_ID);
  if (!list) return [];
  return list.barIds.map((barId) => ({ barId }));
}

/** Save a bar for later. Already-saved bars are a true no-op (no write, no event). */
export function addWantToGo(barId: string): void {
  if (typeof window === 'undefined') return;
  foldLegacy();
  if (foldIntoList(WANT_TO_GO_LIST_ID, WANT_TO_GO_NAME, [barId])) {
    notifyChange();
  }
}

export function removeWantToGo(barId: string): void {
  if (typeof window === 'undefined') return;
  foldLegacy();
  if (removeBarFromList(WANT_TO_GO_LIST_ID, barId)) notifyChange();
}

/**
 * Drop every entry whose bar has since been rated ("Been — rank it"
 * auto-cleanup): one write, one notify. True no-op when nothing matches.
 */
export function pruneWantToGo(ratedBarIds: ReadonlySet<string>): void {
  if (typeof window === 'undefined') return;
  foldLegacy();
  if (pruneBarsFromList(WANT_TO_GO_LIST_ID, ratedBarIds)) notifyChange();
}

/**
 * Run the legacy fold without reading anything back. Surfaces that read
 * the LISTS store directly (useLists → /lists, the rankings switcher,
 * the rating-sheet checkmarks) call this first so an upgraded device
 * shows its Want-to-go saves everywhere, not only after a want-to-go
 * surface happened to mount (santa: Codex, g-ac3a291c).
 */
export function ensureWantToGoFolded(): void {
  if (typeof window === 'undefined') return;
  foldLegacy();
}

/**
 * Delete EVERYTHING want-to-go: the reserved list AND any un-folded
 * legacy key (santa: GLM — deleting the list on /lists before the fold
 * ever ran would otherwise resurrect the legacy saves on the next
 * toggle, silently undoing the user's delete).
 */
export function purgeWantToGo(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(WANT_TO_GO_KEY);
  } catch {
    // nothing sensible left to do
  }
  deleteList(WANT_TO_GO_LIST_ID);
  notifyChange();
}
