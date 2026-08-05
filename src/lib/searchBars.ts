import type { Bar } from '@/types';
import { displayHood } from '@/lib/hoodDisplay';
import { TAG_DISPLAY } from '@/lib/tagDisplay';

/**
 * searchBars — pure catalog text search for the /search surface (goal
 * g-7b6021a8). Matches bar NAME, NEIGHBORHOOD (raw union value and its
 * spelled-out display name), and VIBE TAGS (raw token and its display
 * label, so "dancing" finds `dance` and "dive" finds `dive`).
 *
 * Entirely local and synchronous: no network, no analytics, no
 * per-keystroke remote calls — the acceptance criteria forbid them and
 * a ~1k-bar array needs nothing more.
 *
 * Ordering is DETERMINISTIC (name-prefix, then name-substring, then
 * neighborhood, then tag; alphabetical by name inside each bucket, id as
 * the final tiebreak) so tests and users see stable results.
 */

export const MIN_QUERY_LENGTH = 2;
/** Rendering cap — the UI says "showing N of M" when it truncates. */
export const MAX_RESULTS = 30;

export type CatalogSearchResult = {
  /** Ranked matches, capped at MAX_RESULTS. */
  results: Bar[];
  /** Total matches before the cap, so the UI can be honest about truncation. */
  total: number;
};

const enum MatchRank {
  NamePrefix = 0,
  NameSubstring = 1,
  Neighborhood = 2,
  Tag = 3,
}

function rankMatch(bar: Bar, q: string): MatchRank | null {
  const name = bar.name.toLowerCase();
  if (name.startsWith(q)) return MatchRank.NamePrefix;
  if (name.includes(q)) return MatchRank.NameSubstring;
  const hoodRaw = bar.neighborhood.toLowerCase();
  const hoodDisplay = displayHood(bar.neighborhood).toLowerCase();
  if (hoodRaw.includes(q) || hoodDisplay.includes(q)) return MatchRank.Neighborhood;
  for (const tag of bar.tags) {
    // Raw token and display label are both human-readable ("dance" /
    // "Dancing"). Price tags display as glyphs ('$'…) which never match a
    // typed word, but their raw tokens ("cheap") still do — intended.
    if (tag.toLowerCase().includes(q) || TAG_DISPLAY[tag].toLowerCase().includes(q)) {
      return MatchRank.Tag;
    }
  }
  return null;
}

export function searchCatalog(bars: readonly Bar[], query: string): CatalogSearchResult {
  const q = query.trim().toLowerCase();
  if (q.length < MIN_QUERY_LENGTH) return { results: [], total: 0 };

  const matched: Array<{ bar: Bar; rank: MatchRank }> = [];
  for (const bar of bars) {
    const rank = rankMatch(bar, q);
    if (rank !== null) matched.push({ bar, rank });
  }

  matched.sort((a, b) => {
    if (a.rank !== b.rank) return a.rank - b.rank;
    // Pinned 'en' collation: default-locale localeCompare can order
    // diacritics differently between Node (tests) and a user's browser,
    // which would break the deterministic-ordering guarantee (santa:
    // DeepSeek).
    const byName = a.bar.name.localeCompare(b.bar.name, 'en');
    if (byName !== 0) return byName;
    return a.bar.id.localeCompare(b.bar.id, 'en');
  });

  return {
    results: matched.slice(0, MAX_RESULTS).map((m) => m.bar),
    total: matched.length,
  };
}
