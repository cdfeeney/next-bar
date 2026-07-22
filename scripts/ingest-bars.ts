/**
 * Bar ingestion pipeline.
 *
 * Pulls real bars/pubs for each target neighborhood from a pluggable source,
 * dedupes against the existing catalog (src/lib/bars.ts), seeds heuristic
 * vibe tags from the source signals, and writes candidates to
 * `scripts/data/candidates.json` for a curation pass.
 *
 * Sources:
 *   - osm    (default) — OpenStreetMap Overpass API. Free, no key.
 *   - google           — Google Places Nearby Search. Richer (price, rating,
 *                         types) but needs GOOGLE_MAPS_API_KEY (Places API).
 *
 * Usage (from project root):
 *   npx tsx scripts/ingest-bars.ts                 # OSM, all areas
 *   npx tsx scripts/ingest-bars.ts --source=google # Google Places
 *   npx tsx scripts/ingest-bars.ts --area=Williamsburg
 *
 * The output is intentionally a *candidate* list, not final catalog entries:
 * a human/AI curation step picks the keepers and refines tags + blurbs before
 * they land in bars.ts. Real businesses → claims must be reviewed (PRD R4).
 */

import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUT_PATH = join(__dirname, 'data', 'candidates.json');

// ---- Target areas (name + centroid + search radius in meters) --------------

type Area = { name: string; lat: number; lng: number; radius: number };

const AREAS: Area[] = [
  // Manhattan — denser fill of existing neighborhoods.
  { name: 'LES', lat: 40.717, lng: -73.987, radius: 700 },
  { name: 'East Village', lat: 40.727, lng: -73.984, radius: 700 },
  { name: 'West Village', lat: 40.735, lng: -74.003, radius: 700 },
  { name: 'Chelsea', lat: 40.747, lng: -74.001, radius: 800 },
  { name: 'Midtown', lat: 40.755, lng: -73.984, radius: 800 },
  { name: 'FiDi', lat: 40.706, lng: -74.009, radius: 800 },
  { name: 'UWS', lat: 40.787, lng: -73.975, radius: 900 },
  { name: 'UES', lat: 40.774, lng: -73.961, radius: 900 },
  // Brooklyn — new coverage.
  { name: 'Williamsburg', lat: 40.714, lng: -73.957, radius: 1000 },
  { name: 'Greenpoint', lat: 40.73, lng: -73.951, radius: 900 },
  { name: 'Bushwick', lat: 40.694, lng: -73.921, radius: 1100 },
  { name: 'Park Slope', lat: 40.672, lng: -73.979, radius: 1000 },
];

// ---- Common shapes ---------------------------------------------------------

type RawVenue = {
  name: string;
  area: string;
  lat: number;
  lng: number;
  address?: string;
  priceTier?: 1 | 2 | 3 | 4;
  rating?: number;
  signals: string[]; // amenity/types/cuisine/etc — used for heuristic tagging
};

type Candidate = RawVenue & {
  id: string;
  tags: string[];
};

// ---- Source: OpenStreetMap Overpass ---------------------------------------

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

async function fetchOsm(area: Area): Promise<RawVenue[]> {
  const q = `[out:json][timeout:25];
(
  node["amenity"="bar"]["name"](around:${area.radius},${area.lat},${area.lng});
  node["amenity"="pub"]["name"](around:${area.radius},${area.lat},${area.lng});
);
out body 80;`;
  // Overpass throttles aggressively (429) and times out under load (504).
  // Retry with exponential backoff before giving up on an area.
  let res: Response | null = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    res = await fetch(OVERPASS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
        'User-Agent': 'next-bar-ingest/1.0 (https://next-bar-two.vercel.app)',
      },
      body: 'data=' + encodeURIComponent(q),
    });
    if (res.ok) break;
    if (res.status === 429 || res.status === 504) {
      await sleep(3000 * Math.pow(2, attempt)); // 3s, 6s, 12s, 24s
      continue;
    }
    break;
  }
  if (!res || !res.ok) {
    throw new Error(`Overpass ${area.name}: HTTP ${res ? res.status : 'no-response'}`);
  }
  const data = (await res.json()) as {
    elements: Array<{
      lat: number;
      lon: number;
      tags?: Record<string, string>;
    }>;
  };
  const venues: RawVenue[] = [];
  for (const el of data.elements) {
    const t = el.tags ?? {};
    if (!t.name) continue;
    const signals = [
      t.amenity,
      t.cuisine,
      t.bar,
      t.real_ale,
      t['drink:cocktail'] ? 'cocktail' : '',
      t.microbrewery ? 'microbrewery' : '',
      t.live_music ? 'live_music' : '',
      t.rooftop ? 'rooftop' : '',
    ].filter(Boolean) as string[];
    const addr = [t['addr:housenumber'], t['addr:street']]
      .filter(Boolean)
      .join(' ');
    venues.push({
      name: t.name,
      area: area.name,
      lat: el.lat,
      lng: el.lon,
      address: addr || undefined,
      signals,
    });
  }
  return venues;
}

// ---- Source: Google Places Nearby Search ----------------------------------

