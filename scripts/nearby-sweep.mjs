/**
 * Recall-first bar coverage sweep.
 *
 * Google Nearby alone is not exhaustive: each circle stops at 20 results and
 * a venue such as a hotel rooftop, food-hall counter, or restaurant lounge may
 * have a non-bar primary type. This sweep combines a uniform grid of smaller
 * Nearby searches, diversified Text searches, and the NY SLA active-license
 * dataset. Primary type is evidence for ranking, never a hard rejection.
 *
 * Neighborhood mode:
 *   node scripts/nearby-sweep.mjs Chelsea --out candidates.json
 *
 * Explicit audit box (north,west,south,east):
 *   node scripts/nearby-sweep.mjs \
 *     --bbox 40.753,-74.013,40.738,-73.997 \
 *     --label "Chelsea and Meatpacking Manhattan" \
 *     --out candidates.json
 *
 * Options:
 *   --radius <meters>   Base-level circle (default: the radius that covers one
 *                       cell; subdivided cells always derive their own)
 *   --step <meters>     Base cell size (default 360)
 *   --extent <meters>   Half-size of a neighborhood box (default 900)
 *   --max-depth <n>     Subdivision depth bound (default 2)
 *   --min-cell-meters   Smallest cell the sweep will subdivide to (default 90)
 *   --max-calls <n>     Hard Google call budget; exhausting it is a recorded
 *                       terminal state, never a silent stop
 *   --manifest <path>   Append-only JSONL run manifest (required for --resume)
 *   --resume            Continue an interrupted run from its manifest
 *   --ack-cell <id>     Acknowledge a cell that can never succeed (repeatable);
 *                       needs --manifest and --ack-reason, then exits. This is
 *                       the only way to finish a run containing a permanently
 *                       failing cell, and every waiver is recorded with its
 *                       reason and an operator marker.
 *   --ack-reason <why>  Required with --ack-cell
 *   --nearby-only       Skip diversified Text Search
 *   --text-only         Skip Nearby Search
 *   --no-sla            Skip NY SLA enrichment
 *   --county <name>     Restrict Google/SLA results to an NY county
 *   --env <path>        dotenv file (default .env.local)
 *
 * A run reports "complete" only when every planned cell reached a terminal
 * state, nothing failed or was quota-blocked, and no cell is still saturated.
 * Anything else prints the outstanding work and exits non-zero.
 */
import fs from 'node:fs';
import path from 'node:path';
import { config } from 'dotenv';
import {
  BAR_TYPES,
  bboxAround,
  candidateScore,
  isInsideBbox,
  likelyLicenseName,
  matchesGoogleCounty,
  mergeGooglePlace,
  nearbyLicenses,
  normalizeName,
  parseBbox,
  textQueries,
} from './lib/coverage-search.mjs';
import {
  assertResumable,
  completeness,
  MANIFEST_SCHEMA_VERSION,
  configHash,
  loadManifest,
  openManifest,
  openNewManifest,
} from './lib/coverage-manifest.mjs';
import {
  DEFAULT_SUBDIVISION,
  assertCoversCell,
  estimateCalls,
  radiusForSide,
} from './lib/coverage-subdivide.mjs';
import { planSweep, runSweep } from './lib/coverage-sweep-engine.mjs';
import {
  NEARBY_INCLUDED_TYPES,
  TEXT_ONLY_TYPE_COVERAGE,
  assertTypeCoverage,
} from './lib/coverage-types.mjs';
import { resolveIdentity } from './lib/coverage-identity.mjs';

const VALUE_OPTIONS = new Set([
  '--ack-cell',
  '--ack-reason',
  '--bbox',
  '--county',
  '--env',
  '--extent',
  '--label',
  '--manifest',
  '--max-calls',
  '--max-depth',
  '--min-cell-meters',
  '--names',
  '--out',
  '--radius',
  '--step',
]);
const BOOLEAN_OPTIONS = new Set([
  '--names-only',
  '--nearby-only',
  '--resume',
  '--text-only',
  '--no-sla',
]);
const SLA_CANDIDATE_CLASSES = new Set([
  '0031', // winery
  '0138',
  '0240', // restaurant beer/wine
  '0243', // hotel beer/wine
  '0267',
  '0268',
  '0340', // restaurant liquor
  '0343', // hotel liquor
  '0349', // club
  '0361',
  '0362',
  '0370',
  '0416', // restaurant brewer
  '0417', // cabaret
  '0524', // temporary retail
]);

