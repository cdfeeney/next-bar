import type { NightVisit } from '@/lib/nightLog';
import type { BarRating } from '@/types/ratings';
import {
  accountContentReadAllowed,
  accountContentWriteAllowed,
} from '@/lib/accountContent.readGuard';

/**
 * nightArchive — the persistent history behind /nights (goal g-919dae84).
 *
 * nightLog deliberately holds ONE night and lets tonight's first visit
 * replace it; before this module that replacement DISCARDED the old night,
 * so the app could never show "your previous nights". The archive is where
 * the displaced night lands instead: nightLog calls archiveNight() at the
 * rollover boundary (its one writer besides tests), and /nights reads it.
 *
 * Private and owner-scoped by design — nights never become public unless
 * their owner explicitly shares one (share_night RPC). Signed-in archives are
 * durably mirrored through AccountContentSync and remain protected by RLS.
 * REGISTERED in the accountCache wipe set: sign-out /
 * account-switch forgets the device's night history rather than showing
 * two months of one account's whereabouts to the next — the same trade
 * the vibe profile made. Anonymous data survives a FIRST sign-in (the
 * guard only wipes caches owned by a different account).
 *
 * Each entry SNAPSHOTS the night's ratings at rollover time (santa: GLM,
 * bf5d7f4f panel). The live ratings store is mutable — a later re-rating
 * moves ratedAt, so a date re-join months later would silently change or
 * lose an archived night's "loved" pick. The snapshot pins what the night
 * looked like the morning after; the CURRENT night (still in nightLog)
 * keeps joining live ratings, which is the behavior recap always had.
 */

/** Exported so storage-event consumers can filter by key (house pattern). */
export const NIGHT_ARCHIVE_STORAGE_KEY = 'next-bar:night-archive:v1';

/** ~2 months of going out; beyond it the oldest nights fall off. */
export const MAX_ARCHIVED_NIGHTS = 60;

export type ArchivedNight = {
  nightKey: string;
  visits: NightVisit[];
  /** Ratings snapshot taken at archive time (see module doc). Absent on
   *  entries written before the snapshot existed — consumers fall back to
   *  the live date-join then. */
  ratings?: BarRating[];
};

function isVisit(value: unknown): value is NightVisit {
  if (value === null || typeof value !== 'object') return false;
  const obj = value as Record<string, unknown>;
  return typeof obj.barId === 'string' && typeof obj.at === 'string';
}

function isRating(value: unknown): value is BarRating {
  if (value === null || typeof value !== 'object') return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.barId === 'string' &&
    (obj.rating === 'loved' || obj.rating === 'liked' || obj.rating === 'pass') &&
    typeof obj.ratedAt === 'string'
  );
}

function isArchivedNight(value: unknown): value is ArchivedNight {
  if (value === null || typeof value !== 'object') return false;
  const obj = value as Record<string, unknown>;
  return typeof obj.nightKey === 'string' && Array.isArray(obj.visits);
}

/** Shared validator for localStorage and the account-sync boundary. */
export function parseArchivedNights(value: unknown): ArchivedNight[] | null {
  if (!Array.isArray(value)) return null;
  return value.filter(isArchivedNight).map((n) => ({
    nightKey: n.nightKey,
    visits: n.visits.filter(isVisit),
    ...(Array.isArray(n.ratings)
      ? { ratings: n.ratings.filter(isRating) }
      : {}),
  }));
}

function read(): ArchivedNight[] {
  if (typeof window === 'undefined') return [];
  // Readiness barrier (v2.1): unresolved/foreign state reads as empty.
  if (!accountContentReadAllowed()) return [];
  try {
    const raw = window.localStorage.getItem(NIGHT_ARCHIVE_STORAGE_KEY);
    if (!raw) return [];
    return parseArchivedNights(JSON.parse(raw) as unknown) ?? [];
  } catch {
    return []; // corrupt storage reads as empty — never throws
  }
}

/** True only when the write actually landed — callers notify on that,
 *  never on a refused/failed write (same convention as lists.writeAll). */
function write(nights: ArchivedNight[]): boolean {
  if (typeof window === 'undefined') return false;
  // Write barrier (v2.1): unresolved ownership → never overwrite residue.
  if (!accountContentWriteAllowed()) return false;
  try {
    window.localStorage.setItem(
      NIGHT_ARCHIVE_STORAGE_KEY,
      JSON.stringify(nights),
    );
    return true;
  } catch {
    // Quota/private-mode failures degrade to "history is thinner" — same
    // stance as nightLog's writeLog.
    return false;
  }
}

function notifyChange(): void {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(
      new StorageEvent('storage', { key: NIGHT_ARCHIVE_STORAGE_KEY }),
    );
  } catch {
    // Ignore — some environments may not support the constructor.
  }
}

/**
 * Add (or replace — one entry per nightKey) a night. Empty nights are
 * refused: an entry with no visits renders as a blank row and means the
 * caller archived a log that never existed. Returns whether the entry
 * provably landed — rollover callers must not discard their copy otherwise.
 */
export function archiveNight(night: ArchivedNight): boolean {
  if (night.visits.length === 0) return false;
  const rest = read().filter((n) => n.nightKey !== night.nightKey);
  const entry: ArchivedNight = {
    nightKey: night.nightKey,
    visits: night.visits,
    ...(night.ratings ? { ratings: night.ratings } : {}),
  };
  const next = [...rest, entry]
    // Newest first; nightKeys are YYYY-MM-DD so string order is date order.
    .sort((a, b) => b.nightKey.localeCompare(a.nightKey))
    .slice(0, MAX_ARCHIVED_NIGHTS);
  if (!write(next)) return false;
  notifyChange();
  return true;
}

/** All archived nights, newest first. */
export function listArchivedNights(): ArchivedNight[] {
  return read();
}

/** Test/maintenance escape hatch. */
export function clearNightArchive(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(NIGHT_ARCHIVE_STORAGE_KEY);
  } catch {
    /* ignore */
  }
  notifyChange();
}
