import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { rowToBar } from '../../src/lib/catalogServer';
import { applyCurated, type BarsWriteClient, type CuratedCandidate } from './apply';
import { curateManhattanCandidates, normalizeAddress } from './manhattan-curation';

describe('Manhattan staging curation', () => {
  it('accepts only a current OSM bar with one matching active license and no staging duplicate', () => {
    const candidate = {
      externalId: 'osm:node/7', name: 'Test Bar', neighborhood: 'Chelsea', lat: 40.75, lng: -74,
      signals: ['osm:bar'], evidenceIds: ['osm:node/7'], verification: 'unverified' as const, provider: 'osm',
    };
    const base = {
      candidates: [candidate],
      osmNodes: [{ id: 7, lat: 40.75, lon: -74, tags: { amenity: 'bar', name: 'Test Bar', 'addr:housenumber': '10', 'addr:street': 'West 26th Street' } }],
      slaLicenses: [{ licensepermitid: 'L7', premisescounty: 'New York', description: 'Additional Bar', legalname: 'TEST LLC', actualaddressofpremises: '10 W 26TH ST', georeference: { coordinates: [-74, 40.75] as [number, number] } }],
      staging: [],
      verifiedDate: '2026-08-13',
    };
    expect(normalizeAddress('10 West 26th Street')).toBe(normalizeAddress('10 W. 26TH ST'));
    expect(curateManhattanCandidates(base).curated).toHaveLength(1);
    expect(curateManhattanCandidates({ ...base, staging: [{ id: 'existing', name: 'Test Bar NYC', neighborhood: 'Chelsea', address: '10 W 26th St', lat: 40.75, lng: -74 }] }).curated).toHaveLength(0);
  });

  it('previews the exact payload through one no-write atomic insert fixture', async () => {
    const payload = JSON.parse(fs.readFileSync(
      'docs/release-artifacts/v7-manhattan-staging-2026-08-13/curated-payload.json',
      'utf8',
    )) as CuratedCandidate[];
    const calls: number[] = [];
    const client: BarsWriteClient = {
      selectExisting: async () => ({ data: [], error: null }),
      insert: async (rows) => {
        calls.push(rows.length);
        return { error: null };
      },
    };
    const result = await applyCurated(client, payload, (row) => rowToBar(row as never) !== null);
    expect(result).toEqual({ inserted: 33, rejected: [] });
    expect(calls).toEqual([33]);
  });
});