function parseArgs(argv) {
  const options = { 'ack-cell': [] };
  const positionals = [];
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (VALUE_OPTIONS.has(arg)) {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`${arg} needs a value`);
      if (arg === '--ack-cell') options['ack-cell'].push(value);
      else options[arg.slice(2)] = value;
      index += 1;
    } else if (BOOLEAN_OPTIONS.has(arg)) {
      options[arg.slice(2)] = true;
    } else if (arg.startsWith('--')) {
      throw new Error(`unknown option: ${arg}`);
    } else {
      positionals.push(arg);
    }
  }
  return { options, positionals };
}

let parsed;
try {
  parsed = parseArgs(process.argv.slice(2));
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

const { options, positionals: hoods } = parsed;

/**
 * Acknowledge cells that can never succeed, then exit.
 *
 * Without this there is no way to reach `ack_terminal`: a cell Google will
 * always reject leaves the run permanently `incomplete_failed`, with the
 * completeness gate correctly refusing and the operator holding no lever. This
 * is that lever, and it is deliberately explicit — it names each cell and
 * records a reason, so a waiver is always attributable.
 */
if (options['ack-cell'].length > 0) {
  if (!options.manifest) {
    console.error('--ack-cell requires --manifest <path>');
    process.exit(1);
  }
  if (!options['ack-reason']) {
    console.error('--ack-cell requires --ack-reason "<why this cell can never succeed>"');
    process.exit(1);
  }
  const state = loadManifest(options.manifest);
  if (!state) {
    console.error(`no manifest at ${options.manifest}`);
    process.exit(1);
  }
  const unknown = options['ack-cell'].filter((id) => !state.cells.has(id));
  if (unknown.length > 0) {
    console.error(`manifest has no such cell(s): ${unknown.join(', ')}`);
    process.exit(1);
  }
  const writer = openManifest(options.manifest);
  for (const cellId of options['ack-cell']) {
    writer.ackTerminal(cellId, options['ack-reason'], 'operator');
    writer.done(cellId, 'ack_terminal', { reason: options['ack-reason'] });
    console.log(`acknowledged ${cellId}: ${options['ack-reason']}`);
  }
  writer.close();
  const report = completeness(loadManifest(options.manifest));
  console.log(`manifest status: ${report.status.toUpperCase()} (complete=${report.complete})`);
  process.exit(report.complete ? 0 : 2);
}

config({ path: options.env ?? '.env.local', quiet: true });

const KEY = process.env.GOOGLE_MAPS_API_KEY;
const SUPA = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!KEY || !SUPA || !ANON) {
  console.error('need GOOGLE_MAPS_API_KEY + Supabase URL/anon key');
  process.exit(1);
}
if (options['nearby-only'] && options['text-only']) {
  console.error('--nearby-only and --text-only cannot be combined');
  process.exit(1);
}
if (options['names-only'] && !options.names) {
  console.error('--names-only requires --names <file>');
  process.exit(1);
}

let seedNames = [];
if (options.names) {
  const raw = fs.readFileSync(options.names, 'utf8');
  const parsedNames = raw.trimStart().startsWith('[')
    ? JSON.parse(raw)
    : raw.split(/\r?\n/).filter(Boolean);
  if (!Array.isArray(parsedNames) || parsedNames.some((name) => typeof name !== 'string')) {
    console.error('--names file must be a JSON string array or one name per line');
    process.exit(1);
  }
  seedNames = [...new Set(parsedNames.map((name) => name.trim()).filter(Boolean))];
}

