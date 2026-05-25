import type { ManhattanNeighborhood, VibeProfile, VibeTag } from '@/types';

const KEY = 'next-bar:profile:v1';

type StoredProfile = VibeProfile & { savedAt: string };

function isVibeTagArray(value: unknown): value is VibeTag[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

function isNeighborhoodArray(value: unknown): value is ManhattanNeighborhood[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

export function loadProfile(): StoredProfile | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredProfile>;
    if (
      !isVibeTagArray(parsed.tags) ||
      !isNeighborhoodArray(parsed.preferredNeighborhoods) ||
      typeof parsed.archetype !== 'string' ||
      typeof parsed.savedAt !== 'string'
    ) {
      return null;
    }
    return {
      tags: parsed.tags,
      preferredNeighborhoods: parsed.preferredNeighborhoods,
      archetype: parsed.archetype,
      savedAt: parsed.savedAt,
    };
  } catch {
    return null;
  }
}

export function saveProfile(profile: VibeProfile): void {
  if (typeof window === 'undefined') return;
  const stored: StoredProfile = { ...profile, savedAt: new Date().toISOString() };
  try {
    window.localStorage.setItem(KEY, JSON.stringify(stored));
  } catch {
    // Ignore quota / private-mode errors silently.
  }
}

export function clearProfile(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // Ignore.
  }
}
