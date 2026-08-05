import { isShareToken } from '@/lib/nights.server';

/**
 * sharedNightsLocal — the device's record of WHICH nights this account has
 * shared, keyed nightKey → bearer token (goal g-919dae84).
 *
 * The server deliberately has no "list my shared nights" read (the only
 * anon read is get_shared_night(token), reviewed as an anti-enumeration
 * boundary). Rather than widen that surface with a new RPC/migration, the
 * client records the token share_night RETURNS at the moment of sharing —
 * which is enough for /nights to show "Shared", rebuild the link, and
 * offer unshare, all without touching the DB schema.
 *
 * Account residue: tokens belong to the signed-in account's server rows,
 * so this key IS registered in accountCache's wipe set (same B3 blueprint
 * rule as follows — no merged-for marker, a wipe just forgets the links;
 * the server rows themselves are untouched and re-sharing re-records).
 */

/** Exported for accountCache registration + storage-event filtering. */
export const SHARED_NIGHTS_STORAGE_KEY = 'next-bar:shared-nights:v1';

type SharedNightRecord = {
  token: string;
  sharedAt: string;
};

type Store = Record<string, SharedNightRecord>;

function read(): Store {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(SHARED_NIGHTS_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed))
      return {};
    const store: Store = {};
    for (const [nightKey, rec] of Object.entries(
      parsed as Record<string, unknown>,
    )) {
      if (rec === null || typeof rec !== 'object') continue;
      const token = (rec as Record<string, unknown>).token;
      const sharedAt = (rec as Record<string, unknown>).sharedAt;
      if (typeof token !== 'string' || !isShareToken(token)) continue;
      store[nightKey] = {
        token,
        sharedAt: typeof sharedAt === 'string' ? sharedAt : '',
      };
    }
    return store;
  } catch {
    return {}; // corrupt storage reads as empty — never throws
  }
}

function write(store: Store): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      SHARED_NIGHTS_STORAGE_KEY,
      JSON.stringify(store),
    );
  } catch {
    // Quota/private mode — the night is still shared server-side; the
    // device just can't show it. Re-sharing re-records.
  }
}

function notifyChange(): void {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(
      new StorageEvent('storage', { key: SHARED_NIGHTS_STORAGE_KEY }),
    );
  } catch {
    /* ignore */
  }
}

/** Record the token share_night returned for a night. Non-tokens refused. */
export function recordSharedNight(
  nightKey: string,
  token: string,
  now: Date = new Date(),
): void {
  if (!isShareToken(token)) return;
  const store = read();
  write({
    ...store,
    [nightKey]: { token, sharedAt: now.toISOString() },
  });
  notifyChange();
}

/** The recorded token for a night, or null if it was never shared from
 *  this device (or the record was wiped on account switch). */
export function getSharedNightToken(nightKey: string): string | null {
  return read()[nightKey]?.token ?? null;
}

/** Every recorded share, nightKey → token. /nights uses this to keep a
 *  shared night MANAGEABLE (unshare) even when its bars have left the
 *  catalog and no recap can render (santa: Claude, bf5d7f4f panel). */
export function listSharedNights(): Record<string, string> {
  const store = read();
  const out: Record<string, string> = {};
  for (const [nightKey, rec] of Object.entries(store)) out[nightKey] = rec.token;
  return out;
}

/** Forget a night's share record (after unshare_night succeeds). */
export function forgetSharedNight(nightKey: string): void {
  const store = read();
  if (!(nightKey in store)) return;
  const { [nightKey]: _gone, ...rest } = store;
  write(rest);
  notifyChange();
}
