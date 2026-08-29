import type { CensusContext, Evidence, NormalizedCandidate, ProviderAdapter, ProviderResult } from '../types';

/**
 * NY State Liquor Authority adapter — data.ny.gov Socrata dataset 9s3h-dpkz
 * ("Current Liquor Authority Active Licenses"). Unit = borough (license rows
 * carry premisescounty, not neighborhood tiles); cursor = numeric row offset;
 * saturated when a page comes back short. Server-side filter to the
 * bar-shaped license classes — a license is EVIDENCE a venue can pour, not
 * proof it is a bar, so candidates stay 'unverified' and carry the class as
 * a signal for curation.
 *
 * REWRITTEN after the first live pilot (2026-08-04): the previous dataset id
 * nqur-w4p7 was a GASOLINE-PRICES table and every column name here was
 * fictional relative to the real schema. Names in 9s3h-dpkz are LEGAL names
 * ("BEER TIME STORE INC") — display naming is a curation concern.
 */

export const SLA_DATASET_URL = 'https://data.ny.gov/resource/9s3h-dpkz.json';

export const SLA_PAGE_SIZE = 100;

/**
 * Bar-shaped license classes observed in the live dataset (Manhattan counts,
 * 2026-08-04: Additional Bar 1434, Club 90, Cabaret 19, Bottle Club 8,
 * Night Club 1). 'Restaurant' (3989) is deliberately excluded from the
 * pilot — it floods curation with venues that are not bars; revisit at
 * expansion with its own approval.
 */
export const SLA_BAR_CLASSES = ['Additional Bar', 'Club', 'Cabaret', 'Night Club', 'Bottle Club'];

/** Title-case values as the dataset stores them (e.g. 'New York', not 'NEW YORK'). */
const BOROUGH_TO_COUNTY: Record<string, string> = {
  manhattan: 'New York',
  brooklyn: 'Kings',
  queens: 'Queens',
  bronx: 'Bronx',
  'staten island': 'Richmond',
};

interface SlaRow {
  licensepermitid?: string;
  premisescounty?: string;
  description?: string;
  legalname?: string;
  actualaddressofpremises?: string;
  city?: string;
  zipcode?: string;
  georeference?: { type?: string; coordinates?: [number, number] };
}

export function slaAdapter(): ProviderAdapter {
  return {
    name: 'sla',
    units: (borough: string) => [borough.toLowerCase()],
    async fetchUnit(unit, cursor, ctx: CensusContext): Promise<ProviderResult> {
      const offset = cursor ? Number(cursor) : 0;
      const county = BOROUGH_TO_COUNTY[unit];
      // Fail fast on an unmapped borough instead of interpolating the raw
      // CLI value into a quoted SoQL literal (T0 review of f5d1579: Fable M
      // + Codex M — URL-encoding does not escape SoQL syntax, and a
      // lowercase fallback would silently match zero rows anyway).
      if (!county) {
        throw new Error(`sla adapter: unknown borough '${unit}' — add it to BOROUGH_TO_COUNTY`);
      }
      const where = `premisescounty='${county}' AND description in(${SLA_BAR_CLASSES.map((c) => `'${c}'`).join(',')})`;
      // $order makes offset paging deterministic — Socrata row order is
      // otherwise unstable across requests and pages could overlap/skip.
      const url =
        `${SLA_DATASET_URL}?$limit=${SLA_PAGE_SIZE}&$offset=${offset}` +
        `&$order=${encodeURIComponent('licensepermitid')}` +
        `&$where=${encodeURIComponent(where)}`;
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
        const serial = row.licensepermitid;
        const name = row.legalname;
        const coords = row.georeference?.coordinates;
        const lng = coords?.[0];
        const lat = coords?.[1];
        if (!serial || !name || lat === undefined || lng === undefined) continue;
        if (Number.isNaN(lat) || Number.isNaN(lng)) continue;
        const externalId = `sla:${serial}`;
        evidence.push({
          id: externalId,
          provider: 'sla',
          url: `${SLA_DATASET_URL}?licensepermitid=${encodeURIComponent(serial)}`,
          externalId: serial,
          retrievedAt,
        });
        candidates.push({
          externalId,
          name,
          neighborhood: unit, // borough-grain; curation refines neighborhoods
          lat,
          lng,
          address: row.actualaddressofpremises,
          signals: row.description ? [`sla:${row.description}`] : [],
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
