/**
 * Is every venue's stored position corroborated by OpenStreetMap?
 *
 * OFFLINE. Zero Google calls. Reads the cached Overpass extract plus our own
 * coordinates (catalog files, and the bars table with --db).
 *
 * HISTORY, because the question this answers changed. Originally this script
 * broke a tie: our hand-authored coordinates said one thing, the coordinates
 * Google returned for its place_id said another, and a same-name OSM node was
 * the independent witness. That sweep found 0 wrong-venue matches and 34 wrong
 * hand-authored positions, which migrations 0029-0032 corrected.
 *
 * Google's coordinates are now gone — they were removed from the sidecar because
 * their terms permit caching lat/lng for only 30 consecutive days — so there is
 * no tie left to break. What remains worth asking is simpler and Google-free:
 *
 *   CORROBORATED  a same-name OSM node sits within 150m of where we have it
 *   SUSPECT       a same-name node exists 150m-2.5km away and none is nearer —
 *                 close enough that a genuine coordinate error is plausible
 *   SAME-NAME-ELSEWHERE
 *                 the only same-name node is kilometres away, which is far more
 *                 likely a different venue sharing a name than a misplaced pin.
 *                 Reported separately so it is not mistaken for a defect list
 *   NO-NODE       OSM has no venue by that name; unverifiable this way
 *
 * USAGE:
 *   npx tsx scripts/audit-osm-witness.mts            # catalog venues
 *   npx tsx scripts/audit-osm-witness.mts --db       # also the bars table
 *   npx tsx scripts/audit-osm-witness.mts --ids a,b  # specific ids
 */
import { config as loadEnv } from 'dotenv';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { normalizeVenueName, type CatalogVenue, type OsmVenue } from '../src/lib/osmMatch';

loadEnv({ path: '.env.local' });

const REPO = process.cwd();
const CACHE_FILE = join(REPO, '.osm-cache', 'nyc-drinking-venues.json');
const BAR_FILES = [
  'bars.core.ts',
  'bars.extra.ts',
  'bars.expansion.ts',
  'bars.expansion2.ts',
  'bars.expansion3.ts',
  'bars.expansion4.ts',
  'bars.expansion5.ts',
  'bars.expansion6.ts',
];

type OverpassElement = {
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
  id?: number;
  type?: string;
};

const osmAddress = new Map<string, string>();

