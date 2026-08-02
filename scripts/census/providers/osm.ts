import type { CensusContext, Evidence, NormalizedCandidate, ProviderAdapter, ProviderResult } from '../types';
import { neighborhoodOfUnit, tileForUnit, tileUnits } from '../tiles';

/**
 * OpenStreetMap Overpass adapter. Tile = unit, cursor = null (one query per
 * tile) — the grain the legacy nearby-sweep used, chosen over offset paging
 * so geo providers share unit keys and per-run dedup collapses overlaps
 * (design review). Free, keyless, and the historical source of most of the
 * catalog's coordinates.
 */

export const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

const BAR_AMENITIES = new Set(['bar', 'pub', 'biergarten', 'nightclub']);

interface OverpassResponse {
  elements?: Array<{
    type: string;
    id: number;
    lat?: number;
    lon?: number;
    center?: { lat: number; lon: number };
    tags?: Record<string, string>;
  }>;
}

export function osmAdapter(): ProviderAdapter {
  return {
    name: 'osm',
    units: (borough: string) => tileUnits(borough),
    async fetchUnit(unit, _cursor, ctx: CensusContext): Promise<ProviderResult> {
      const tile = tileForUnit(unit);
      const radius = tile?.radius ?? 800;
      const lat = tile?.lat ?? 0;
      const lng = tile?.lng ?? 0;
      const query = `[out:json][timeout:25];(node["amenity"~"bar|pub|biergarten|nightclub"](around:${radius},${lat},${lng});way["amenity"~"bar|pub|biergarten|nightclub"](around:${radius},${lat},${lng}););out center;`;
      const res = await ctx.transport(OVERPASS_URL, { method: 'POST', body: query });

      if (res.status !== 200) {
        return {
          candidates: [],
          evidence: [],
          nextCursor: null,
          saturated: false,
          callsUsed: 1,
          retry: { attempts: 1, lastError: `http ${res.status}` },
        };
      }

      const parsed = res.body as OverpassResponse;
      const retrievedAt = new Date().toISOString();
      const candidates: NormalizedCandidate[] = [];
      const evidence: Evidence[] = [];
      for (const el of parsed.elements ?? []) {
        const name = el.tags?.name;
        const amenity = el.tags?.amenity ?? '';
        const elat = el.lat ?? el.center?.lat;
        const elng = el.lon ?? el.center?.lon;
        // Nameless OSM nodes are unusable as catalog candidates — dropped.
        if (!name || !BAR_AMENITIES.has(amenity) || elat === undefined || elng === undefined) continue;
        const externalId = `osm:${el.type}/${el.id}`;
        evidence.push({
          id: externalId,
          provider: 'osm',
          url: `https://www.openstreetmap.org/${el.type}/${el.id}`,
          externalId: `${el.type}/${el.id}`,
          retrievedAt,
        });
        candidates.push({
          externalId,
          name,
          neighborhood: neighborhoodOfUnit(unit),
          lat: elat,
          lng: elng,
          signals: [`osm:${amenity}`, ...Object.keys(el.tags ?? {}).map((k) => `tag:${k}`)],
          evidenceIds: [externalId],
          verification: 'unverified',
          provider: 'osm',
        });
      }
      return {
        candidates,
        evidence,
        nextCursor: null,
        saturated: true,
        callsUsed: 1,
        retry: { attempts: 0 },
      };
    },
  };
}
