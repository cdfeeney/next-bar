import { LISTS_KEY, parseBarLists, type BarList } from '@/lib/lists';
import {
  NIGHT_LOG_STORAGE_KEY,
  parseStoredNightLog,
  type StoredNightLog,
} from '@/lib/nightLog';
import {
  NIGHT_ARCHIVE_STORAGE_KEY,
  parseArchivedNights,
  type ArchivedNight,
} from '@/lib/nightArchive';
import {
  SHARED_NIGHTS_STORAGE_KEY,
  parseSharedNightStore,
  type SharedNightStore,
} from '@/lib/sharedNightsLocal';

export const ACCOUNT_CONTENT_OWNER_KEY = 'next-bar:account-content:owner:v1';
export const ACCOUNT_CONTENT_META_KEY = 'next-bar:account-content:meta:v1';

export const ACCOUNT_CONTENT_KEYS = [
  'lists',
  'night_log',
  'night_archive',
  'shared_nights',
] as const;

export type AccountContentKey = (typeof ACCOUNT_CONTENT_KEYS)[number];
export type AccountContentData =
  | BarList[]
  | StoredNightLog
  | ArchivedNight[]
  | SharedNightStore;

export type LocalAccountContent = {
  /** null is a deliberate tombstone; absent means this device never had a value. */
  data: AccountContentData | null;
  clientUpdatedAt: string;
};

export type LocalAccountContentRead =
  | { status: 'absent' }
  | { status: 'invalid' }
  | { status: 'present'; value: LocalAccountContent };

type Meta = Partial<Record<AccountContentKey, string>>;

const STORAGE_KEYS: Record<AccountContentKey, string> = {
  lists: LISTS_KEY,
  night_log: NIGHT_LOG_STORAGE_KEY,
  night_archive: NIGHT_ARCHIVE_STORAGE_KEY,
  shared_nights: SHARED_NIGHTS_STORAGE_KEY,
};

export function parseAccountContentData(
  key: AccountContentKey,
  value: unknown,
): AccountContentData | null {
  switch (key) {
    case 'lists':
      return parseBarLists(value);
    case 'night_log':
      return parseStoredNightLog(value);
    case 'night_archive':
      return parseArchivedNights(value);
    case 'shared_nights':
      return parseSharedNightStore(value);
  }
}

function validIso(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function latest(values: readonly (string | undefined)[]): string | null {
  let best: string | null = null;
  let bestMs = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    if (!validIso(value)) continue;
    const ms = Date.parse(value);
    if (ms > bestMs) {
      best = value;
      bestMs = ms;
    }
  }
  return best;
}

/** Timestamp fallback for data written before account sync existed. */
function deriveUpdatedAt(key: AccountContentKey, data: AccountContentData): string {
  let derived: string | null = null;
  switch (key) {
    case 'lists': {
      const lists = data as BarList[];
      derived = latest(lists.flatMap((list) => [list.updatedAt, list.createdAt]));
      break;
    }
    case 'night_log': {
      const log = data as StoredNightLog;
      derived = latest(log.visits.map((visit) => visit.at));
      break;
    }
    case 'night_archive': {
      const nights = data as ArchivedNight[];
      derived = latest(
        nights.flatMap((night) => [
          ...night.visits.map((visit) => visit.at),
          ...(night.ratings ?? []).map((rating) => rating.ratedAt),
        ]),
      );
      break;
    }
    case 'shared_nights': {
      const shares = data as SharedNightStore;
      derived = latest(Object.values(shares).map((share) => share.sharedAt));
      break;
    }
  }
  // An existing but empty pre-sync store is older than every real synced write,
  // yet can still be inserted when the server has no row.
  return derived ?? new Date(0).toISOString();
}

function readMeta(): Meta {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(ACCOUNT_CONTENT_META_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Meta = {};
    for (const key of ACCOUNT_CONTENT_KEYS) {
      const value = (parsed as Record<string, unknown>)[key];
      if (validIso(value)) out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

function writeMetaExact(key: AccountContentKey, updatedAt: string): boolean {
  if (typeof window === 'undefined' || !validIso(updatedAt)) return false;
  try {
    window.localStorage.setItem(
      ACCOUNT_CONTENT_META_KEY,
      JSON.stringify({ ...readMeta(), [key]: updatedAt }),
    );
    return true;
  } catch {
    return false;
  }
}

export function storageKeyForAccountContent(key: AccountContentKey): string {
  return STORAGE_KEYS[key];
}

export function accountContentKeyForStorageKey(
  storageKey: string | null,
): AccountContentKey | null {
  if (storageKey === null) return null;
  return (
    ACCOUNT_CONTENT_KEYS.find((key) => STORAGE_KEYS[key] === storageKey) ?? null
  );
}

export function readLocalAccountContent(
  key: AccountContentKey,
): LocalAccountContentRead {
  if (typeof window === 'undefined') return { status: 'absent' };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEYS[key]);
    const meta = readMeta()[key];
    if (raw === null) {
      return meta
        ? { status: 'present', value: { data: null, clientUpdatedAt: meta } }
        : { status: 'absent' };
    }
    const data = parseAccountContentData(key, JSON.parse(raw) as unknown);
    if (data === null) return { status: 'invalid' };
    return {
      status: 'present',
      value: { data, clientUpdatedAt: meta ?? deriveUpdatedAt(key, data) },
    };
  } catch {
    return { status: 'invalid' };
  }
}

/** Called by the global listener after one of the existing stores mutates. */
export function stampLocalAccountContent(
  key: AccountContentKey,
  updatedAt = new Date().toISOString(),
): LocalAccountContentRead {
  if (!validIso(updatedAt)) return { status: 'invalid' };
  const previous = readMeta()[key];
  const nextUpdatedAt =
    previous && Date.parse(updatedAt) <= Date.parse(previous)
      ? new Date(Date.parse(previous) + 1).toISOString()
      : updatedAt;
  if (!writeMetaExact(key, nextUpdatedAt)) return { status: 'invalid' };
  return readLocalAccountContent(key);
}

/** Hydrate an authoritative server value without bypassing local validation. */
export function writeLocalAccountContent(
  key: AccountContentKey,
  value: LocalAccountContent,
): boolean {
  if (typeof window === 'undefined' || !validIso(value.clientUpdatedAt)) return false;
  if (value.data !== null && parseAccountContentData(key, value.data) === null) return false;
  try {
    if (value.data === null) {
      window.localStorage.removeItem(STORAGE_KEYS[key]);
    } else {
      window.localStorage.setItem(STORAGE_KEYS[key], JSON.stringify(value.data));
    }
    // Hydration preserves the authoritative server clock exactly. Only local
    // mutations use the monotonic +1ms tie-break in stampLocalAccountContent.
    if (!writeMetaExact(key, value.clientUpdatedAt)) return false;
    try {
      window.dispatchEvent(new StorageEvent('storage', { key: STORAGE_KEYS[key] }));
    } catch {
      window.dispatchEvent(new Event('storage'));
    }
    return true;
  } catch {
    return false;
  }
}

export function readAccountContentOwner(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(ACCOUNT_CONTENT_OWNER_KEY);
  } catch {
    return null;
  }
}

export function writeAccountContentOwner(userId: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(ACCOUNT_CONTENT_OWNER_KEY, userId);
  } catch {
    // The foreign-cache guard remains the backstop on the next sign-in.
  }
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => [key, canonical(child)]),
    );
  }
  return value;
}

export function sameAccountContentData(a: unknown, b: unknown): boolean {
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}
