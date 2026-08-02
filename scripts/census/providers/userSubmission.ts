import type { CensusContext, NormalizedCandidate, ProviderAdapter, ProviderResult } from '../types';

/**
 * User-submission adapter: an exported JSON dump of in-app bar suggestions.
 * File source — zero network budget. Submissions carry no external evidence
 * URL, so they are the canonical always-'unverified' source; they exist so
 * the census REPORT shows what users asked for next to what providers found.
 */

interface SubmissionRow {
  id?: string;
  name?: string;
  neighborhood?: string;
  borough?: string;
  lat?: number;
  lng?: number;
}

export function userSubmissionAdapter(file: string): ProviderAdapter {
  return {
    name: 'user-submission',
    units: (borough: string) => [borough.toLowerCase()],
    async fetchUnit(unit, _cursor, ctx: CensusContext): Promise<ProviderResult> {
      const rows = JSON.parse(ctx.readTextFile(file)) as SubmissionRow[];
      const candidates: NormalizedCandidate[] = [];
      for (const row of rows) {
        if (!row.id || !row.name || !row.neighborhood) continue;
        if (row.lat === undefined || row.lng === undefined) continue;
        if ((row.borough ?? '').toLowerCase() !== unit) continue;
        candidates.push({
          externalId: `user:${row.id}`,
          name: row.name,
          neighborhood: row.neighborhood,
          lat: row.lat,
          lng: row.lng,
          signals: ['user:suggestion'],
          evidenceIds: [],
          verification: 'unverified',
          provider: 'user-submission',
        });
      }
      return {
        candidates,
        evidence: [],
        nextCursor: null,
        saturated: true,
        callsUsed: 0,
        retry: { attempts: 0 },
      };
    },
  };
}
