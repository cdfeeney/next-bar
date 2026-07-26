import { TAG_VOCABULARY } from '@/lib/catalog';
import { nycNightKey } from '@/lib/nightKey';
import type { VibeTag } from '@/types';

/**
 * vibeNightCache — the vibe you picked, remembered for THE NIGHT
 * (E2.2, locked decision 3 / DESIGN-SYSTEM R11).
 *
 * A vibe belongs to the search: applying a tweak on a next-bar search
 * caches the picked tags under tonight's nycNightKey, so same-night
 * re-searches PRE-FILL it instead of re-asking. It never locks — the
 * tweak surface always allows changing it, and the rollover silently
 * forgets it (a new night starts clean).
 *
 * Storage is localStorage, single key, night-scoped by comparison (not
 * expiry): a stale entry from last night simply fails the night match
 * and reads as null.
 */

const STORAGE_KEY = 'next-bar:night-vibe:v1';

type StoredNightVibe = {
  night: string;
  tags: VibeTag[];
};

/** Tonight's cached vibe pick, or null (no pick yet / different night / SSR). */
export function loadNightVibe(now: Date = new Date()): VibeTag[] | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredNightVibe;
    if (parsed?.night !== nycNightKey(now)) return null;
    if (!Array.isArray(parsed.tags)) return null;
    // Membership-validate against the canonical vocabulary (review MED):
    // an unknown tag has NO chip in the axis UI, so the user could never
    // see or remove it, and every Apply would re-save it — silent,
    // sticky match-quality corruption. Filtering (not rejecting) keeps
    // the valid remainder of the pick.
    return parsed.tags.filter((t): t is VibeTag =>
      (TAG_VOCABULARY as readonly string[]).includes(t),
    );
  } catch {
    return null; // corrupt storage reads as "no pick" — never throws
  }
}

/** Cache tonight's vibe pick (called when a tweak is APPLIED). */
export function saveNightVibe(tags: VibeTag[], now: Date = new Date()): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ night: nycNightKey(now), tags } satisfies StoredNightVibe),
    );
  } catch {
    // Quota/private-mode failures degrade to "not cached" — the user
    // just gets asked again, which is the pre-cache behavior.
  }
}

/** Test/maintenance escape hatch. */
export function clearNightVibe(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
