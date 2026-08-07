/**
 * Split a recall-first coverage queue into accept, lookup, duplicate, and reject
 * decisions. Optional exact Google Text Search converts license-only legal/DBA
 * leads into public venue evidence without treating a liquor license as proof.
 */
import fs from 'node:fs';
import path from 'node:path';
import { config } from 'dotenv';
import {
  BAR_TYPES,
  candidateKey,
  distanceMeters,
  matchesGoogleCounty,
  normalizeName,
} from './lib/coverage-search.mjs';
import {
  BOROUGH_SCOPES,
  adversarialReview,
  reviewNameSimilarity,
} from './lib/coverage-review.mjs';
import { boroughOf, resolveIdentity } from './lib/coverage-identity.mjs';

function parseArgs(argv) {
  const options = { exclude: [] };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--verify-google') {
      options.verifyGoogle = true;
      continue;
    }
    if (arg === '--refresh-verified') {
      options.refreshVerified = true;
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${arg} needs a value`);
    if (arg === '--exclude') options.exclude.push(value);
    else if (['--input', '--env', '--out', '--csv', '--overrides', '--resume', '--verify-limit', '--borough'].includes(arg)) {
      options[arg.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
    } else throw new Error(`unknown option: ${arg}`);
    index += 1;
  }
  return options;
}

let options;
try {
  options = parseArgs(process.argv.slice(2));
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
if (!options.input || !options.out || !options.csv) {
  console.error('usage: node scripts/adversarial-review-coverage.mjs --input <json> --exclude <baseline> [...] --out <json> --csv <csv> [--verify-google]');
  process.exit(1);
}

if (options.borough && !BOROUGH_SCOPES[String(options.borough).toLowerCase()]) {
  console.error(
    `unknown --borough ${options.borough}; expected one of ${Object.keys(BOROUGH_SCOPES).join(', ')}`,
  );
  process.exit(1);
}

/**
 * Review scope for a single row. An explicit --borough pins the whole queue;
 * otherwise the scope follows each candidate's own address or SLA county, so a
 * mixed Manhattan/Brooklyn queue is judged correctly row by row instead of
 * being measured against one borough's assumptions.
 */
function scopeFor(candidate) {
  const borough = options.borough ?? boroughOf(candidate);
  return borough ? { borough } : {};
}

config({ path: options.env ?? '.env.local', quiet: true });
const SUPA = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const GOOGLE_KEY = process.env.GOOGLE_MAPS_API_KEY;
if (!SUPA || !ANON || (options.verifyGoogle && !GOOGLE_KEY)) {
  console.error('required Supabase credentials or Google key are missing');
  process.exit(1);
}

function readJson(file) {
  const value = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
  if (!Array.isArray(value)) throw new Error(`${file} must contain a JSON array`);
  return value;
}

async function fetchJson(url, init, source) {
  let lastError;
  for (let attempt = 0; attempt < 5; attempt++) {
    let response;
    let body;
    try {
      response = await fetch(url, init);
      body = await response.json();
    } catch (error) {
      lastError = error;
      continue;
    }
    if (response.ok && !body?.error) return body;
    const detail = body?.error?.message ?? body?.message ?? response.statusText;
    lastError = new Error(`${source} failed (${response.status}): ${detail}`);
    if (![429, 500, 502, 503, 504].includes(response.status)) throw lastError;
    if (/per day/i.test(detail)) throw lastError;
    if (attempt < 4) {
      const delay = 500 * 3 ** attempt;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}

async function fetchCatalog() {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const page = await fetchJson(
      `${SUPA}/rest/v1/bars?select=id,name,address,lat,lng,place_id&order=id.asc`,
      {
        headers: {
          apikey: ANON,
          Authorization: `Bearer ${ANON}`,
          Range: `${from}-${from + 999}`,
        },
      },
      'catalog read',
    );
    if (!Array.isArray(page) || page.length === 0) break;
    rows.push(...page);
    if (page.length < 1000) break;
  }
  return rows;
}

function catalogMatches(candidate, catalog) {
  if (!Number.isFinite(candidate.lat) || !Number.isFinite(candidate.lng)) return [];
  return catalog
    .map((bar) => {
      if (!Number.isFinite(bar.lat) || !Number.isFinite(bar.lng)) return null;
      const distance = Math.round(
        distanceMeters(
          { latitude: candidate.lat, longitude: candidate.lng },
          { latitude: bar.lat, longitude: bar.lng },
        ),
      );
      if (distance > 60) return null;
      return {
        id: bar.id,
        name: bar.name,
        // Carried so the review can tell "same brand, different venue" from
        // "same venue": without it, an exact name match alone forces duplicate.
        placeId: bar.place_id ?? null,
        distanceMeters: distance,
        nameSimilarity: reviewNameSimilarity(candidate.name, bar.name),
        nameExact: normalizeName(candidate.name) === normalizeName(bar.name),
        placeIdMatch: Boolean(candidate.placeId && candidate.placeId === bar.place_id),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.distanceMeters - b.distanceMeters)
    .slice(0, 5);
}

function addressNumber(value) {
  return String(value ?? '').match(/\b\d+[A-Za-z]?\b/)?.[0]?.toLowerCase() ?? '';
}

function sharesAddressNumber(left, right) {
  const leftNumbers = new Set(
    [...String(left ?? '').matchAll(/\b\d+[A-Za-z]?\b/g)].map((match) => match[0].toLowerCase()),
  );
  return [...String(right ?? '').matchAll(/\b\d+[A-Za-z]?\b/g)].some((match) =>
    leftNumbers.has(match[0].toLowerCase()),
  );
}

async function verifyLicenseLead(candidate, catalogPlaceIds) {
  // Borough comes from the row, not from a hardcoded "Manhattan": pinning the
  // query to one borough is how a Brooklyn lead gets verified against the wrong
  // geography and then rejected for being there.
  const borough = options.borough ?? boroughOf(candidate) ?? '';
  const scope = BOROUGH_SCOPES[String(borough).toLowerCase()] ?? null;
  const localityHint = borough
    ? `${borough.replace(/\b\w/g, (letter) => letter.toUpperCase())} NY`
    : 'New York NY';
  const query = `${candidate.name} ${candidate.address} ${localityHint}`;
  const body = {
    textQuery: query,
    maxResultCount: 5,
    locationBias: {
      circle: {
        center: { latitude: candidate.lat, longitude: candidate.lng },
        radius: 600,
      },
    },
  };
  const json = await fetchJson(
    'https://places.googleapis.com/v1/places:searchText',
    {
      method: 'POST',
      headers: {
        'X-Goog-Api-Key': GOOGLE_KEY,
        'X-Goog-FieldMask':
          'places.id,places.displayName,places.formattedAddress,places.location,places.businessStatus,places.primaryType,places.types,places.rating,places.userRatingCount,places.websiteUri,places.googleMapsUri',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    },
    'Google exact review search',
  );
  const sourceNumber = addressNumber(candidate.address);
  const ranked = (json.places ?? [])
    .filter(
      (place) =>
        (!place.businessStatus || place.businessStatus === 'OPERATIONAL') &&
        matchesGoogleCounty(place.formattedAddress, scope?.county ?? null) &&
        place.location,
    )
    .map((place) => {
      const distance = Math.round(
        distanceMeters(
          { latitude: candidate.lat, longitude: candidate.lng },
          place.location,
        ),
      );
      const similarity = reviewNameSimilarity(candidate.name, place.displayName?.text ?? '');
      const sameAddressNumber = Boolean(
        sourceNumber && sourceNumber === addressNumber(place.formattedAddress),
      );
      const barTyped =
        BAR_TYPES.has(place.primaryType) ||
        (place.types ?? []).some((type) => BAR_TYPES.has(type));
      const rank =
        similarity * 5 +
        (distance <= 30 ? 4 : distance <= 100 ? 2 : distance <= 600 ? 0.5 : -5) +
        (sameAddressNumber ? 2 : 0) +
        (barTyped ? 1 : 0);
      return { place, distance, similarity, sameAddressNumber, rank };
    })
    .filter((item) => item.distance <= 600)
    .sort((a, b) => b.rank - a.rank);
  const best = ranked[0];
  if (!best || best.rank < 3) return null;
  const place = best.place;
  const verifiedCandidate = {
    ...candidate,
    sourceNames: [candidate.name],
    name: place.displayName?.text ?? candidate.name,
    address: place.formattedAddress ?? candidate.address,
    lat: place.location.latitude,
    lng: place.location.longitude,
    placeId: place.id,
    primaryType: place.primaryType ?? '',
    googleTypes: place.types ?? [],
    ratings: place.userRatingCount ?? 0,
    rating: place.rating ?? null,
    website: place.websiteUri ?? null,
    googleMaps: place.googleMapsUri ?? null,
  };
  const decision = catalogPlaceIds.has(place.id)
    ? { decision: 'duplicate', reasons: ['exact Google Place ID already exists in production'] }
    : adversarialReview(verifiedCandidate, [], scopeFor(verifiedCandidate));
  return {
    decision,
    verification: {
      name: place.displayName?.text ?? '',
      address: place.formattedAddress ?? '',
      placeId: place.id,
      primaryType: place.primaryType ?? '',
      googleTypes: place.types ?? [],
      businessStatus: place.businessStatus ?? 'OPERATIONAL',
      rating: place.rating ?? null,
      ratings: place.userRatingCount ?? 0,
      website: place.websiteUri ?? null,
      googleMaps: place.googleMapsUri ?? null,
      lat: place.location.latitude,
      lng: place.location.longitude,
      distanceMeters: best.distance,
      nameSimilarity: best.similarity,
    },
  };
}

function csvCell(value) {
  const text = Array.isArray(value) ? value.join(' | ') : String(value ?? '');
  return `"${text.replaceAll('"', '""')}"`;
}

