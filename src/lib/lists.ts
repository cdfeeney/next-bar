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

const KEY = 'next-bar:lists:v1';

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

function writeAll(items: BarList[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(items));
  } catch {
    // Ignore quota / private-mode errors silently.
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
  writeAll([...loadLists(), list]);
  notifyChange();
  return list;
}

export function deleteList(id: string): void {
  if (typeof window === 'undefined') return;
  const current = loadLists();
  const updated = current.filter((l) => l.id !== id);
  if (updated.length === current.length) return;
  writeAll(updated);
  notifyChange();
}

function updateList(
  id: string,
  update: (list: BarList) => BarList,
): void {
  if (typeof window === 'undefined') return;
  const current = loadLists();
  let changed = false;
  const updated = current.map((l) => {
    if (l.id !== id) return l;
    const next = update(l);
    changed = next !== l;
    return next;
  });
  if (!changed) return;
  writeAll(updated);
  notifyChange();
}

/** Append a bar to a list (no duplicates). Unknown list ids are no-ops. */
export function addBarToList(id: string, barId: string): void {
  updateList(id, (list) => {
    if (list.barIds.includes(barId)) return list;
    return {
      ...list,
      barIds: [...list.barIds, barId],
      updatedAt: new Date().toISOString(),
    };
  });
}

export function removeBarFromList(id: string, barId: string): void {
  updateList(id, (list) => {
    if (!list.barIds.includes(barId)) return list;
    return {
      ...list,
      barIds: list.barIds.filter((b) => b !== barId),
      updatedAt: new Date().toISOString(),
    };
  });
}
