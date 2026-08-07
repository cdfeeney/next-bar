/**
 * Per-physical-location identity.
 *
 * The sweep used to suppress any candidate whose normalized name matched ANY
 * catalog row anywhere in the city. That is a brand-level test applied to a
 * location-level question, and it deletes the second location of every
 * multi-location venue — a real bar that exists, has its own Place ID, and is
 * missing from the catalog. Identity here is resolved per location, with
 * Place ID first and a graceful fallback for license-only rows that have no
 * Place ID at all.
 */
import { distanceMeters, normalizeName } from './coverage-search.mjs';

/** Two rows this close with a matching address are the same storefront. */
export const SAME_LOCATION_METERS = 50;

const BOROUGH_BY_COUNTY = new Map([
  ['new york', 'manhattan'],
  ['manhattan', 'manhattan'],
  ['kings', 'brooklyn'],
  ['brooklyn', 'brooklyn'],
  ['queens', 'queens'],
  ['bronx', 'bronx'],
  ['richmond', 'staten island'],
  ['staten island', 'staten island'],
]);

const BOROUGH_IN_ADDRESS_RE =
  /(?:^|,\s*)(manhattan|brooklyn|queens|bronx|staten island|new york)\s*,\s*NY\b/i;

/** Borough for a row, from an explicit county, an SLA county, or the address. */
export function boroughOf(row) {
  const explicit = row?.borough ?? row?.county ?? row?.licenseMatches?.[0]?.county;
  if (explicit) {
    const mapped = BOROUGH_BY_COUNTY.get(String(explicit).trim().toLowerCase());
    if (mapped) return mapped;
  }
  const match = String(row?.address ?? row?.formattedAddress ?? '').match(BOROUGH_IN_ADDRESS_RE);
  if (match) return BOROUGH_BY_COUNTY.get(match[1].toLowerCase()) ?? match[1].toLowerCase();
  return null;
}

const STREET_SUFFIX = new Set([
  'st', 'street', 'ave', 'avenue', 'rd', 'road', 'blvd', 'boulevard', 'pl', 'place',
  'ln', 'lane', 'dr', 'drive', 'ct', 'court', 'pkwy', 'parkway', 'ter', 'terrace',
  'sq', 'square', 'hwy', 'highway', 'bway', 'broadway',
]);

/**
 * House number + street, normalized enough that "331 W 4th St" and
 * "331 West 4th Street" agree, without pretending to be a real geocoder.
 */
export function streetKey(address) {
  const text = String(address ?? '').split(',')[0]?.trim() ?? '';
  if (!text) return null;
  const raw = text.match(/^(\d+[a-z]?)\b/i)?.[1] ?? null;
  if (!raw) return null;
  const number = raw.toLowerCase();
  // Slice by the RAW match length, not by searching for the lowercased form:
  // "12A Main St" would otherwise fail to locate "12a" and leave the uppercase
  // suffix glued to the street ("12a:amain" vs "12a:main").
  const rest = text
    .slice(raw.length)
    .toLowerCase()
    .replace(/\bwest\b/g, 'w')
    .replace(/\beast\b/g, 'e')
    .replace(/\bnorth\b/g, 'n')
    .replace(/\bsouth\b/g, 's')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter((token) => token && !STREET_SUFFIX.has(token))
    .join('');
  return rest ? `${number}:${rest}` : null;
}

function coordKey(row) {
  const lat = Number.isFinite(row?.lat) ? row.lat : row?.location?.latitude;
  const lng = Number.isFinite(row?.lng) ? row.lng : row?.location?.longitude;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return `${lat.toFixed(4)}:${lng.toFixed(4)}`;
}

/**
 * Identity key for a row with no Place ID. Borough is part of the key so two
 * same-named venues in different boroughs cannot collide even if their
 * coordinates happen to round together.
 */
export function physicalLocationKey(row) {
  const name = normalizeName(row?.name ?? '');
  const borough = boroughOf(row) ?? '?';
  const street = streetKey(row?.address ?? row?.formattedAddress);
  if (street) return `loc:${name}:${street}:${borough}`;
  const coords = coordKey(row);
  if (coords) return `loc:${name}:${coords}:${borough}`;
  return null;
}

function coordsOf(row) {
  const lat = Number.isFinite(row?.lat) ? row.lat : row?.location?.latitude;
  const lng = Number.isFinite(row?.lng) ? row.lng : row?.location?.longitude;
  return Number.isFinite(lat) && Number.isFinite(lng)
    ? { latitude: lat, longitude: lng }
    : null;
}

