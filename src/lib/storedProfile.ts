import type { ManhattanNeighborhood, VibeProfile, VibeTag } from '@/types';

const KEY = 'next-bar:profile:v1';

/**
 * Ownership marker for the profile cache (G1).
 *
 * Mirrors the ratings/pairwise `merged-for` flags: it names the account whose
 * data currently sits in `next-bar:profile:v1`. Registered in
 * accountCache.ALL_KEYS, per the B3 blueprint rule that a surface becoming
 * server-synced must join the cross-account guard or the guard silently
 * skips it.
 */
export const PROFILE_KEY = KEY;
export const PROFILE_MERGED_KEY = 'next-bar:profile:merged-for:v1';

export type StoredProfile = VibeProfile & { savedAt: string };

function isVibeTagArray(value: unknown): value is VibeTag[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

function isNeighborhoodArray(value: unknown): value is ManhattanNeighborhood[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

/**
 * Validate an unknown value as a StoredProfile, or return null.
 *
 * Extracted so the SERVER row and the localStorage row go through exactly one
 * validator — a row written by a different client version must not be able to
 * enter the app unvalidated just because it arrived over the network.
 */
export function parseVibeProfile(value: unknown): StoredProfile | null {
  if (typeof value !== 'object' || value === null) return null;
  const parsed = value as Partial<StoredProfile>;
  if (
    !isVibeTagArray(parsed.tags) ||
    !isNeighborhoodArray(parsed.preferredNeighborhoods) ||
    typeof parsed.archetype !== 'string' ||
    typeof parsed.savedAt !== 'string'
  ) {
    return null;
  }
  // Reject an unparseable timestamp: savedAt is the conflict-resolution key,
  // so a NaN date would make the comparison in vibeProfileSync meaningless.
  if (Number.isNaN(Date.parse(parsed.savedAt))) return null;
  return {
    tags: parsed.tags,
    preferredNeighborhoods: parsed.preferredNeighborhoods,
    archetype: parsed.archetype,
    savedAt: parsed.savedAt,
  };
}

export function loadProfile(): StoredProfile | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    return parseVibeProfile(JSON.parse(raw));
  } catch {
    return null;
  }
}

/**
 * Tell same-document consumers the profile changed.
 *
 * `localStorage.setItem`/`removeItem` fire a `storage` event only in OTHER
 * documents, never in the one that wrote. Ten places in this app already
 * subscribe with `window.addEventListener('storage', …)` — including
 * WhereNextFlow's `syncProfile`, whose own comment says a cleared profile
 * "must also clear the Tweak-the-vibe pre-fill". Without a synthetic event
 * that intent silently fails in-document, which is how account A's vibe tags
 * could stay rendered for account B after `guardAgainstForeignCache` wiped
 * storage on an account switch. Dispatching the real event type means the
 * existing subscribers need no changes.
 */
export function notifyProfileChanged(): void {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(new StorageEvent('storage', { key: KEY }));
  } catch {
    // Older engines reject the StorageEvent constructor — fall back to a
    // plain Event, which still triggers every 'storage' listener.
    try {
      window.dispatchEvent(new Event('storage'));
    } catch {
      // Non-fatal: consumers refresh on their next mount.
    }
  }
}

/** Write a profile through verbatim, PRESERVING its savedAt. */
export function writeProfile(profile: StoredProfile): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(profile));
  } catch {
    // Ignore quota / private-mode errors silently.
  }
  notifyProfileChanged();
}

/** The account whose data is in the profile cache, or null if anonymous. */
export function readProfileOwner(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(PROFILE_MERGED_KEY);
  } catch {
    return null;
  }
}

export function writeProfileOwner(userId: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(PROFILE_MERGED_KEY, userId);
  } catch {
    // Ignore.
  }
}

/**
 * Save a freshly-derived profile, stamping savedAt = now.
 *
 * Returns the stored shape so a caller that also needs to push it server-side
 * pushes the SAME savedAt that landed in localStorage. Re-stamping the
 * timestamp at the network layer would make local and server disagree about
 * which write is newer, breaking the conflict rule.
 */
export function saveProfile(profile: VibeProfile): StoredProfile {
  const stored: StoredProfile = { ...profile, savedAt: new Date().toISOString() };
  writeProfile(stored);
  return stored;
}

export function clearProfile(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(KEY);
    // Clear the ownership marker too. Leaving it behind would name an account
    // that has no data here, and the cross-account guard would then wipe the
    // ratings/pairwise cache on the next sign-in for no reason.
    window.localStorage.removeItem(PROFILE_MERGED_KEY);
  } catch {
    // Ignore.
  }
  notifyProfileChanged();
}