const STEP = Number(options.step ?? 360);
const RADIUS = Number(options.radius ?? radiusForSide(STEP));
const EXTENT = Number(options.extent ?? 900);
const MAX_DEPTH = Number(options['max-depth'] ?? DEFAULT_SUBDIVISION.maxDepth);
const MIN_CELL = Number(options['min-cell-meters'] ?? DEFAULT_SUBDIVISION.minCellMeters);
const MAX_CALLS = Number(options['max-calls'] ?? Infinity);
const OUT = options.out ?? null;
const COUNTY = options.county ?? null;
const MANIFEST = options.manifest ?? null;
const MAX_RESULT_COUNT = 20;
if (![RADIUS, STEP, EXTENT, MIN_CELL].every((value) => Number.isFinite(value) && value > 0)) {
  console.error('radius, step, extent, and min-cell-meters must be positive numbers');
  process.exit(1);
}
if (!Number.isInteger(MAX_DEPTH) || MAX_DEPTH < 0) {
  console.error('--max-depth must be a non-negative integer');
  process.exit(1);
}
if (MAX_CALLS !== Infinity && (!Number.isFinite(MAX_CALLS) || MAX_CALLS <= 0)) {
  console.error('--max-calls must be a positive number');
  process.exit(1);
}
// The gap guard now runs against the level being planned. The old check used
// the base radius only, which said nothing about the subdivided levels where
// coverage actually gets thin.
try {
  assertCoversCell(STEP, RADIUS);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
if (options.resume && !MANIFEST) {
  console.error('--resume requires --manifest <path>');
  process.exit(1);
}

const typeCoverage = assertTypeCoverage();

const constants = fs.readFileSync('src/lib/constants.ts', 'utf8');
const centroids = {};
for (const match of constants
  .slice(constants.indexOf('NEIGHBORHOOD_CENTROIDS'))
  .matchAll(
    /(?:'([^']+)'|"([^"]+)")\s*:\s*\{\s*lat:\s*(-?[\d.]+),\s*lng:\s*(-?[\d.]+)\s*\}/g,
  )) {
  centroids[match[1] ?? match[2]] ??= {
    lat: Number(match[3]),
    lng: Number(match[4]),
  };
}

