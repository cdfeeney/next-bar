import { haversineMiles } from '../../src/lib/distance';
import { normalizeLegacy } from './reconcile';
import type { CuratedCandidate } from './apply';
import type { NormalizedCandidate } from './types';

const ALLOWED_AMENITIES = new Set(['bar', 'pub', 'biergarten', 'nightclub']);
const NON_MANHATTAN_HOODS = new Set([
  'Bushwick',
  'Fort Greene',
  'Gowanus',
  'Hoboken',
  'Jersey City',
  'Long Island City',
  'LIC',
]);
const METERS_PER_MILE = 1609.344;

export interface OsmNode {
  id: number;
  lat: number;
  lon: number;
  timestamp?: string;
  visible?: boolean;
  tags?: Record<string, string>;
}

export interface SlaLicense {
  licensepermitid?: string;
  premisescounty?: string;
  description?: string;
  legalname?: string;
  actualaddressofpremises?: string;
  georeference?: { coordinates?: [number, number] };
}

export interface StagingBar {
  id: string;
  name: string;
  neighborhood: string;
  address: string | null;
  lat: number;
  lng: number;
}

export interface AcceptedEvidence {
  externalId: string;
  osmUrl: string;
  osmTimestamp: string | null;
  slaLicenseId: string;
  slaUrl: string;
  slaClass: string;
  slaLegalName: string;
  addressMatch: string;
  coordinateDistanceMeters: number;
  openStatus: 'corroborated-current';
  openStatusBasis: string;
  dedupResult: 'new';
  priceTierBasis: string;
}

export interface Rejection {
  externalId: string;
  name: string;
  reason: string;
}

export interface CurationResult {
  curated: CuratedCandidate[];
  evidence: AcceptedEvidence[];
  rejected: Rejection[];
}

export function normalizeAddress(value: string): string {
  return value
    .toUpperCase()
    .replace(/\bWEST\b/g, 'W')
    .replace(/\bEAST\b/g, 'E')
    .replace(/\bNORTH\b/g, 'N')
    .replace(/\bSOUTH\b/g, 'S')
    .replace(/\bSTREET\b/g, 'ST')
    .replace(/\bAVENUE\b/g, 'AVE')
    .replace(/\bBOULEVARD\b/g, 'BLVD')
    .replace(/\bROAD\b/g, 'RD')
    .replace(/\bPLACE\b/g, 'PL')
    .replace(/\bLANE\b/g, 'LN')
    .replace(/\bDRIVE\b/g, 'DR')
    .replace(/[^A-Z0-9]/g, '');
}

function displayAddress(tags: Record<string, string>): string | null {
  const number = tags['addr:housenumber']?.trim();
  const street = tags['addr:street']?.trim();
  return number && street ? `${number} ${street}` : null;
}