async function fetchGoogle(area: Area): Promise<RawVenue[]> {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) {
    throw new Error(
      'GOOGLE_MAPS_API_KEY not set. Create one at https://console.cloud.google.com ' +
        '(enable "Places API"), then re-run with --source=google.',
    );
  }
  const url = new URL(
    'https://maps.googleapis.com/maps/api/place/nearbysearch/json',
  );
  url.searchParams.set('location', `${area.lat},${area.lng}`);
  url.searchParams.set('radius', String(area.radius));
  url.searchParams.set('type', 'bar');
  url.searchParams.set('key', key);

  const venues: RawVenue[] = [];
  let pagetoken: string | undefined;
  for (let page = 0; page < 3; page++) {
    if (pagetoken) url.searchParams.set('pagetoken', pagetoken);
    const res = await fetch(url);
    const data = (await res.json()) as {
      status: string;
      error_message?: string;
      next_page_token?: string;
      results: Array<{
        name: string;
        vicinity?: string;
        price_level?: number;
        rating?: number;
        types?: string[];
        geometry: { location: { lat: number; lng: number } };
      }>;
    };
    if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
      throw new Error(`Google ${area.name}: ${data.status} ${data.error_message ?? ''}`);
    }
    for (const r of data.results) {
      venues.push({
        name: r.name,
        area: area.name,
        lat: r.geometry.location.lat,
        lng: r.geometry.location.lng,
        address: r.vicinity,
        priceTier: r.price_level
          ? (Math.min(4, Math.max(1, r.price_level)) as 1 | 2 | 3 | 4)
          : undefined,
        rating: r.rating,
        signals: r.types ?? [],
      });
    }
    pagetoken = data.next_page_token;
    if (!pagetoken) break;
    // Google requires a short delay before a page token becomes valid.
    await sleep(2000);
  }
  return venues;
}

// ---- Heuristic vibe tagging ------------------------------------------------

const SIGNAL_TAGS: Record<string, string[]> = {
  pub: ['pub', 'beer'],
  bar: [],
  night_club: ['dance', 'loud', 'house', 'buzzy'],
  microbrewery: ['beer', 'indie'],
  cocktail: ['cocktail'],
  wine: ['wine', 'chill'],
  beer: ['beer'],
  live_music: ['live', 'buzzy'],
  rooftop: ['rooftop', 'instagrammable'],
};

const NAME_TAGS: Array<[RegExp, string[]]> = [
  [/rooftop|sky|terrace/i, ['rooftop', 'instagrammable']],
  [/wine|vinyl|enoteca/i, ['wine', 'chill']],
  [/jazz|blue note|lounge/i, ['jazz', 'live', 'lounge']],
  [/tavern|ale house|public house|pub/i, ['pub', 'old-nyc', 'beer']],
  [/speakeasy|hidden|secret|parlou?r/i, ['speakeasy', 'cocktail']],
  [/dive/i, ['dive', 'cheap', 'rough']],
  [/cocktail|apothecary|bitters/i, ['cocktail', 'polished']],
  [/beer|brew|hops|tap/i, ['beer', 'buzzy']],
  [/garden|biergarten|backyard/i, ['garden', 'chill']],
];

function priceToTag(tier?: number): string[] {
  if (tier === 1) return ['cheap'];
  if (tier === 2) return ['mid'];
  if (tier === 3) return ['pricey'];
  if (tier === 4) return ['splurge'];
  return ['mid'];
}

function heuristicTags(v: RawVenue): string[] {
  const tags = new Set<string>();
  for (const s of v.signals) for (const t of SIGNAL_TAGS[s] ?? []) tags.add(t);
  for (const [re, ts] of NAME_TAGS) if (re.test(v.name)) ts.forEach((t) => tags.add(t));
  priceToTag(v.priceTier).forEach((t) => tags.add(t));
  if (tags.size === 0) tags.add('cocktail'); // safe generic default
  return [...tags];
}

// ---- Dedupe + normalize ----------------------------------------------------

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/['']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function loadExistingNames(): Set<string> {
  const src = readFileSync(join(ROOT, 'src', 'lib', 'bars.ts'), 'utf8');
  const names = new Set<string>();
  for (const m of src.matchAll(/name:\s*['"]([^'"]+)['"]/g)) {
    names.add(m[1].toLowerCase());
  }
  return names;
}

// ---- Main ------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function parseArgs(): { source: 'osm' | 'google'; area?: string } {
  const args = process.argv.slice(2);
  let source: 'osm' | 'google' = 'osm';
  let area: string | undefined;
  for (const a of args) {
    if (a.startsWith('--source=')) source = a.slice(9) as 'osm' | 'google';
    if (a.startsWith('--area=')) area = a.slice(7);
  }
  return { source, area };
}

async function main() {
  const { source, area } = parseArgs();
  const areas = area ? AREAS.filter((a) => a.name === area) : AREAS;
  if (areas.length === 0) {
    console.error(`No area named "${area}". Options: ${AREAS.map((a) => a.name).join(', ')}`);
    process.exit(1);
  }

  const existing = loadExistingNames();
  const fetchFn = source === 'google' ? fetchGoogle : fetchOsm;
  console.log(`Ingesting ${areas.length} area(s) via ${source}…`);

  // Accumulate across runs: load any prior candidates so re-running gap areas
  // fills holes instead of overwriting the whole file.
  const candidates: Candidate[] = [];
  try {
    const prior = JSON.parse(readFileSync(OUT_PATH, 'utf8')) as Candidate[];
    candidates.push(...prior);
  } catch {
    // no prior file — fine
  }

  const seen = new Set<string>(existing);
  for (const c of candidates) seen.add(c.name.toLowerCase());

  for (const a of areas) {
    try {
      const venues = await fetchFn(a);
      let kept = 0;
      for (const v of venues) {
        const key = v.name.toLowerCase();
        if (seen.has(key)) continue; // dedupe vs existing + within run
        seen.add(key);
        candidates.push({
          ...v,
          id: slugify(v.name),
          tags: heuristicTags(v),
        });
        kept++;
      }
      console.log(`  ${a.name}: ${venues.length} found, ${kept} new`);
    } catch (err) {
      console.error(`  ${a.name}: ${(err as Error).message}`);
    }
    if (source === 'osm') await sleep(1200); // be kind to Overpass
  }

  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, JSON.stringify(candidates, null, 2));
  console.log(`\n${candidates.length} candidates → ${OUT_PATH}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