function finalizeDecisions(rows, catalog, overrides) {
  for (const row of rows) {
    if (!row.verification) continue;
    row.reviewReasons = row.reviewReasons.filter(
      (reason) =>
        !/^(?:Google primary type does not establish a bar|public hybrid venue needs bar-service confirmation|public Google venue with bar type|Google bar type has too little public evidence|verified bar is nearby but neither)/i.test(reason),
    );
    const verifiedRow = {
      ...row,
      name: row.verification.name,
      address: row.verification.address,
      placeId: row.verification.placeId,
      primaryType: row.verification.primaryType,
      googleTypes: row.verification.googleTypes ?? [],
      ratings: row.verification.ratings,
      rating: row.verification.rating,
      website: row.verification.website,
      sourceNames: [row.name],
    };
    const verifiedReview = adversarialReview(verifiedRow, [], scopeFor(verifiedRow));
    row.decision = verifiedReview.decision;
    for (const reason of verifiedReview.reasons) {
      if (!row.reviewReasons.includes(reason)) row.reviewReasons.push(reason);
    }
    if (
      row.decision === 'accept' &&
      row.verification.nameSimilarity === 0 &&
      !sharesAddressNumber(row.address, row.verification.address)
    ) {
      row.decision = 'lookup';
      const reason = 'verified bar is nearby but neither its public name nor street number matches the license lead';
      if (!row.reviewReasons.includes(reason)) row.reviewReasons.push(reason);
    }
    // Per-location, not per-name: a verified venue that merely SHARES a name
    // with a production row is a second location, not a duplicate.
    const identity = resolveIdentity(
      {
        name: row.verification.name,
        placeId: row.verification.placeId,
        address: row.verification.address,
        lat: row.verification.lat,
        lng: row.verification.lng,
      },
      catalog,
    );
    if (identity.verdict === 'duplicate') {
      row.decision = 'duplicate';
      const reason = `verified public venue already exists in production: ${identity.match.name}`;
      if (!row.reviewReasons.includes(reason)) row.reviewReasons.push(reason);
    } else if (identity.verdict === 'ambiguous') {
      row.decision = 'lookup';
      const reason = identity.reason;
      if (!row.reviewReasons.includes(reason)) row.reviewReasons.push(reason);
    }
  }

  const groups = new Map();
  for (const row of rows) {
    const placeId = row.placeId ?? row.verification?.placeId;
    if (!placeId) continue;
    const group = groups.get(placeId) ?? [];
    group.push(row);
    groups.set(placeId, group);
  }
  const decisionRank = new Map([
    ['accept', 0],
    ['lookup', 1],
    ['reject', 2],
    ['duplicate', 3],
  ]);
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    group.sort(
      (a, b) =>
        Number(Boolean(b.placeId)) - Number(Boolean(a.placeId)) ||
        decisionRank.get(a.decision) - decisionRank.get(b.decision),
    );
    const owner = group[0];
    for (const duplicate of group.slice(1)) {
      duplicate.decision = 'duplicate';
      const reason = `same verified Google venue as queue row: ${owner.name}`;
      if (!duplicate.reviewReasons.includes(reason)) duplicate.reviewReasons.push(reason);
    }
  }
  for (const override of overrides) {
    const wanted = normalizeName(override.name);
    const row = rows.find(
      (candidate) =>
        normalizeName(candidate.name) === wanted ||
        normalizeName(candidate.verification?.name) === wanted,
    );
    if (!row || row.decision === 'duplicate') continue;
    row.decision = override.decision;
    row.reviewReasons = row.reviewReasons.filter((reason) => !/^review override:/i.test(reason));
    if (override.decision === 'accept') {
      row.reviewReasons = row.reviewReasons.filter(
        (reason) => !/^public hybrid venue needs bar-service confirmation/i.test(reason),
      );
    }
    const reason = `review override: ${override.reason}`;
    if (!row.reviewReasons.includes(reason)) row.reviewReasons.push(reason);
  }
}

