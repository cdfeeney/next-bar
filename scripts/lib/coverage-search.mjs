const LAT_METERS = 111_320;

export const BAR_TYPES = new Set([
  'bar',
  'pub',
  'irish_pub',
  'wine_bar',
  'night_club',
  'bar_and_grill',
  'cocktail_bar',
  'lounge_bar',
  'hookah_bar',
  'sports_bar',
  'dive_bar',
  'karaoke_bar',
  'gastropub',
  'brewery',
  'brewpub',
  'beer_garden',
  'beer_hall',
  'taproom',
  'distillery',
  'winery',
  'pool_hall',
  'jazz_club',
  'live_music_venue',
]);

export const HYBRID_TYPES = new Set([
  'restaurant',
  'cafe',
  'coffee_shop',
  'hotel',
  'event_venue',
  'food_court',
  'market',
  'tourist_attraction',
  'association_or_organization',
]);

const BAR_NAME_RE =
  /\b(bar|pub|tavern|saloon|lounge|rooftop|biergarten|beer|brew|taproom|wine|winery|cocktails?|club|nightclub|speakeasy|cellar|drinks|hops)\b/i;

export function normalizeName(value = '') {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/&/g, 'and')
    .replace(/\b(?:new york|nyc)\b/g, '')
    .replace(/[^a-z0-9]+/g, '')
    .replace(/^the/, '');
}

export function parseBbox(value) {
  const parts = String(value)
    .split(',')
    .map((part) => Number(part.trim()));
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) {
    throw new Error('bbox must be north,west,south,east');
  }
  const [north, west, south, east] = parts;
  if (north <= south || east <= west) {
    throw new Error('bbox must have north > south and east > west');
  }
  return { north, west, south, east };
}

export function bboxAround(center, halfSizeMeters = 900) {
  const latDelta = halfSizeMeters / LAT_METERS;
  const lngDelta =
    halfSizeMeters /
    (LAT_METERS * Math.cos((center.lat * Math.PI) / 180));
  return {
    north: center.lat + latDelta,
    west: center.lng - lngDelta,
    south: center.lat - latDelta,
    east: center.lng + lngDelta,
  };
}

export function isInsideBbox(location, bbox) {
  return (
    Number.isFinite(location?.latitude) &&
    Number.isFinite(location?.longitude) &&
    location.latitude <= bbox.north &&
    location.latitude >= bbox.south &&
    location.longitude >= bbox.west &&
    location.longitude <= bbox.east
  );
}

const GOOGLE_COUNTY_LOCALITIES = new Map([
  ['new york', ['New York', 'Manhattan']],
  ['bronx', ['Bronx']],
  ['kings', ['Brooklyn']],
  ['richmond', ['Staten Island']],
]);

export function matchesGoogleCounty(formattedAddress, county) {
  if (!county) return true;
  const localities = GOOGLE_COUNTY_LOCALITIES.get(String(county).toLowerCase());
  if (!localities) return true;
  const address = String(formattedAddress ?? '');
  return localities.some((locality) =>
    new RegExp(`(?:^|,\\s*)${locality},\\s*NY(?:\\s|$)`, 'i').test(address),
  );
}

/**
 * Build a uniform grid whose edge cells sit on the requested bounds. The
 * spacing is capped below the circle diameter so there are no gaps between
 * search cells, while the smaller circles reduce Google's 20-result
 * truncation in dense neighborhoods.
 */
export function gridForBbox(bbox, stepMeters = 380) {
  if (!Number.isFinite(stepMeters) || stepMeters <= 0) {
    throw new Error('stepMeters must be positive');
  }
  const middleLat = (bbox.north + bbox.south) / 2;
  const height = (bbox.north - bbox.south) * LAT_METERS;
  const width =
    (bbox.east - bbox.west) *
    LAT_METERS *
    Math.cos((middleLat * Math.PI) / 180);
  const rows = Math.max(1, Math.ceil(height / stepMeters));
  const columns = Math.max(1, Math.ceil(width / stepMeters));
  const points = [];
  for (let row = 0; row <= rows; row++) {
    const latitude = bbox.south + ((bbox.north - bbox.south) * row) / rows;
    for (let column = 0; column <= columns; column++) {
      const longitude =
        bbox.west + ((bbox.east - bbox.west) * column) / columns;
      points.push({ latitude, longitude });
    }
  }
  return points;
}

export function textQueries(label) {
  return [
    `bars in ${label}`,
    `cocktail bars in ${label}`,
    `rooftop bars in ${label}`,
    `hotel bars in ${label}`,
    `beer bars pubs and taprooms in ${label}`,
    `wine bars in ${label}`,
    `nightclubs and lounges in ${label}`,
    `sports bars in ${label}`,
    `gay bars in ${label}`,
    `live music bars in ${label}`,
    `bars inside food halls and markets in ${label}`,
  ];
}

export function mergeGooglePlace(target, place, evidence) {
  const current = target.get(place.id) ?? {
    ...place,
    evidence: [],
    queryHits: 0,
  };
  current.evidence.push(evidence);
  if (evidence.kind === 'text') current.queryHits += 1;
  // Text Search sometimes supplies fields that Nearby Search omitted.
  for (const key of ['websiteUri', 'googleMapsUri', 'primaryType', 'types']) {
    if (!current[key] && place[key]) current[key] = place[key];
  }
  target.set(place.id, current);
  return current;
}

