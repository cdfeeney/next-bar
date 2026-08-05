import { nycNightKey } from '@/lib/nightKey';
import { archiveNight } from '@/lib/nightArchive';
import { loadRatings } from '@/lib/ratings';
import type { BarRating } from '@/types/ratings';

/**
 * nightLog — the LOCAL-FIRST Night object (E4.1, epic g-db540bdb Q1
 * decision: local-first now; server persistence arrives with the public
 * night page, E4.4).
 *
 * The log never asks the user anything: picking "the bar you're at" on
 * the home flow IS the visit signal, so a night assembles itself from
 * data the app already captures — visits in order (this file), that
 * night's ratings (ratedAt), nothing else. Friends/votes stay
 * server-side and join the record in the E4.4 slice.
 *
 * Storage mirrors vibeNightCache: one localStorage key, night-scoped by
 * COMPARISON against nycNightKey (6am NYC rollover), not expiry — a
 * stale log fails tonight's match and reads as empty, and yesterday's
 * log stays readable all of today for the recap surface (E4.2/E4.5)
 * because writing tonight's first visit is what replaces it.
 */

/** Exported so storage-event consumers can filter by key (house pattern). */
export const NIGHT_LOG_STORAGE_KEY = 'next-bar:night-log:v1';
const STORAGE_KEY = NIGHT_LOG_STORAGE_KEY;

/** Degenerate-night guard: nobody legitimately hits 20 bars; beyond it
 *  new visits are ignored rather than evicting the route's start. */
const MAX_VISITS_PER_NIGHT = 20;

export type NightVisit = {
  barId: string;
  /** ISO timestamp of the pick. */
  at: string;
};

type StoredNightLog = {
  night: string;
  visits: NightVisit[];
};

/** E4.1 minimum Night object (local slice — friends/votes are E4.4). */
export type NightRecord = {
  nightKey: string;
  visits: NightVisit[];
  /** Ratings whose ratedAt falls inside this night. */
  ratings: BarRating[];
};

function isNightVisit(value: unknown): value is NightVisit {
  if (value === null || typeof value !== 'object') return false;
  const obj = value as Record<string, unknown>;
  return typeof obj.barId === 'string' && typeof obj.at === 'string';
}

function readLog(): StoredNightLog | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredNightLog;
    if (typeof parsed?.night !== 'string') return null;
    if (!Array.isArray(parsed.visits)) return null;
    return { night: parsed.night, visits: parsed.visits.filter(isNightVisit) };
  } catch {
    return null; // corrupt storage reads as "no log" — never throws
  }
}

function writeLog(log: StoredNightLog): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(log));
  } catch {
    // Quota/private-mode failures degrade to "not recorded" — the night
    // just has a thinner record, which is the pre-E4 behavior.
  }
}

// Native storage events only fire cross-tab; same-tab consumers (E3.1's
// exclusion set) need the manual dispatch — same pattern as intent.ts.
function notifyChange(): void {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(new StorageEvent('storage', { key: STORAGE_KEY }));
  } catch {
    // Ignore — some environments may not support the constructor.
  }
}

/**
 * Record "I'm at this bar" for TONIGHT. Called from the home flow's
 * seed-bar entry. Synthetic free-text seeds (`synthetic:` ids) are
 * refused here — one enforcement point — so a made-up spot can never
 * enter the night record or the exclusion set. Consecutive re-searches
 * from the same bar dedup to one visit.
 */
export function recordVisit(barId: string, now: Date = new Date()): void {
  if (typeof window === 'undefined') return;
  if (barId.startsWith('synthetic:')) return;
  const tonight = nycNightKey(now);
  const stored = readLog();
  // First visit of a new night replaces last night's log wholesale — and
  // since g-919dae84 the displaced night is ARCHIVED first, so /nights can
  // show previous nights instead of the app forgetting them. The ratings
  // snapshot rides along (see nightArchive's module doc for why).
  if (stored && stored.night !== tonight && stored.visits.length > 0) {
    archiveNight({
      nightKey: stored.night,
      visits: stored.visits,
      ratings: nightRatings(stored.night),
    });
  }
  const log: StoredNightLog =
    stored && stored.night === tonight ? stored : { night: tonight, visits: [] };
  const last = log.visits[log.visits.length - 1];
  if (last && last.barId === barId) return;
  if (log.visits.length >= MAX_VISITS_PER_NIGHT) return;
  writeLog({
    night: log.night,
    visits: [...log.visits, { barId, at: now.toISOString() }],
  });
  notifyChange();
}

/** The visit list for a night, oldest first ([] for any other night). */
export function loadNightVisits(nightKey: string): NightVisit[] {
  const stored = readLog();
  if (!stored || stored.night !== nightKey) return [];
  return stored.visits;
}

/**
 * The LIVE log as-is — whichever night it currently holds, or null.
 * /nights (g-919dae84) merges this with the archive so tonight/last night
 * appears in history before the rollover archives it.
 */
export function loadCurrentLog(): {
  nightKey: string;
  visits: NightVisit[];
} | null {
  const stored = readLog();
  if (!stored || stored.visits.length === 0) return null;
  return { nightKey: stored.night, visits: stored.visits };
}

/**
 * Every rating made during a night (ratedAt falls inside it). THE join
 * rule for night↔ratings — archived nights (which store visits only)
 * reuse it so a later re-rating is reflected, never contradicted by a
 * stale copy.
 */
export function nightRatings(nightKey: string): BarRating[] {
  return loadRatings().filter((r) => {
    const rated = new Date(r.ratedAt);
    return !Number.isNaN(rated.getTime()) && nycNightKey(rated) === nightKey;
  });
}

/**
 * Assemble the Night object for a nightKey: ordered visits from the log
 * plus every rating made during that night. Pure read — safe for both
 * tonight (E3.1 exclusion) and yesterday (E4.2 recap, until tonight's
 * first visit replaces the stored log).
 */
export function assembleNight(nightKey: string): NightRecord {
  return { nightKey, visits: loadNightVisits(nightKey), ratings: nightRatings(nightKey) };
}

/**
 * The nightKey of LAST night relative to `now` — pure Date.UTC calendar
 * math on the current key (nycNightKey is already rollover- and
 * DST-safe). The morning-after recap (E4.2) reads this night.
 */
export function lastNightKey(now: Date = new Date()): string {
  const [y, m, d] = nycNightKey(now).split('-').map(Number);
  const prev = new Date(Date.UTC(y, m - 1, d - 1));
  const py = prev.getUTCFullYear();
  const pm = String(prev.getUTCMonth() + 1).padStart(2, '0');
  const pd = String(prev.getUTCDate()).padStart(2, '0');
  return `${py}-${pm}-${pd}`;
}

/** Test/maintenance escape hatch. */
export function clearNightLog(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
  notifyChange();
}