function writeOutputs(rows, catalog, overrides) {
  finalizeDecisions(rows, catalog, overrides);
  const order = new Map([
    ['accept', 0],
    ['lookup', 1],
    ['duplicate', 2],
    ['reject', 3],
  ]);
  rows.sort(
    (a, b) =>
      order.get(a.decision) - order.get(b.decision) ||
      (b.score ?? 0) - (a.score ?? 0) ||
      (b.ratings ?? 0) - (a.ratings ?? 0) ||
      a.name.localeCompare(b.name),
  );
  const resolvedOut = path.resolve(options.out);
  const resolvedCsv = path.resolve(options.csv);
  fs.mkdirSync(path.dirname(resolvedOut), { recursive: true });
  fs.mkdirSync(path.dirname(resolvedCsv), { recursive: true });
  fs.writeFileSync(resolvedOut, `${JSON.stringify(rows, null, 2)}\n`);
  const columns = [
    'decision',
    'name',
    'address',
    'primaryType',
    'score',
    'ratings',
    'reviewReasons',
    'verificationName',
    'verificationType',
    'verificationMaps',
    'nearestProduction',
    'placeId',
  ];
  const lines = [
    columns.join(','),
    ...rows.map((row) =>
      [
        row.decision,
        row.name,
        row.address,
        row.primaryType,
        row.score,
        row.ratings,
        row.reviewReasons,
        row.verification?.name,
        row.verification?.primaryType,
        row.verification?.googleMaps,
        row.catalogMatches?.map((match) => `${match.name} (${match.distanceMeters}m)`) ?? [],
        row.placeId,
      ].map(csvCell).join(','),
    ),
  ];
  fs.writeFileSync(resolvedCsv, `${lines.join('\n')}\n`);
}