export function candidateScore(place, licenseMatches = []) {
  const name = place.displayName?.text ?? '';
  const types = new Set(place.types ?? []);
  const hasBarPrimary = BAR_TYPES.has(place.primaryType);
  const secondaryBarType = [...types].find(
    (type) => type !== place.primaryType && BAR_TYPES.has(type),
  );
  const hasBarName = BAR_NAME_RE.test(name);
  let score = 0;
  const reasons = [];

  if (hasBarPrimary) {
    score += 5;
    reasons.push(`bar primary type: ${place.primaryType}`);
  } else if (secondaryBarType) {
    score += 3;
    reasons.push(`bar secondary type: ${secondaryBarType}`);
  }
  if (hasBarName) {
    score += 2;
    reasons.push('bar signal in consumer name');
  }
  if (place.queryHits >= 1) {
    score += Math.min(2, place.queryHits);
    reasons.push(`${place.queryHits} diversified text-query hits`);
  }
  if (HYBRID_TYPES.has(place.primaryType)) {
    reasons.push(`hybrid primary type: ${place.primaryType}`);
  }
  if (licenseMatches.length > 0) {
    // Supporting evidence only. The bump requires a co-located Google identity,
    // so an SLA row on its own can raise recall (it still becomes a candidate)
    // but can never score its way toward an automatic accept.
    if (place.id) {
      score += 1;
      reasons.push('same-premises active SLA license');
    } else {
      reasons.push('SLA license lead without a Google venue identity');
    }
  }
  if (place.websiteUri) {
    score += 1;
    reasons.push('first-party website available');
  }

  return {
    score,
    tier:
      hasBarPrimary || secondaryBarType || (hasBarName && score >= 4) || score >= 7
        ? 'likely_bar'
        : 'review',
    reasons,
  };
}

export function distanceMeters(a, b) {
  const toRad = (value) => (value * Math.PI) / 180;
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const dLat = lat2 - lat1;
  const dLng = toRad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function nearbyLicenses(place, licenses, maxDistanceMeters = 20) {
  if (!place.location) return [];
  return licenses
    .map((license) => ({
      license,
      distance: distanceMeters(place.location, license.location),
    }))
    .filter((match) => match.distance <= maxDistanceMeters)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 8)
    .map(({ license, distance }) => ({
      ...license,
      distanceMeters: Math.round(distance),
    }));
}

export function likelyLicenseName(name = '') {
  return BAR_NAME_RE.test(name);
}

function uniqueBy(items, key) {
  const seen = new Set();
  return items.filter((item) => {
    const value = key(item);
    if (seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

export function candidateKey(candidate) {
  if (candidate.placeId) return `place:${candidate.placeId}`;
  const lat = Number.isFinite(candidate.lat) ? candidate.lat.toFixed(4) : '';
  const lng = Number.isFinite(candidate.lng) ? candidate.lng.toFixed(4) : '';
  // Borough participates in the key so two same-named venues in different
  // boroughs stay distinct even when a license row's coordinates are coarse
  // enough to round together.
  const borough = String(
    candidate.borough ?? candidate.county ?? candidate.licenseMatches?.[0]?.county ?? '',
  )
    .trim()
    .toLowerCase();
  return `name:${normalizeName(candidate.name)}:${lat}:${lng}:${borough}`;
}

/** Merge independently generated corridor files without losing provenance. */
export function mergeCoverageCandidates(candidateGroups) {
  const merged = new Map();
  for (const candidate of candidateGroups.flat()) {
    const key = candidateKey(candidate);
    const current = merged.get(key);
    if (!current) {
      merged.set(key, structuredClone(candidate));
      continue;
    }
    current.score = Math.max(current.score ?? 0, candidate.score ?? 0);
    if (candidate.tier === 'likely_bar') current.tier = 'likely_bar';
    current.ratings = Math.max(current.ratings ?? 0, candidate.ratings ?? 0);
    current.rating = current.rating ?? candidate.rating ?? null;
    current.website = current.website ?? candidate.website ?? null;
    current.googleMaps = current.googleMaps ?? candidate.googleMaps ?? null;
    current.sources = [...new Set([...(current.sources ?? []), ...(candidate.sources ?? [])])];
    current.regions = [...new Set([...(current.regions ?? []), ...(candidate.regions ?? [])])];
    current.reasons = [...new Set([...(current.reasons ?? []), ...(candidate.reasons ?? [])])];
    current.queryHits = Math.max(current.queryHits ?? 0, candidate.queryHits ?? 0);
    current.requestedNames = [
      ...new Set([
        ...(current.requestedNames ?? []),
        ...(candidate.requestedNames ?? []),
      ]),
    ];
    current.possibleCatalogMatches = uniqueBy(
      [
        ...(current.possibleCatalogMatches ?? []),
        ...(candidate.possibleCatalogMatches ?? []),
      ].sort((a, b) => (b.similarity ?? 0) - (a.similarity ?? 0)),
      (match) => match.id ?? `${match.name}:${match.similarity}`,
    ).slice(0, 4);
    current.licenseMatches = uniqueBy(
      [...(current.licenseMatches ?? []), ...(candidate.licenseMatches ?? [])],
      (license) => license.id,
    );
  }
  return [...merged.values()].sort(
    (a, b) =>
      (a.tier === b.tier ? 0 : a.tier === 'likely_bar' ? -1 : 1) ||
      (b.score ?? 0) - (a.score ?? 0) ||
      (b.ratings ?? 0) - (a.ratings ?? 0) ||
      a.name.localeCompare(b.name),
  );
}
