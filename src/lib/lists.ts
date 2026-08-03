/**
 * User-curated bar lists ("Top 10 date bars", "Rooftops") — blueprint A3,
 * the Letterboxd-core mechanic.
 *
 * localStorage-backed, mirroring src/lib/ratings.ts exactly: validated
 * reads (corrupt data degrades to []), silent quota-safe writes, and a
 * synthesized `storage` event so every mounted useLists consumer refreshes.
 * Local-only for now — server sync joins the D1 Supabase pass alongside
 * ratings.
 */

export type BarList = {
  id: string;
  name: string;
  /** Ordered, deduped bar ids referencing src/lib/bars.ts. */
  barIds: string[];
  createdAt: string; // ISO timestamp
  updatedAt: string; // ISO timestamp
};

/**
 * Exported (santa: Claude, g-ac3a291c): three files listen on this key
 * (useLists, useWantToGo, this store) — re-typed literals would let a
 * rename silently detach a listener.
 */
export const LISTS_KEY = 'next-bar:lists:v1';
const KEY = LISTS_KEY;

function isBarList(value: unknown): value is BarList {
  if (value === null || typeof value !== 'object') return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.id === 'string' &&
    typeof obj.name === 'string' &&
    Array.isArray(obj.barIds) &&
    obj.barIds.every((b) => typeof b === 'string') &&
    typeof obj.createdAt === 'string' &&
    typeof obj.updatedAt === 'string'
  );
}

function isBarListArray(value: unknown): value is BarList[] {
  return Array.isArray(value) && value.every(isBarList);
}

function notifyChange(): void {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(new StorageEvent('storage', { key: KEY }));
  } catch {
    // Ignore — some environments may not support StorageEvent constructor.
  }
}

/**
 * Returns whether the write actually landed (santa: Codex, g-ac3a291c):
 * under quota failure a caller that notified anyway would tell every
 * listener "something changed" when nothing did — and the want-to-go
 * fold's listener chain turned that into synchronous unbounded
 * recursion (event → load → fold retry → event …).
 */
function writeAll(items: BarList[]): boolean {
  if (typeof window === 'undefined') return false;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(items));
    return true;
  } catch {
    // Quota / private-mode — nothing was written.
    return false;
  }
}

function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `list-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function loadLists(): BarList[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!isBarListArray(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
}

/** Create a named list. Name is trimmed; empty names return null. */
export function createList(name: string): BarList | null {
  if (typeof window === 'undefined') return null;
  const trimmed = name.trim();
  if (!trimmed) return null;
  const now = new Date().toISOString();
  const list: BarList = {
    id: newId(),
    name: trimmed,
    barIds: [],
    createdAt: now,
    updatedAt: now,
  };
  if (!writeAll([...loadLists(), list])) return null;
  notifyChange();
  return list;
}

export function deleteList(id: string): void {
  if (typeof window === 'undefined') return;
  const current = loadLists();
  const updated = current.filter((l) => l.id !== id);
  if (updated.length === current.length) return;
  if (!writeAll(updated)) return;
  notifyChange();
}

function updateList(
  id: string,
  update: (list: BarList) => BarList,
): boolean {
  if (typeof window === 'undefined') return false;
  const current = loadLists();
  let changed = false;
  const updated = current.map((l) => {
    if (l.id !== id) return l;
    const next = update(l);
    changed = next !== l;
    return next;
  });
  if (!changed) return false;
  if (!writeAll(updated)) return false;
  notifyChange();
  return true;
}

/**
 * Find-or-create a list with a FIXED id and append any missing bars in one
 * write (g-ac3a291c): the reserved Want-to-go list folds its legacy store
 * in through this, and per-bar appends would have meant N writes and N
 * storage events for one migration.
 */
export function foldIntoList(
  id: string,
  name: string,
  barIds: readonly string[],
): boolean {
  if (typeof window === 'undefined') return false;
  const current = loadLists();
  const now = new Date().toISOString();
  const existing = current.find((l) => l.id === id);
  if (!existing) {
    const wrote = writeAll([
      ...current,
      { id, name, barIds: [...new Set(barIds)], createdAt: now, updatedAt: now },
    ]);
    if (!wrote) return false;
    notifyChange();
    return true;
  }
  const have = new Set(existing.barIds);
  const missing = barIds.filter((b) => {
    if (have.has(b)) return false;
    have.add(b);
    return true;
  });
  if (missing.length === 0) return false;
  const wrote = writeAll(
    current.map((l) =>
      l.id === id
        ? { ...l, barIds: [...l.barIds, ...missing], updatedAt: now }
        : l,
    ),
  );
  if (!wrote) return false;
  notifyChange();
  return true;
}

/** Drop every listed bar from a list in one write. No-op when none match. */
export function pruneBarsFromList(
  id: string,
  barIds: ReadonlySet<string>,
): boolean {
  return updateList(id, (list) => {
    const kept = list.barIds.filter((b) => !barIds.has(b));
    if (kept.length === list.barIds.length) return list;
    return { ...list, barIds: kept, updatedAt: new Date().toISOString() };
  });
}

/** Append a bar to a list (no duplicates). Unknown list ids are no-ops. */
export function addBarToList(id: string, barId: string): boolean {
  return updateList(id, (list) => {
    if (list.barIds.includes(barId)) return list;
    return {
      ...list,
      barIds: [...list.barIds, barId],
      updatedAt: new Date().toISOString(),
    };
  });
}

export function removeBarFromList(id: string, barId: string): boolean {
  return updateList(id, (list) => {
    if (!list.barIds.includes(barId)) return list;
    return {
      ...list,
      barIds: list.barIds.filter((b) => b !== barId),
      updatedAt: new Date().toISOString(),
    };
  });
}
