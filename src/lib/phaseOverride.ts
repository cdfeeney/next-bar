import { nycNightKey } from '@/lib/nightKey';
import { NIGHT_PHASES, type NightPhase } from '@/lib/nightPhase';

/**
 * phaseOverride — the user's explicit home-phase choice, remembered for
 * THE NIGHT (E2.4/E3.4, DESIGN-SYSTEM R10 + R11).
 *
 * Mirrors vibeNightCache: night-scoped by comparison against tonight's
 * nycNightKey (not expiry), so a stale override from last night simply
 * fails the match and reads as null — the derived phase takes over at
 * rollover. The override always wins while it lives (nightPhase.ts
 * checks it first); choosing it is one tap on the header chip.
 */

const STORAGE_KEY = 'next-bar:night-phase-override:v1';

type StoredPhaseOverride = {
  night: string;
  phase: NightPhase;
};

/** Tonight's phase override, or null (none / different night / SSR). */
export function loadPhaseOverride(now: Date = new Date()): NightPhase | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredPhaseOverride;
    if (parsed?.night !== nycNightKey(now)) return null;
    // Membership-validate: a corrupt/unknown phase must never reach the
    // UI switch — it reads as "no override" and the derivation wins.
    if (!NIGHT_PHASES.includes(parsed.phase)) return null;
    return parsed.phase;
  } catch {
    return null; // corrupt storage reads as "no override" — never throws
  }
}

/** Persist the user's phase choice for tonight (called from the chip). */
export function savePhaseOverride(phase: NightPhase, now: Date = new Date()): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ night: nycNightKey(now), phase } satisfies StoredPhaseOverride),
    );
    // Same-tab consumers (WhereNextFlow's planning-gated Send share) listen
    // for storage events, which browsers only fire cross-tab — dispatch a
    // synthetic one (recordVisit precedent; review HIGH: the header chip
    // updated instantly while the cards lagged a full refresh tick).
    window.dispatchEvent(
      new StorageEvent('storage', { key: STORAGE_KEY }),
    );
  } catch {
    // Quota/private-mode failures degrade to "not remembered" — the chip
    // still switched this render; only persistence is lost.
  }
}

/** Test/maintenance escape hatch. */
export function clearPhaseOverride(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