/** Great-circle metres between two points. */
function metresBetween(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function loadOsmVenues(): OsmVenue[] {
  if (!existsSync(CACHE_FILE)) {
    throw new Error(
      `No OSM cache at ${CACHE_FILE}. Run: npx tsx scripts/osm-hours-sweep.mts (it caches the extract).`,
    );
  }
  const { elements } = JSON.parse(readFileSync(CACHE_FILE, 'utf-8')) as {
    elements: OverpassElement[];
  };
  const out: OsmVenue[] = [];
  for (const el of elements) {
    const tags = el.tags ?? {};
    const lat = el.lat ?? el.center?.lat;
    const lng = el.lon ?? el.center?.lon;
    if (typeof lat !== 'number' || typeof lng !== 'number' || !tags.name) continue;
    const osmId = `${el.type ?? 'node'}/${el.id ?? 0}`;
    const addr = [
      [tags['addr:housenumber'], tags['addr:street']].filter(Boolean).join(' '),
      tags['addr:city'],
      tags['addr:postcode'],
    ]
      .filter(Boolean)
      .join(', ');
    if (addr) osmAddress.set(osmId, addr);
    out.push({ osmId, name: tags.name, lat, lng });
  }
  return out;
}

type CatalogRow = CatalogVenue & { address: string };

/**
 * Hand-authored catalog rows straight out of the bar files.
 *
 * Names are matched in BOTH quote styles. The first version of this parser
 * required `name: '...'`, which silently skipped every venue whose name contains
 * an apostrophe — and those are written `name: "Julius'"` with double quotes.
 * That is most of an NYC bar list (Jimmy's Corner, Arthur's Tavern, PJ Clarke's,
 * McAleer's…), and it made 44 perfectly ordinary venues look like they existed
 * only in the database. Same failure as grepping one encoding of a field and
 * concluding the data isn't there.
 */
function loadCatalog(): Map<string, CatalogRow> {
  const map = new Map<string, CatalogRow>();
  const str = String.raw`(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")`;
  for (const file of BAR_FILES) {
    const path = join(REPO, 'src/lib', file);
    if (!existsSync(path)) continue;
    const src = readFileSync(path, 'utf-8');
    const re = new RegExp(
      String.raw`id:\s*${str}\s*,\s*name:\s*${str}[\s\S]{0,400}?address:\s*${str}[\s\S]{0,200}?lat:\s*(-?\d+\.?\d*)\s*,\s*lng:\s*(-?\d+\.?\d*)`,
      'g',
    );
    for (const m of src.matchAll(re)) {
      const unq = (a?: string, b?: string) => (a ?? b ?? '').replace(/\\(['"])/g, '$1');
      const id = unq(m[1], m[2]);
      if (!id) continue;
      map.set(id, {
        id,
        name: unq(m[3], m[4]),
        address: unq(m[5], m[6]),
        lat: Number(m[7]),
        lng: Number(m[8]),
      });
    }
  }
  return map;
}

/** Fill catalog gaps from the bars table. Read-only. */
async function loadFromDb(missing: string[] | null): Promise<Map<string, CatalogRow>> {
  const map = new Map<string, CatalogRow>();
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.log('--db requested but DATABASE_URL is not set in .env.local — skipping DB pass.');
    return map;
  }
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const { rows } = await client.query<{
      id: string;
      name: string;
      address: string | null;
      lat: number;
      lng: number;
    }>(
      missing === null
        ? 'select id, name, address, lat, lng from public.bars'
        : 'select id, name, address, lat, lng from public.bars where id = any($1)',
      missing === null ? [] : [missing],
    );
    for (const r of rows) {
      map.set(r.id, {
        id: r.id,
        name: r.name,
        address: r.address ?? '',
        lat: Number(r.lat),
        lng: Number(r.lng),
      });
    }
    console.log(`DB pass: loaded ${rows.length} row(s) from public.bars.`);
  } finally {
    await client.end();
  }
  return map;
}

async function main() {
  const argv = process.argv.slice(2);
  const osm = loadOsmVenues();
  const catalog = loadCatalog();

  // Index OSM by normalized name so a candidate can be found at ANY distance.
  // matchOsmVenue is not used here: it only returns a hit inside its 150m radius,
  // which cannot distinguish "OSM has never heard of this bar" from "OSM places it
  // half a mile from where we do" — and that second case is the whole point now.
  const byName = new Map<string, OsmVenue[]>();
  for (const v of osm) {
    const key = normalizeVenueName(v.name);
    if (!key) continue;
    byName.set(key, [...(byName.get(key) ?? []), v]);
  }

  const idsArg = argv.indexOf('--ids');
  let ids =
    idsArg !== -1 ? argv[idsArg + 1].split(',') : [...catalog.keys()];

  // The bars table holds venues the hand-authored files never carried (the mass
  // import). Without --db their coordinates are never checked at all.
  if (argv.includes('--db')) {
    for (const [id, row] of await loadFromDb(null)) if (!catalog.has(id)) catalog.set(id, row);
    ids = [...catalog.keys()];
  }

  console.log(
    `OSM witness: ${osm.length} named venues from cache; checking ${ids.length} venue(s). No Google calls.\n`,
  );

  const RADIUS_M = 150;
  /** Beyond this, a same-name node is more likely another venue than our error. */
  const LIKELY_ERROR_M = 2_500;
  const rows: Record<string, string>[] = [];
  const lookup: string[] = [
    ['id', 'name', 'verdict', 'our_address', 'osm_name', 'osm_address', 'osm_link', 'metres', 'osm_lat', 'osm_lng'].join('\t'),
  ];

  for (const id of ids) {
    const cat = catalog.get(id);
    if (!cat) {
      rows.push({ id, verdict: 'SKIP', detail: 'no coordinates available' });
      continue;
    }

    const candidates = byName.get(normalizeVenueName(cat.name)) ?? [];
    let nearest: { osm: OsmVenue; m: number } | null = null;
    for (const c of candidates) {
      const m = metresBetween(cat, c);
      if (!nearest || m < nearest.m) nearest = { osm: c, m };
    }

    let verdict: string;
    let detail: string;
    if (!nearest) {
      verdict = 'NO-NODE';
      detail = 'OSM has no venue under this name';
    } else if (nearest.m <= RADIUS_M) {
      verdict = 'CORROBORATED';
      detail = `OSM "${nearest.osm.name}" ${Math.round(nearest.m)}m away`;
    } else if (nearest.m <= LIKELY_ERROR_M) {
      // Close enough that a genuine mistake is plausible. The worst real error
      // found in this catalog was the-ditty at 2,318m.
      verdict = 'SUSPECT';
      detail = `nearest same-name OSM node is ${Math.round(nearest.m)}m away — our coordinate may be wrong`;
    } else {
      // Kilometres away is far more likely a DIFFERENT venue sharing a name than
      // a misplaced pin: Rockaway Brewing has a taproom and a beach location,
      // Bar Veloce several branches. Calling these suspect would repeat the
      // Tir na nOg / Boxers false positive at scale.
      verdict = 'SAME-NAME-ELSEWHERE';
      detail = `a "${nearest.osm.name}" exists ${(nearest.m / 1000).toFixed(1)}km away — probably a different venue, not a bad coordinate`;
    }
    rows.push({ id, name: cat.name, verdict, detail });

    lookup.push(
      [
        id,
        cat.name,
        verdict,
        cat.address,
        nearest?.osm.name ?? '',
        nearest ? (osmAddress.get(nearest.osm.osmId) ?? '') : '',
        nearest ? `https://www.openstreetmap.org/${nearest.osm.osmId}` : '',
        nearest ? String(Math.round(nearest.m)) : '',
        nearest ? String(nearest.osm.lat) : '',
        nearest ? String(nearest.osm.lng) : '',
      ].join('\t'),
    );
  }

  const order = ['SUSPECT', 'SAME-NAME-ELSEWHERE', 'NO-NODE', 'CORROBORATED', 'SKIP'];
  rows.sort((a, b) => order.indexOf(a.verdict) - order.indexOf(b.verdict));
  for (const r of rows) {
    console.log(`${r.verdict.padEnd(19)} ${String(r.id).padEnd(22)} ${r.detail}`);
  }

  const counts = rows.reduce<Record<string, number>>((acc, r) => {
    acc[r.verdict] = (acc[r.verdict] ?? 0) + 1;
    return acc;
  }, {});
  console.log(`\nSummary: ${JSON.stringify(counts)}`);

  // A spreadsheet-friendly export so a human can eyeball each case: our address,
  // a Google Maps link built from the place_id (shows exactly which venue Google
  // is pointing at — a plain URL, no API call), and the OSM name/address/link.
  const out = join(REPO, '.osm-cache', 'witness-lookup.tsv');
  writeFileSync(out, lookup.join('\n'), 'utf-8');
  console.log(`Lookup table (open in a spreadsheet): ${out}`);
}

await main();