/**
 * Decide whether `candidate` is the same physical venue as any production row.
 *
 * Returns one of:
 *   duplicate  — same storefront, suppress
 *   distinct   — a real venue the catalog does not have, keep
 *   ambiguous  — not enough evidence to say; caller must route to `lookup`
 *                rather than guessing in either direction
 */
export function resolveIdentity(candidate, productionRows = []) {
  // 1. Place ID is the gold key.
  if (candidate.placeId) {
    const exact = productionRows.find((row) => row.place_id === candidate.placeId);
    if (exact) {
      return {
        verdict: 'duplicate',
        match: exact,
        reason: `same Google Place ID as production row: ${exact.name}`,
      };
    }
  }

  const candidateCoords = coordsOf(candidate);
  const candidateStreet = streetKey(candidate.address);
  const candidateName = normalizeName(candidate.name ?? '');
  const candidateBorough = boroughOf(candidate);

  const nearby = productionRows
    .map((row) => {
      const rowCoords = coordsOf(row);
      if (!candidateCoords || !rowCoords) return null;
      return { row, distance: Math.round(distanceMeters(candidateCoords, rowCoords)) };
    })
    .filter((entry) => entry && entry.distance <= SAME_LOCATION_METERS)
    .sort((a, b) => a.distance - b.distance);

  for (const { row, distance } of nearby) {
    const sameName = candidateName && normalizeName(row.name) === candidateName;
    const rowStreet = streetKey(row.address);
    const sameStreet = candidateStreet && rowStreet && candidateStreet === rowStreet;

    // 2. Two rows that BOTH have a Place ID and disagree are normally two real
    //    venues — this is what lets a second location of a brand survive.
    //
    //    Google reissues a Place ID on owner re-claims and listing merges, so a
    //    differing id is not proof of two venues either. It is simply
    //    UNINFORMATIVE, and uninformative evidence must not resolve to the
    //    costliest verdict available. Suppressing as a duplicate drops a real
    //    bar with nothing left to audit; accepting a false one is a visible row
    //    someone can delete. So this case goes to a human instead of being
    //    decided automatically in either direction.
    //
    //    Note that street and distance are NOT independent signals here: any
    //    two venues in one building satisfy both, which leaves the whole
    //    decision resting on a name match — and names collide exactly in the
    //    co-located cases (hotel bars, food-hall stalls) this would hit.
    if (candidate.placeId && row.place_id && row.place_id !== candidate.placeId) {
      if (sameName && sameStreet) {
        return {
          verdict: 'ambiguous',
          match: row,
          reason: `same name and street address as production row ${row.name} (${distance}m) but a different Place ID — Google reissues ids on re-claims, so this needs a human to confirm one venue or two`,
        };
      }
      continue;
    }

    const sameBorough =
      !candidateBorough || !boroughOf(row) || boroughOf(row) === candidateBorough;

    // 3. No Place ID on one side: match the physical location, not the name.
    if (sameName && sameStreet && sameBorough) {
      return {
        verdict: 'duplicate',
        match: row,
        reason: `same name and street address as production row: ${row.name} (${distance}m)`,
      };
    }
    if (sameName && !candidateStreet && !rowStreet && distance <= SAME_LOCATION_METERS) {
      return {
        verdict: 'duplicate',
        match: row,
        reason: `same name at the same coordinates as production row: ${row.name} (${distance}m)`,
      };
    }
  }

  // 4. A name collision beyond the location radius, or at a different street,
  //    is a different location of the same brand. Both survive.
  const brandElsewhere = productionRows.find(
    (row) => candidateName && normalizeName(row.name) === candidateName,
  );
  if (brandElsewhere) {
    // 5. Nothing to locate it by — do not guess in either direction.
    if (!candidate.placeId && !candidateStreet && !candidateCoords) {
      return {
        verdict: 'ambiguous',
        match: brandElsewhere,
        reason: `shares a name with production row ${brandElsewhere.name} and has no Place ID, address, or coordinates to distinguish it`,
      };
    }
    return {
      verdict: 'distinct',
      match: brandElsewhere,
      reason: `distinct location of a name already in production: ${brandElsewhere.name}`,
    };
  }

  return { verdict: 'distinct', match: null, reason: 'no production row at this location' };
}
