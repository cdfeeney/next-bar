import type { CensusContext, Evidence, NormalizedCandidate, ProviderAdapter, ProviderResult } from '../types';
import { neighborhoodOfUnit, tileForUnit, tileUnits } from '../tiles';

/**
 * Google Places adapter. The PRIMARY-type filter is ported verbatim from the
 * legacy nearby-sweep: Nearby Search matches on ANY type, so without the
 * primary-type gate ~75% of hits are restaurants (measured 136 raw → 34 real
 * bars). What "bar" means for Google lives HERE, not in the runner — each
 * provider owns its own membership rule (design review).
 *
 * Compliance posture (memory/next-bar-google-compliance-posture): only
 * identifiers, names, geometry, and types are persisted — never reviews,
 * photos, or other restricted content.
 */

export const GOOGLE_PRIMARY_BAR_TYPES = new Set([
  'bar', 'pub', 'irish_pub', 'wine_bar', 'night_club', 'bar_and_grill',
  'cocktail_bar', 'sports_bar', 'dive_bar', 'karaoke_bar', 'gastropub',
  'brewery', 'brewpub', 'beer_garden', 'beer_hall', 'taproom', 'distillery',
  'winery', 'pool_hall', 'jazz_club', 'live_music_venue',
]);

const INCLUDED_TYPES = ['bar', 'pub', 'wine_bar', 'night_club', 'bar_and_grill'];

/**
 * Places NEARBY SEARCH — the same discovery mode (and tile grain) as the
 * legacy nearby-sweep.mjs, not text search: it enumerates what is standing
 * inside a coordinate circle, which is the one mode that finds bars with no
 * searchable text footprint. Coverage parity with the deprecated script is
 * deliberate (santa review asked for this to be explicit).
 */
export const GOOGLE_SEARCH_URL =
  'https://places.googleapis.com/v1/places:searchNearby';

interface PlacesResponse {
  places?: Array<{
    id?: string;
    displayName?: { text?: string };
    primaryType?: string;
    types?: string[];
    location?: { latitude?: number; longitude?: number };
    formattedAddress?: string;
  }>;
  nextPageToken?: string;
}

export function googleAdapter(): ProviderAdapter {
  return {
    name: 'google',
    units: (borough: string) => tileUnits(borough),
    async fetchUnit(unit, cursor, ctx: CensusContext): Promise<ProviderResult> {
      const tile = tileForUnit(unit);
      const body = JSON.stringify({
        includedTypes: INCLUDED_TYPES,
        maxResultCount: 20,
        ...(cursor ? { pageToken: cursor } : {}),
        locationRestriction: tile
          ? {
              circle: {
                center: { latitude: tile.lat, longitude: tile.lng },
                radius: tile.radius,
              },
            }
          : undefined,
      });
      const res = await ctx.transport(GOOGLE_SEARCH_URL, { method: 'POST', body });

      if (res.status !== 200) {
        // Failed page: cursor stays where it was so a later attempt retries
        // the same position; the call still counts — quota was spent.
        return {
          candidates: [],
          evidence: [],
          nextCursor: cursor,
          saturated: false,
          callsUsed: 1,
          retry: { attempts: 1, lastError: `http ${res.status}` },
        };
      }

      const parsed = res.body as PlacesResponse;
      const retrievedAt = new Date().toISOString();
      const candidates: NormalizedCandidate[] = [];
      const evidence: Evidence[] = [];
      for (const place of parsed.places ?? []) {
        const id = place.id;
        const name = place.displayName?.text;
        const lat = place.location?.latitude;
        const lng = place.location?.longitude;
        if (!id || !name || lat === undefined || lng === undefined) continue;
        if (!place.primaryType || !GOOGLE_PRIMARY_BAR_TYPES.has(place.primaryType)) continue;
        const externalId = `google:${id}`;
        const evidenceId = `google:${id}`;
        evidence.push({
          id: evidenceId,
          provider: 'google',
          url: `https://www.google.com/maps/place/?q=place_id:${id}`,
          externalId: id,
          retrievedAt,
        });
        candidates.push({
          externalId,
          name,
          neighborhood: neighborhoodOfUnit(unit),
          lat,
          lng,
          address: place.formattedAddress,
          signals: [place.primaryType, ...(place.types ?? [])],
          evidenceIds: [evidenceId],
          verification: 'unverified',
          provider: 'google',
        });
      }
      const nextCursor = parsed.nextPageToken ?? null;
      return {
        candidates,
        evidence,
        nextCursor,
        saturated: nextCursor === null,
        callsUsed: 1,
        retry: { attempts: 0 },
      };
    },
  };
}
