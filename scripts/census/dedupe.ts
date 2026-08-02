import type { NormalizedCandidate } from './types';

/**
 * Deterministic dedup — plain functions, never a model. Two layers:
 *  1. RunDeduper: within one census run, overlapping tiles and multiple
 *     providers re-surface the same venue; first sighting wins (by
 *     externalId AND by normalized name+neighborhood).
 *  2. splitAgainstCatalog: fresh vs already-in-catalog, same key the legacy
 *     import pipeline used (normalized name + neighborhood).
 */

export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip combining diacritics
    .replace(/[^a-z0-9 ]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function dedupeKey(name: string, neighborhood: string): string {
  return `${normalizeName(name)}|${neighborhood.trim().toLowerCase()}`;
}

export class RunDeduper {
  private readonly seenExternal = new Set<string>();
  private readonly seenKey = new Set<string>();

  /**
   * Returns true when the candidate is new to this run. EVERY sighting
   * registers BOTH identities, including rejected duplicates: a venue seen
   * in two overlapping tiles carries two neighborhoods, and dropping the
   * second sighting without claiming its name+neighborhood key would let a
   * different provider's copy of that same venue survive under the second
   * neighborhood (found by test: google tile overlap + OSM).
   */
  add(candidate: NormalizedCandidate): boolean {
    const key = dedupeKey(candidate.name, candidate.neighborhood);
    const isDuplicate =
      this.seenExternal.has(candidate.externalId) || this.seenKey.has(key);
    this.seenExternal.add(candidate.externalId);
    this.seenKey.add(key);
    return !isDuplicate;
  }
}

export function splitAgainstCatalog(
  candidates: NormalizedCandidate[],
  catalog: Array<{ name: string; neighborhood: string }>,
): { fresh: NormalizedCandidate[]; existing: NormalizedCandidate[] } {
  const catalogKeys = new Set(catalog.map((b) => dedupeKey(b.name, b.neighborhood)));
  const fresh: NormalizedCandidate[] = [];
  const existing: NormalizedCandidate[] = [];
  for (const c of candidates) {
    (catalogKeys.has(dedupeKey(c.name, c.neighborhood)) ? existing : fresh).push(c);
  }
  return { fresh, existing };
}