function canonicalName(value: string): string {
  return normalizeLegacy(value)
    .replace(/\bnew york city\b|\bnew york\b|\bnyc\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenSimilarity(a: string, b: string): number {
  const left = new Set(canonicalName(a).split(' ').filter(Boolean));
  const right = new Set(canonicalName(b).split(' ').filter(Boolean));
  if (left.size === 0 || right.size === 0) return 0;
  const overlap = [...left].filter((token) => right.has(token)).length;
  return overlap / Math.max(left.size, right.size);
}

function duplicateOf(candidate: NormalizedCandidate, staging: readonly StagingBar[]): StagingBar | null {
  const candidateName = canonicalName(candidate.name);
  for (const row of staging) {
    if (row.id === idFromExternalId(candidate.externalId)) return row;
    if (candidateName === canonicalName(row.name) && candidate.neighborhood === row.neighborhood) {
      return row;
    }
    const meters = haversineMiles(candidate, row) * METERS_PER_MILE;
    const sameAddress = candidate.address && row.address
      ? normalizeAddress(candidate.address) === normalizeAddress(row.address)
      : false;
    if ((sameAddress || meters <= 30) && tokenSimilarity(candidate.name, row.name) >= 0.5) {
      return row;
    }
  }
  return null;
}

function idFromExternalId(externalId: string): string {
  return externalId
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'x';
}

function amenityBlurb(name: string, amenity: string, neighborhood: string): string {
  const kind = amenity === 'nightclub' ? 'nightclub' : amenity === 'pub' ? 'pub' : 'bar';
  return `${name} is a ${kind} in ${neighborhood}.`;
}

export function curateManhattanCandidates(input: {
  candidates: readonly NormalizedCandidate[];
  osmNodes: readonly OsmNode[];
  slaLicenses: readonly SlaLicense[];
  staging: readonly StagingBar[];
  verifiedDate: string;
}): CurationResult {
  const nodes = new Map(input.osmNodes.map((node) => [node.id, node]));
  const licensesByAddress = new Map<string, SlaLicense[]>();
  for (const license of input.slaLicenses) {
    if (license.premisescounty !== 'New York' || !license.actualaddressofpremises) continue;
    const key = normalizeAddress(license.actualaddressofpremises);
    licensesByAddress.set(key, [...(licensesByAddress.get(key) ?? []), license]);
  }

  const curated: CuratedCandidate[] = [];
  const evidence: AcceptedEvidence[] = [];
  const rejected: Rejection[] = [];

  const reject = (candidate: NormalizedCandidate, reason: string) => {
    rejected.push({ externalId: candidate.externalId, name: candidate.name, reason });
  };

  for (const candidate of input.candidates) {
    if (NON_MANHATTAN_HOODS.has(candidate.neighborhood)) {
      reject(candidate, 'outside Manhattan');
      continue;
    }
    if (candidate.provider !== 'osm') {
      reject(candidate, 'legal-entity-only SLA record; no verified customer-facing identity');
      continue;
    }

    const nodeId = Number(candidate.externalId.match(/^osm:node\/(\d+)$/)?.[1]);
    const node = nodes.get(nodeId);
    if (!node || node.visible === false) {
      reject(candidate, 'OSM venue missing or not currently visible');
      continue;
    }
    const tags = node.tags ?? {};
    const amenity = tags.amenity;
    if (!amenity || !ALLOWED_AMENITIES.has(amenity) || !tags.name || tags.disused || tags.abandoned) {
      reject(candidate, 'current OSM record is not an active named bar venue');
      continue;
    }
    const address = displayAddress(tags);
    if (!address) {
      reject(candidate, 'current OSM record lacks a verifiable street address');
      continue;
    }
    const candidateAtCurrentLocation = { ...candidate, name: tags.name, address, lat: node.lat, lng: node.lon };
    const matches = (licensesByAddress.get(normalizeAddress(address)) ?? []).filter((license) => {
      const coordinates = license.georeference?.coordinates;
      if (!coordinates) return false;
      return haversineMiles(candidateAtCurrentLocation, { lat: coordinates[1], lng: coordinates[0] })
        * METERS_PER_MILE <= 50;
    });
    if (matches.length === 0) {
      reject(candidate, 'no unique current active SLA license at the same address');
      continue;
    }
    if (matches.length !== 1) {
      reject(candidate, 'multiple current active SLA licenses at the same address');
      continue;
    }
    const duplicate = duplicateOf(candidateAtCurrentLocation, input.staging);
    if (duplicate) {
      reject(candidate, `already represented in staging as ${duplicate.id}`);
      continue;
    }

    const license = matches[0];
    const coordinates = license.georeference!.coordinates!;
    const id = idFromExternalId(candidate.externalId);
    curated.push({
      id,
      externalId: candidate.externalId,
      name: tags.name,
      neighborhood: candidate.neighborhood,
      address,
      lat: node.lat,
      lng: node.lon,
      priceTier: 2,
      tags: amenity === 'pub' ? ['pub'] : amenity === 'nightclub' ? ['dance'] : [],
      blurb: amenityBlurb(tags.name, amenity, candidate.neighborhood),
      lastVerified: input.verifiedDate,
    });
    evidence.push({
      externalId: candidate.externalId,
      osmUrl: `https://www.openstreetmap.org/node/${node.id}`,
      osmTimestamp: node.timestamp ?? null,
      slaLicenseId: license.licensepermitid!,
      slaUrl: `https://data.ny.gov/resource/9s3h-dpkz.json?licensepermitid=${encodeURIComponent(license.licensepermitid!)}`,
      slaClass: license.description ?? '',
      slaLegalName: license.legalname ?? '',
      addressMatch: normalizeAddress(address),
      coordinateDistanceMeters: Number((
        haversineMiles(candidateAtCurrentLocation, { lat: coordinates[1], lng: coordinates[0] })
        * METERS_PER_MILE
      ).toFixed(1)),
      openStatus: 'corroborated-current',
      openStatusBasis: 'Current named OSM bar record plus current active NY SLA license at the same address.',
      dedupResult: 'new',
      priceTierBasis: 'Conservative operator editorial tier (2); no paid price provider used.',
    });
  }

  curated.sort((a, b) => a.id.localeCompare(b.id));
  evidence.sort((a, b) => a.externalId.localeCompare(b.externalId));
  rejected.sort((a, b) => a.externalId.localeCompare(b.externalId));
  if (curated.length + rejected.length !== input.candidates.length) {
    throw new Error('curation accounting mismatch');
  }
  if (curated.length > 50) {
    throw new Error(`curated batch has ${curated.length} rows; a single atomic insert is limited to 50`);
  }
  return { curated, evidence, rejected };
}
