/**
 * "Want to go" list (QA5-S2) — new bars you're saving for later, surfaced
 * as a tab on /rankings.
 *
 * Distinct from src/lib/lists.ts (user-NAMED lists, `next-bar:lists:v1`):
 * this is ONE fixed list with a FIXED storage contract:
 *
 * WRITER COUNT, 2026-07-31 (goal g-12d33864): there is now exactly ZERO
 * production writer. This comment used to say "another slice (/discover)
 * writes the same key, so the shape below must not change without coordinating
 * both slices" — that coordination invariant is gone, because /discover was
 * archived and its swipe surface held the ONLY `addWantToGo` call site in the
 * app (`9dfe8f2:src/app/discover/page.tsx:230`). `useWantToGo().add` is
 * exported but currently invoked by nothing, so the list can only shrink.
 * Do not read the surviving machinery as evidence that a second writer exists.
 * See the operator question recorded on goal g-12d33864.
 *
 *   key:   next-bar:list:want-to-go:v1
 *   value: JSON array of { barId: string, addedAt: string (ISO) }
 *
 * Mirrors src/lib/intent.ts: SSR-safe guards, corrupt-safe reads, silent
 * quota-safe writes, and a synthesized `storage` event (notifyChange) so
 * every mounted useWantToGo consumer refreshes on any write.
 *
 * Reads are salvaging, not all-or-nothing: because another slice shares
 * the key, a single malformed entry drops only that entry (and dupes by
 * barId keep the first occurrence) instead of nuking the whole list.
 */

export type WantToGoEntry = {
  barId: string;
  addedAt: string; // ISO timestamp
};

export const WANT_TO_GO_KEY = 'next-bar:list:want-to-go:v1';

function isWantToGoEntry(value: unknown): value is WantToGoEntry {
  if (value === null || typeof value !== 'object') return false;
  const obj = value as Record<string, unknown>;
  return typeof obj.barId === 'string' && typeof obj.addedAt === 'string';
}

function notifyChange(): void {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(new StorageEvent('storage', { key: WANT_TO_GO_KEY }));
  } catch {
    // Ignore — some environments may not support StorageEvent constructor.
  }
}

function writeAll(entries: WantToGoEntry[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(WANT_TO_GO_KEY, JSON.stringify(entries));
  } catch {
    // Ignore quota / private-mode errors silently.
  }
}

/**
 * The saved list, oldest-first. Corrupt storage reads as []; individually
 * malformed entries are dropped and barId dupes collapse to the first.
 */
export function loadWantToGo(): WantToGoEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(WANT_TO_GO_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    const entries: WantToGoEntry[] = [];
    for (const item of parsed) {
      if (!isWantToGoEntry(item)) continue;
      if (seen.has(item.barId)) continue;
      seen.add(item.barId);
      entries.push({ barId: item.barId, addedAt: item.addedAt });
    }
    return entries;
  } catch {
    return [];
  }
}

/** Save a bar for later. Already-saved bars are a no-op (dedup by barId). */
export function addWantToGo(barId: string): void {
  if (typeof window === 'undefined') return;
  const current = loadWantToGo();
  if (current.some((e) => e.barId === barId)) return;
  writeAll([...current, { barId, addedAt: new Date().toISOString() }]);
  notifyChange();
}

export function removeWantToGo(barId: string): void {
  if (typeof window === 'undefined') return;
  const current = loadWantToGo();
  const updated = current.filter((e) => e.barId !== barId);
  if (updated.length === current.length) return;
  writeAll(updated);
  notifyChange();
}

/**
 * Drop every entry whose bar has since been rated ("Been — rank it"
 * auto-cleanup): one write, one notify. No-op when nothing matches.
 */
export function pruneWantToGo(ratedBarIds: ReadonlySet<string>): void {
  if (typeof window === 'undefined') return;
  const current = loadWantToGo();
  const updated = current.filter((e) => !ratedBarIds.has(e.barId));
  if (updated.length === current.length) return;
  writeAll(updated);
  notifyChange();
}
