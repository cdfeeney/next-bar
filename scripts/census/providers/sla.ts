import type { CensusContext, Evidence, NormalizedCandidate, ProviderAdapter, ProviderResult } from '../types';

/**
 * NY State Liquor Authority adapter (data.ny.gov Socrata dataset). Unit =
 * borough (license rows carry county, not neighborhood tiles); cursor =
 * numeric row offset; saturated when a page comes back short. On-premises
 * license classes are the bar-shaped subset — a license is EVIDENCE a venue
 * can pour, not proof it is a bar, so candidates stay 'unverified' and carry
 * the license class as a signal for curation.
 */

export const SLA_DATASET_URL =
  'https://data.ny.gov/resource/nqur-w4p7.json';

export const SLA_PAGE_SIZE = 100;

const BOROUGH_TO_COUNTY: Record<string, string> = {
  manhattan: 'NEW YORK',
  brooklyn: 'KINGS',
  queens: 'QUEENS',
  bronx: 'BRONX',
  'staten island': 'RICHMOND',
};

interface SlaRow {
  license_serial_number?: string;
  premises_name?: string;
  doing_business_as_name?: string;
  latitude?: string;
  longitude?: string;
  actual_address_of_premises_address1?: string;
  license_type_name?: string;
}

export function slaAdapter(): ProviderAdapter {
  return {
    name: 'sla',
    units: (borough: string) => [borough.toLowerCase()],
    async fetchUnit(unit, cursor, ctx: CensusContext): Promise<ProviderResult> {
      const offset = cursor ? Number(cursor) : 0;
      const county = BOROUGH_TO_COUNTY[unit] ?? unit.toUpperCase();
      const url = `${SLA_DATASET_URL}?$limit=${SLA_PAGE_SIZE}&$offset=${offset}&county=${encodeURIComponent(county)}`;
      const res = await ctx.transport(url);

      if (res.status !== 200) {
        return {
          candidates: [],
          evidence: [],
          nextCursor: cursor,
          saturated: false,
          callsUsed: 1,
          retry: { attempts: 1, lastError: `http ${res.status}` },
        };
      }

      const rows = res.body as SlaRow[];
      const retrievedAt = new Date().toISOString();
      const candidates: NormalizedCandidate[] = [];
      const evidence: Evidence[] = [];
      for (const row of rows) {
        const serial = row.license_serial_number;
        const name = row.doing_business_as_name || row.premises_name;
        const lat = row.latitude ? Number(row.latitude) : undefined;
        const lng = row.longitude ? Number(row.longitude) : undefined;
        if (!serial || !name || lat === undefined || lng === undefined) continue;
        if (Number.isNaN(lat) || Number.isNaN(lng)) continue;
        const externalId = `sla:${serial}`;
        evidence.push({
          id: externalId,
          provider: 'sla',
          url: `${SLA_DATASET_URL}?license_serial_number=${serial}`,
          externalId: serial,
          retrievedAt,
        });
        candidates.push({
          externalId,
          name,
          neighborhood: unit, // borough-grain; curation refines neighborhoods
          lat,
          lng,
          address: row.actual_address_of_premises_address1,
          signals: row.license_type_name ? [`sla:${row.license_type_name}`] : [],
          evidenceIds: [externalId],
          verification: 'unverified',
          provider: 'sla',
        });
      }
      const saturated = rows.length < SLA_PAGE_SIZE;
      return {
        candidates,
        evidence,
        nextCursor: saturated ? null : String(offset + SLA_PAGE_SIZE),
        saturated,
        callsUsed: 1,
        retry: { attempts: 0 },
      };
    },
  };
}
