import type { SupabaseClient } from '@supabase/supabase-js';
import type { Rating } from '@/types/ratings';

/**
 * Anonymous read of an OPTED-IN profile's ranked list — the sender's half of
 * the week-2 recipient landing (goal acceptance 6).
 *
 * Backed by `get_public_ratings(handle)` in migration 0015, which is NOT YET
 * APPLIED: it is the first anon-readable surface over user content and gates
 * on a per-profile opt-in that defaults to false. Until an operator applies it
 * and ships the settings control, every call here returns null and the share
 * page renders exactly as it does today. That is the intended failure mode —
 * a missing RPC must degrade to "no list", never to an error page on a link a
 * stranger was just texted.
 *
 * Tier only. `score` must never appear in this path: scores are owner-only,
 * and this is the widest audience any rating data in this product has.
 */

export type PublicListEntry = {
  barId: string;
  rating: Rating;
  ratedAt: string;
};

type PublicRatingRow = {
  bar_id: string;
  tier: string;
  rated_at: string;
};

const VALID_TIERS: ReadonlySet<string> = new Set(['loved', 'liked', 'pass']);

/** loved > liked > pass; within a tier, most recently rated first. */
const TIER_ORDER: Record<Rating, number> = { loved: 0, liked: 1, pass: 2 };

function isPublicRatingRow(value: unknown): value is PublicRatingRow {
  if (value === null || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.bar_id === 'string' &&
    typeof row.tier === 'string' &&
    VALID_TIERS.has(row.tier) &&
    typeof row.rated_at === 'string'
  );
}

/**
 * Fetch a profile's public list, tier-ranked.
 *
 * Returns null — not an empty array — when the profile has not opted in, the
 * handle is unknown, or the RPC does not exist yet. The caller renders nothing
 * in all three cases, and the distinction between "opted out" and "has no
 * ratings" deliberately does not leak: both are null.
 */
export async function fetchPublicRatings(
  supabase: SupabaseClient,
  handle: string,
): Promise<PublicListEntry[] | null> {
  const normalized = handle.trim().toLowerCase();
  // Same charset guard as search_handles. An invalid handle never reaches the
  // RPC — cheaper, and it keeps junk out of the database's logs.
  if (!/^[a-z0-9_]{1,20}$/.test(normalized)) return null;

  const { data, error } = await supabase.rpc('get_public_ratings', {
    handle_query: normalized,
  });

  if (error || !Array.isArray(data) || data.length === 0) return null;

  const entries = data.filter(isPublicRatingRow).map((row) => ({
    barId: row.bar_id,
    rating: row.tier as Rating,
    ratedAt: row.rated_at,
  }));

  return entries.length === 0
    ? null
    : entries.sort(
        (a, b) =>
          TIER_ORDER[a.rating] - TIER_ORDER[b.rating] ||
          Date.parse(b.ratedAt) - Date.parse(a.ratedAt),
      );
}
