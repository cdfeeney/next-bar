import type { CensusContext, Evidence, NormalizedCandidate, ProviderAdapter, ProviderResult } from '../types';

/**
 * Reviewed URL-seed adapter: a human-reviewed JSON list of venues with the
 * source URL that vouches for each. File source — zero network budget. A row
 * WITHOUT a sourceUrl produces a candidate with NO evidence, which therefore
 * stays 'unverified' forever (the census never promotes; missing evidence is
 * a permanent state, not a retry).
 */

interface SeedRow {
  name?: string;
  neighborhood?: string;
  borough?: string;
  lat?: number;
  lng?: number;
  address?: string;
  sourceUrl?: string;
  reviewedAt?: string;
}

export function urlSeedAdapter(seedFile: string): ProviderAdapter {
  return {
    name: 'url-seed',
    units: (borough: string) => [borough.toLowerCase()],
    async fetchUnit(unit, _cursor, ctx: CensusContext): Promise<ProviderResult> {
      const rows = JSON.parse(ctx.readTextFile(seedFile)) as SeedRow[];
      const retrievedAt = new Date().toISOString();
      const candidates: NormalizedCandidate[] = [];
      const evidence: Evidence[] = [];
      let index = 0;
      for (const row of rows) {
        index += 1;
        if (!row.name || !row.neighborhood || row.lat === undefined || row.lng === undefined) continue;
        if ((row.borough ?? '').toLowerCase() !== unit) continue;
        const externalId = `url-seed:${index}:${row.name}`;
        const evidenceIds: string[] = [];
        if (row.sourceUrl) {
          const evidenceId = externalId;
          evidence.push({
            id: evidenceId,
            provider: 'url-seed',
            url: row.sourceUrl,
            retrievedAt: row.reviewedAt ?? retrievedAt,
          });
          evidenceIds.push(evidenceId);
        }
        candidates.push({
          externalId,
          name: row.name,
          neighborhood: row.neighborhood,
          lat: row.lat,
          lng: row.lng,
          address: row.address,
          signals: ['seed:reviewed-list'],
          evidenceIds,
          verification: 'unverified',
          provider: 'url-seed',
        });
      }
      return {
        candidates,
        evidence,
        nextCursor: null,
        saturated: true,
        callsUsed: 0, // file source: the network budget is never charged
        retry: { attempts: 0 },
      };
    },
  };
}
