import type { SavedBar } from '@/types/saved';

const KEY = 'next-bar:saved:v1';

function isSavedBar(value: unknown): value is SavedBar {
  if (value === null || typeof value !== 'object') return false;
  const obj = value as Record<string, unknown>;
  return typeof obj.barId === 'string' && typeof obj.savedAt === 'string';
}

function isSavedBarArray(value: unknown): value is SavedBar[] {
  return Array.isArray(value) && value.every(isSavedBar);
}

function notifyChange(): void {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(new StorageEvent('storage', { key: KEY }));
  } catch {
    // Ignore — some environments may not support StorageEvent constructor.
  }
}

function writeAll(items: SavedBar[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(items));
  } catch {
    // Ignore quota / private-mode errors silently.
  }
}

export function loadSaved(): SavedBar[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!isSavedBarArray(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
}

export function isSaved(barId: string): boolean {
  return loadSaved().some((s) => s.barId === barId);
}

export function setSaved(barId: string, saved: boolean): void {
  if (typeof window === 'undefined') return;
  const current = loadSaved();
  if (saved) {
    // Idempotent: if already saved, do nothing.
    if (current.some((s) => s.barId === barId)) return;
    const next: SavedBar = {
      barId,
      savedAt: new Date().toISOString(),
    };
    const updated = [...current, next];
    writeAll(updated);
    notifyChange();
    return;
  }
  // saved === false: remove if present, no-op otherwise.
  const updated = current.filter((s) => s.barId !== barId);
  if (updated.length === current.length) return;
  writeAll(updated);
  notifyChange();
}

export function toggleSaved(barId: string): boolean {
  const nowSaved = !isSaved(barId);
  setSaved(barId, nowSaved);
  return nowSaved;
}

export function sortSavedByRecency(items: SavedBar[]): SavedBar[] {
  return [...items].sort((a, b) => {
    // More recent first — descending by savedAt
    if (a.savedAt < b.savedAt) return 1;
    if (a.savedAt > b.savedAt) return -1;
    return 0;
  });
}