const input = readJson(options.input);
const overrides = options.overrides ? readJson(options.overrides) : [];
const excludedKeys = new Set(options.exclude.flatMap((file) => readJson(file).map(candidateKey)));
const candidates = input.filter((candidate) => !excludedKeys.has(candidateKey(candidate)));
const catalog = await fetchCatalog();
const catalogPlaceIds = new Set(catalog.map((bar) => bar.place_id).filter(Boolean));
const rows = candidates.map((candidate) => {
  const matches = catalogMatches(candidate, catalog);
  const review = adversarialReview(candidate, matches, scopeFor(candidate));
  return {
    ...candidate,
    decision: review.decision,
    reviewReasons: review.reasons,
    catalogMatches: matches,
  };
});

if (options.resume) {
  const previous = new Map(readJson(options.resume).map((row) => [candidateKey(row), row]));
  for (const row of rows) {
    const prior = previous.get(candidateKey(row));
    if (!prior) continue;
    if (prior.verification) row.verification = prior.verification;
    if (
      prior.verification ||
      (prior.reviewReasons ?? []).includes('exact Google search found no confident public venue match')
    ) {
      row.decision = prior.decision;
      row.reviewReasons = prior.reviewReasons;
    }
  }
}

const verifyLimit = Number(options.verifyLimit ?? 0);
if (!Number.isFinite(verifyLimit) || verifyLimit < 0) throw new Error('--verify-limit must be non-negative');
if (options.verifyGoogle && verifyLimit > 0) {
  const queue = rows
    .filter((row) => {
      if (options.refreshVerified) {
        return (
          !row.placeId &&
          row.verification &&
          !row.verification.googleTypes
        );
      }
      return (
        row.decision === 'lookup' &&
        !row.placeId &&
        !row.verification &&
        !row.reviewReasons.includes('exact Google search found no confident public venue match')
      );
    })
    .slice(0, verifyLimit);
  let completed = 0;
  for (const candidate of queue) {
    try {
      const result = await verifyLicenseLead(candidate, catalogPlaceIds);
      if (result) {
        candidate.decision = result.decision.decision;
        candidate.reviewReasons = [
          ...candidate.reviewReasons,
          ...result.decision.reasons,
          'exact Google verification completed',
        ];
        candidate.verification = result.verification;
      } else {
        candidate.reviewReasons.push('exact Google search found no confident public venue match');
      }
    } catch (error) {
      console.warn(`verification stopped after ${completed}: ${error.message}`);
      break;
    }
    completed += 1;
    if (completed % 25 === 0) {
      console.log(`verified ${completed}/${queue.length} license leads`);
      writeOutputs(rows, catalog, overrides);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

writeOutputs(rows, catalog, overrides);
const counts = Object.fromEntries(
  ['accept', 'lookup', 'duplicate', 'reject'].map((decision) => [
    decision,
    rows.filter((row) => row.decision === decision).length,
  ]),
);
console.log(`${rows.length} candidates -> ${Object.entries(counts).map(([key, value]) => `${value} ${key}`).join(', ')}`);
console.log(`wrote ${path.resolve(options.out)}`);
console.log(`wrote ${path.resolve(options.csv)}`);