const regions = [];
if (options.bbox) {
  try {
    regions.push({
      label: options.label ?? 'selected NYC area',
      bbox: parseBbox(options.bbox),
    });
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
for (const hood of hoods) {
  const center = centroids[hood];
  if (!center) {
    console.error(`unknown neighborhood: ${hood}`);
    continue;
  }
  regions.push({
    label: `${hood} Manhattan NYC`,
    bbox: bboxAround(center, EXTENT),
  });
}
if (regions.length === 0) {
  console.error(
    'usage: node scripts/nearby-sweep.mjs <hood> [...] or --bbox north,west,south,east',
  );
  process.exit(1);
}

async function fetchJson(url, init, source) {
  const retryable = new Set([429, 500, 502, 503, 504]);
  let lastError;
  for (let attempt = 0; attempt < 4; attempt++) {
    let response;
    let body;
    try {
      response = await fetch(url, init);
      body = await response.json();
    } catch (error) {
      lastError = error;
      if (attempt < 3) {
        const delayMs = 250 * 3 ** attempt;
        console.warn(`${source} network failure; retrying in ${delayMs}ms`);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
      continue;
    }
    if (response.ok && !body?.error) return body;
    const detail = body?.error?.message ?? body?.message ?? response.statusText;
    lastError = new Error(`${source} failed (${response.status}): ${detail}`);
    if (!retryable.has(response.status)) throw lastError;
    if (attempt === 3) break;
    const delayMs = 250 * 3 ** attempt;
    console.warn(`${source} transient failure; retrying in ${delayMs}ms`);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  throw lastError;
}

async function fetchCatalog() {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const page = await fetchJson(
      `${SUPA}/rest/v1/bars?select=id,name,address,lat,lng,neighborhood,place_id&order=id.asc`,
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

const PLACE_FIELD_MASK =
  'places.id,places.displayName,places.formattedAddress,places.location,places.businessStatus,places.primaryType,places.types,places.priceLevel,places.rating,places.userRatingCount,places.websiteUri,places.googleMapsUri';

/**
 * The transport the engine calls per cell. Nearby restricts to the cell's own
 * covering circle; Text restricts to the cell's VIEWPORT — a text query cannot
 * be de-saturated by a smaller circle, only by a smaller rectangle.
 */
async function googleTransport(cell, includedTypes) {
  if (cell.kind === 'nearby') {
    return fetchJson(
      'https://places.googleapis.com/v1/places:searchNearby',
      {
        method: 'POST',
        headers: {
          'X-Goog-Api-Key': KEY,
          'X-Goog-FieldMask': PLACE_FIELD_MASK,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          includedTypes,
          maxResultCount: MAX_RESULT_COUNT,
          locationRestriction: {
            circle: {
              center: cell.center,
              radius: cell.depth === 0 ? Math.max(RADIUS, cell.radiusMeters) : cell.radiusMeters,
            },
          },
        }),
      },
      'Google Nearby Search',
    );
  }
  return fetchJson(
    'https://places.googleapis.com/v1/places:searchText',
    {
      method: 'POST',
      headers: {
        'X-Goog-Api-Key': KEY,
        'X-Goog-FieldMask': PLACE_FIELD_MASK,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        textQuery: cell.query,
        maxResultCount: MAX_RESULT_COUNT,
        locationRestriction: {
          rectangle: {
            low: { latitude: cell.bbox.south, longitude: cell.bbox.west },
            high: { latitude: cell.bbox.north, longitude: cell.bbox.east },
          },
        },
      }),
    },
    'Google Text Search',
  );
}

/** Keep only operational, in-box, in-county places, and record provenance. */
function collectPlaces(region, places) {
  return (found, cell) => {
    for (const place of found) {
      if (place.businessStatus && place.businessStatus !== 'OPERATIONAL') continue;
      if (
        !isInsideBbox(place.location, region.bbox) ||
        !matchesGoogleCounty(place.formattedAddress, COUNTY)
      ) continue;
      mergeGooglePlace(places, place, {
        kind: cell.kind === 'text' ? 'text' : 'nearby',
        region: region.label,
        cellId: cell.id,
        ...(cell.kind === 'text' ? { query: cell.query } : { center: cell.center }),
      });
    }
  };
}

function regionBias(bbox) {
  const center = {
    latitude: (bbox.north + bbox.south) / 2,
    longitude: (bbox.east + bbox.west) / 2,
  };
  const diagonal = Math.hypot(
    (bbox.north - bbox.south) * 111_320,
    (bbox.east - bbox.west) *
      111_320 *
      Math.cos((center.latitude * Math.PI) / 180),
  );
  return { center, radius: Math.max(500, Math.ceil(diagonal / 2)) };
}


async function searchSeedNames(region, places, meter) {
  const bias = regionBias(region.bbox);
  for (const requestedName of seedNames) {
    let best;
    // Generic names such as "Suite" and "Parlay Cafe" often resolve to a
    // hotel or unrelated business without an explicit bar-intent retry.
    for (const textQuery of [
      `${requestedName} ${region.label}`,
      `${requestedName} bar ${region.label}`,
    ]) {
      // Gate every CALL, not every seed: each seed issues up to two searches,
      // so a per-seed check overshoots the documented hard stop.
      if (meter.calls >= MAX_CALLS) {
        console.error(
          `call budget ${MAX_CALLS} exhausted during seed "${requestedName}"; remaining seeds were not searched`,
        );
        meter.seedBudgetStopped = true;
        return;
      }
      const json = await fetchJson(
        'https://places.googleapis.com/v1/places:searchText',
        {
          method: 'POST',
          headers: {
            'X-Goog-Api-Key': KEY,
            'X-Goog-FieldMask':
              'places.id,places.displayName,places.formattedAddress,places.location,places.businessStatus,places.primaryType,places.types,places.priceLevel,places.rating,places.userRatingCount,places.websiteUri,places.googleMapsUri',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            textQuery,
            maxResultCount: 5,
            locationBias: { circle: bias },
          }),
        },
        'Google exact-name Search',
      );
      meter.calls += 1;
      const ranked = (json.places ?? [])
        .filter(
          (place) =>
            (!place.businessStatus || place.businessStatus === 'OPERATIONAL') &&
            isInsideBbox(place.location, region.bbox) &&
            matchesGoogleCounty(place.formattedAddress, COUNTY),
        )
        .map((place) => {
          const candidateName = place.displayName?.text ?? '';
          const barTyped =
            BAR_TYPES.has(place.primaryType) ||
            (place.types ?? []).some((type) => BAR_TYPES.has(type));
          const exactNormalized =
            normalizeName(requestedName) === normalizeName(candidateName);
          const websiteMatch = normalizeName(place.websiteUri ?? '').includes(
            normalizeName(requestedName),
          );
          const confidence = Math.max(
            exactNormalized ? 1 : 0,
            nameSimilarity(requestedName, candidateName),
            websiteMatch ? 1 : 0,
          );
          return {
            place,
            confidence,
            barTyped,
            rankScore: confidence + (barTyped ? 0.25 : 0),
          };
        })
        .sort((a, b) => b.rankScore - a.rankScore);
      if (!best || (ranked[0]?.rankScore ?? 0) > best.rankScore) {
        best = ranked[0];
      }
      if ((best?.confidence ?? 0) >= 0.6 && best.barTyped) break;
    }
    if (!best || best.confidence < 0.6) continue;
    mergeGooglePlace(places, best.place, {
      kind: 'seed',
      region: region.label,
      requestedName,
      confidence: best.confidence,
    });
  }
}

async function fetchLicenses(region) {
  const select = [
    'licensepermitid',
    'class',
    'description',
    'legalname',
    'dba',
    'actualaddressofpremises',
    'additionaladdressinformation',
    'expirationdate',
    'parentlicenseid',
    'premisescounty',
    'city',
    'georeference',
  ].join(',');
  const { north, west, south, east } = region.bbox;
  const params = new URLSearchParams({
    '$select': select,
    '$where': [
      `within_box(georeference,${north},${west},${south},${east})`,
      COUNTY ? `premisescounty='${COUNTY.replaceAll("'", "''")}'` : null,
    ].filter(Boolean).join(' AND '),
    '$limit': '5000',
  });
  const rows = await fetchJson(
    `https://data.ny.gov/resource/9s3h-dpkz.json?${params}`,
    undefined,
    'NY SLA active-license read',
  );
  return rows
    .filter((row) => Array.isArray(row.georeference?.coordinates))
    .map((row) => ({
      id: row.licensepermitid,
      class: row.class,
      description: row.description,
      legalName: row.legalname ?? '',
      dba: row.dba ?? '',
      address: row.actualaddressofpremises ?? '',
      addressDetail: row.additionaladdressinformation ?? '',
      expires: row.expirationdate ?? null,
      parentLicenseId: row.parentlicenseid ?? null,
      county: row.premisescounty ?? '',
      city: row.city ?? '',
      location: {
        latitude: Number(row.georeference.coordinates[1]),
        longitude: Number(row.georeference.coordinates[0]),
      },
      region: region.label,
    }));
}

function nameTokens(value) {
  return new Set(
    String(value)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .split(' ')
      .filter((token) => token.length > 2 && token !== 'the' && token !== 'nyc'),
  );
}

function nameSimilarity(left, right) {
  const a = nameTokens(left);
  const b = nameTokens(right);
  if (a.size === 0 || b.size === 0) return 0;
  let overlap = 0;
  for (const token of a) if (b.has(token)) overlap += 1;
  return overlap / Math.max(a.size, b.size);
}

const catalog = await fetchCatalog();
const havePlaceId = new Set(
  catalog.filter((bar) => bar.place_id).map((bar) => bar.place_id),
);
console.log(`catalog: ${catalog.length} venues (${havePlaceId.size} pinned)`);
// A seed name is NOT pre-filtered against the catalog by name any more. An
// operator seeding a brand that already has one location is usually asking
// about a DIFFERENT location of it; identity is settled per location below.

const sweepConfig = {
  step: STEP,
  radius: RADIUS,
  maxDepth: MAX_DEPTH,
  minCellMeters: MIN_CELL,
  maxResultCount: MAX_RESULT_COUNT,
  includedTypes: NEARBY_INCLUDED_TYPES,
  county: COUNTY,
  skipNearby: Boolean(options['names-only'] || options['text-only']),
  skipText: Boolean(options['names-only'] || options['nearby-only']),
  regions: regions.map((region) => ({ label: region.label, bbox: region.bbox })),
  textQueriesByRegion: regions.map((region) => textQueries(region.label)),
  seedNames,
};
const hash = configHash(sweepConfig);

let priorState = null;
if (options.resume) {
  priorState = loadManifest(MANIFEST);
  if (!priorState) {
    console.error(`--resume: no manifest at ${MANIFEST}`);
    process.exit(1);
  }
  try {
    assertResumable(priorState, hash);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
  const prior = completeness(priorState);
  console.log(
    `resuming ${MANIFEST} (${prior.summary.finished}/${prior.summary.plannedCells} cells finished, ` +
      `${prior.summary.outstanding} outstanding, ${prior.summary.failed} failed)`,
  );
}

const plannedCells = regions.flatMap((region, index) =>
  planSweep(
    { bbox: region.bbox, key: String(index) },
    { ...sweepConfig, textQueries: sweepConfig.textQueriesByRegion[index] },
  ),
);
const estimate = estimateCalls({
  baseCells: plannedCells.filter((cell) => cell.kind === 'nearby').length,
  maxDepth: MAX_DEPTH,
});
console.log(
  `\nplan: ${plannedCells.length} cells ` +
    `(${plannedCells.filter((cell) => cell.kind === 'nearby').length} nearby, ` +
    `${plannedCells.filter((cell) => cell.kind === 'text').length} text) ` +
    `+ ${seedNames.length} exact-name queries\n` +
    `      ${NEARBY_INCLUDED_TYPES.length} Nearby types requested, ` +
    `${typeCoverage.textOnly.length} bar types covered by Text Search only\n` +
    `      estimated ~${estimate.expected} calls, worst case ${estimate.worstCase}` +
    `${MAX_CALLS === Infinity ? ' (no --max-calls budget set)' : `, budget ${MAX_CALLS}`}`,
);
if (MAX_CALLS === Infinity && plannedCells.length > 400) {
  console.warn(
    'warning: a sweep this size should be run with an explicit --max-calls budget',
  );
}

if (!MANIFEST) {
  console.error('--manifest <path> is required: a run without one cannot report completeness');
  process.exit(1);
}
let manifest;
try {
  // A fresh run must not append its plan onto an existing one: replay() honours
  // the first PLAN, so the new run's cells would be invisible to the
  // completeness check and could inherit the old run's "complete".
  manifest = options.resume ? openManifest(MANIFEST) : openNewManifest(MANIFEST);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
if (!options.resume) {
  manifest.plan({
    configHash: hash,
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    maxCalls: MAX_CALLS === Infinity ? null : MAX_CALLS,
    includedTypes: NEARBY_INCLUDED_TYPES,
    textOnlyTypes: Object.keys(TEXT_ONLY_TYPE_COVERAGE),
    subdivision: { maxDepth: MAX_DEPTH, minCellMeters: MIN_CELL },
    cells: plannedCells.map((cell) => ({
      id: cell.id,
      kind: cell.kind,
      depth: cell.depth,
      sideMeters: cell.sideMeters,
      bbox: cell.bbox,
      center: cell.center,
      radiusMeters: cell.radiusMeters,
      ...(cell.query ? { query: cell.query } : {}),
    })),
  });
}

const places = new Map();
const meter = { calls: 0 };
const regionByKey = new Map(regions.map((region, index) => [String(index), region]));
const sweep = await runSweep({
  cells: plannedCells,
  transport: googleTransport,
  manifest,
  state: priorState,
  maxCalls: MAX_CALLS,
  maxResultCount: MAX_RESULT_COUNT,
  subdivision: { maxDepth: MAX_DEPTH, minCellMeters: MIN_CELL, branching: 4 },
  includedTypes: NEARBY_INCLUDED_TYPES,
  onPlaces: (found, cell) => {
    const region = regionByKey.get(cell.id.split(':')[1]) ?? regions[0];
    collectPlaces(region, places)(found, cell);
  },
});
meter.calls = sweep.callsUsed;
if (sweep.droppedTypes.length > 0) {
  console.warn(
    `Google rejected these includedTypes and they were dropped: ${sweep.droppedTypes.join(', ')}`,
  );
}
for (const region of regions) {
  if (seedNames.length > 0) await searchSeedNames(region, places, meter);
}

const licenseById = new Map();
if (!options['no-sla']) {
  for (const region of regions) {
    for (const license of await fetchLicenses(region)) {
      licenseById.set(license.id, license);
    }
  }
}
const licenses = [...licenseById.values()];

const candidates = [];
const identitySkips = { duplicate: 0, ambiguous: 0 };
for (const place of places.values()) {
  const name = place.displayName?.text ?? '';
  if (!name) continue;
  // Identity is resolved per PHYSICAL LOCATION, not per brand name. The old
  // `haveName.has(normalizeName(name))` gate deleted every second location of
  // a multi-location venue — a real, missing bar with its own Place ID.
  const identity = resolveIdentity(
    {
      name,
      placeId: place.id,
      address: place.formattedAddress ?? '',
      lat: place.location?.latitude,
      lng: place.location?.longitude,
    },
    catalog,
  );
  if (identity.verdict === 'duplicate') {
    identitySkips.duplicate += 1;
    continue;
  }
  if (identity.verdict === 'ambiguous') identitySkips.ambiguous += 1;
  const matches = nearbyLicenses(place, licenses);
  const requestedNames = [
    ...new Set(
      place.evidence
        .filter((item) => item.kind === 'seed')
        .map((item) => item.requestedName),
    ),
  ];
  let ranking = candidateScore(place, matches);
  const needsHumanIdentityCall = identity.verdict === 'ambiguous';
  // An ambiguous identity is a promise that a human will look at this row. The
  // ordinary score gate would drop it instead, which turns "ask someone" back
  // into the silent suppression this whole path exists to avoid.
  if (ranking.score < 2 && requestedNames.length === 0 && !needsHumanIdentityCall) continue;
  if (ranking.score < 2) {
    ranking = {
      score: 2,
      tier: 'review',
      reasons: [
        ...ranking.reasons,
        needsHumanIdentityCall
          ? identity.reason
          : 'explicit external bar seed requires review',
      ],
    };
  } else if (needsHumanIdentityCall) {
    ranking = { ...ranking, tier: 'review', reasons: [...ranking.reasons, identity.reason] };
  }
  const possibleCatalogMatches = catalog
    .map((bar) => ({ id: bar.id, name: bar.name, similarity: nameSimilarity(name, bar.name) }))
    .filter((match) => match.similarity >= 0.5)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, 4);
  candidates.push({
    tier: ranking.tier,
    score: ranking.score,
    name,
    address: place.formattedAddress ?? '',
    lat: place.location?.latitude,
    lng: place.location?.longitude,
    primaryType: place.primaryType ?? '',
    googleTypes: place.types ?? [],
    placeId: place.id,
    sources: [...new Set(place.evidence.map((item) => item.kind))],
    regions: [...new Set(place.evidence.map((item) => item.region))],
    queryHits: place.queryHits,
    requestedNames,
    rating: place.rating ?? null,
    ratings: place.userRatingCount ?? 0,
    website: place.websiteUri ?? null,
    googleMaps: place.googleMapsUri ?? null,
    reasons: ranking.reasons,
    possibleCatalogMatches,
    licenseMatches: matches,
  });
}

// The SLA dataset is also a recall source. Emit only consumer-looking DBA or
// legal names here; unfiltered restaurant licenses would swamp the review file.
for (const license of options['names-only'] ? [] : licenses) {
  // Additional bars enrich the parent premises; liquor stores, groceries,
  // wholesalers, and other off-premises classes are not bar candidates.
  if (!SLA_CANDIDATE_CLASSES.has(license.class)) continue;
  const name = license.dba || license.legalName;
  if (!name || !likelyLicenseName(name)) continue;
  // Same per-location rule as the Google lane: a shared brand name is not a
  // reason to drop a license premises at a different address.
  const licenseRow = {
    name,
    placeId: null,
    address: license.address,
    lat: license.location.latitude,
    lng: license.location.longitude,
    county: license.county,
  };
  if (resolveIdentity(licenseRow, catalog).verdict === 'duplicate') {
    identitySkips.duplicate += 1;
    continue;
  }
  // Within this run, an SLA row is redundant when it is already attached to a
  // Google candidate at the same premises.
  const alreadyCovered = candidates.some(
    (candidate) =>
      (candidate.licenseMatches ?? []).some((match) => match.id === license.id) ||
      (normalizeName(candidate.name) === normalizeName(name) &&
        resolveIdentity(licenseRow, [
          { name: candidate.name, address: candidate.address, lat: candidate.lat, lng: candidate.lng },
        ]).verdict === 'duplicate'),
  );
  if (alreadyCovered) continue;
  const ranking = candidateScore(
    {
      displayName: { text: name },
      primaryType: '',
      types: [],
      queryHits: 0,
    },
    [license],
  );
  candidates.push({
    tier: ranking.tier,
    score: ranking.score,
    name,
    address: license.address,
    lat: license.location.latitude,
    lng: license.location.longitude,
    primaryType: '',
    googleTypes: [],
    placeId: null,
    county: license.county,
    sources: ['sla'],
    regions: [license.region],
    queryHits: 0,
    requestedNames: [],
    rating: null,
    ratings: 0,
    website: null,
    googleMaps: null,
    reasons: ranking.reasons,
    possibleCatalogMatches: [],
    licenseMatches: [license],
  });
}

candidates.sort(
  (a, b) =>
    (a.tier === b.tier ? 0 : a.tier === 'likely_bar' ? -1 : 1) ||
    b.score - a.score ||
    b.ratings - a.ratings ||
    a.name.localeCompare(b.name),
);

const likely = candidates.filter((candidate) => candidate.tier === 'likely_bar').length;
console.log(
  `\n${places.size} unique Google places, ${licenses.length} active-license rows, ${candidates.length} catalog gaps (${likely} likely bars, ${candidates.length - likely} review) from ${meter.calls} Google calls`,
);
console.log(
  `identity: ${identitySkips.duplicate} suppressed as the same physical location, ` +
    `${identitySkips.ambiguous} kept but unlocatable (routed to review)\n`,
);
for (const candidate of candidates) {
  console.log(
    `  ${candidate.tier === 'likely_bar' ? 'LIKELY' : 'REVIEW'} ${candidate.score} | ${candidate.name} | ${candidate.address.replace(/, New York.*$/, '')} | ${candidate.primaryType || candidate.licenseMatches[0]?.description || 'unknown'}`,
  );
}

if (OUT) {
  const resolved = path.resolve(OUT);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, `${JSON.stringify(candidates, null, 2)}\n`);
  console.log(`\nwrote ${resolved}`);
}

// Read the manifest back from disk rather than trusting in-memory state: the
// file is what a resume will see, so it is what the completeness claim must be
// made against.
manifest.close();
const finalState = loadManifest(MANIFEST);
const report = completeness(finalState);
console.log(`\nmanifest: ${MANIFEST}`);
console.log(
  `  ${report.summary.finished}/${report.summary.plannedCells} cells finished, ` +
    `${report.summary.subdivided} subdivided, ${report.summary.uniquePlaceIds} place ids recorded`,
);
// The manifest covers the Nearby and Text lanes. The seed lane is not planned
// as cells, so its own truncation has to be carried into the verdict here or
// "COMPLETE" would be claiming more than the invariant actually checked.
if (meter.seedBudgetStopped) {
  console.error('  status: INCOMPLETE_FAILED — the exact-name seed lane stopped on the call budget');
  console.error(`  resume with: --manifest ${MANIFEST} --resume (and raise --max-calls)`);
  process.exitCode = 2;
} else if (report.complete) {
  const writer = openManifest(MANIFEST);
  writer.runDone(report);
  writer.close();
  console.log(
    `  status: COMPLETE — every planned Nearby/Text cell reached a terminal state` +
      `${seedNames.length > 0 ? `, and all ${seedNames.length} seed names were searched` : ''}`,
  );
} else {
  console.error(`  status: ${report.status.toUpperCase()} — this run did NOT cover its plan`);
  if (report.missing.length > 0) {
    console.error(`    ${report.missing.length} cells never finished (e.g. ${report.missing.slice(0, 3).join(', ')})`);
  }
  if (report.unclearedCap.length > 0) {
    console.error(`    ${report.unclearedCap.length} saturated cells were not cleared by subdivision`);
  }
  if (report.failed.length > 0) {
    console.error(`    ${report.failed.length} cells failed or were quota-blocked`);
  }
  if (report.saturated.length > 0) {
    console.error(
      `    ${report.saturated.length} cells still saturated at the ${MIN_CELL}m floor — recall is short there`,
    );
  }
  console.error(`  resume with: --manifest ${MANIFEST} --resume`);
  process.exitCode = 2;
}
