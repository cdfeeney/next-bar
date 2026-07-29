/**
 * Cross-check suspect Google Places matches against OpenStreetMap.
 *
 * OFFLINE. Zero Google calls, zero quota spend. Reads the cached Overpass
 * extract in .osm-cache/ and the two coordinate sets we already hold.
 *
 * WHY THIS WORKS. scripts/refresh-places.mjs resolved every venue with a Google
 * Text Search on `"{name}, {address}"` and took `places[0]` blindly — no
 * locationBias, no locationRestriction, no check that the result is anywhere
 * near where our catalog says the bar is. Two NYC bars sharing a name is enough
 * to silently get the wrong one, which is how at least one venue ended up
 * showing a different bar's photos (operator report 2026-07-27).
 *
 * So we have two competing claims about where a venue is:
 *   - our HAND-AUTHORED catalog coordinates (src/lib/bars.*.ts)
 *   - the coordinates GOOGLE returned for the place_id it chose
 *
 * OpenStreetMap is the independent witness that breaks the tie. For each venue
 * we ask the same question twice: is there a same-name OSM node near THIS point?
 *
 *   near catalog, not near Google  -> GOOGLE MATCHED THE WRONG VENUE
 *   near Google, not near catalog  -> our catalog coordinates are the imprecise ones
 *   near both                      -> they agree; the distance is not meaningful
 *   near neither                   -> inconclusive, needs a human
 *
 * This is exactly the reasoning migration 0026 used to settle three cases
 * ("established from the cached OpenStreetMap data as an independent witness —
 * no Google call, no quota spend"), generalised so it can be re-run.
 *
 * USAGE:
 *   npx tsx scripts/audit-osm-witness.mts              # the 13 priority suspects
 *   npx tsx scripts/audit-osm-witness.mts --all        # every sidecar entry
 *   npx tsx scripts/audit-osm-witness.mts --ids a,b,c  # specific venue ids
 *   npx tsx scripts/audit-osm-witness.mts --all --db   # also cover DB-only venues
 *
 * --db adds venues that have a sidecar entry but NO row in src/lib/bars.*.ts.
 * They are real rows in the `bars` table (the mass import added venues the
 * hand-authored files never carried), so without it they are simply skipped and
 * their coordinates go unchecked. The query is a read-only SELECT.
 */
import { config as loadEnv } from 'dotenv';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { matchOsmVenue, type CatalogVenue, type OsmVenue } from '../src/lib/osmMatch';

loadEnv({ path: '.env.local' });

const REPO = process.cwd();
const CACHE_FILE = join(REPO, '.osm-cache', 'nyc-drinking-venues.json');
const SIDECAR = join(REPO, 'src/lib/bars.places.ts');
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

/** The uncorroborated suspects from audit-places-matches.mjs. */
const PRIORITY = [
  'the-double-windsor',
  'the-sampler',
  'the-levee',
  'letlove-inn',
  'boxers-chelsea',
  'bohemian-hall',
  'the-narrows',
  'wylies',
  'icon-bar',
  'dominies-hoek',
  'cronin-phelans',
  'lic-bar',
  'rustik-tavern',
  // Far but photo-credit-corroborated — included because 1.44mi deserves a look.
  'the-ditty',
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

/** Google-resolved coordinates, keyed by venue id, from the generated sidecar. */
function loadSidecar(): Map<string, { lat: number; lng: number; placeId: string }> {
  const src = readFileSync(SIDECAR, 'utf-8');
  const map = new Map<string, { lat: number; lng: number; placeId: string }>();
  const re = /'([^']+)':\s*(\{.*?\}),?\n/g;
  for (const m of src.matchAll(re)) {
    try {
      const patch = JSON.parse(m[2]) as {
        lat?: number;
        lng?: number;
        googlePlaceId?: string;
      };
      if (typeof patch.lat === 'number' && typeof patch.lng === 'number') {
        map.set(m[1], {
          lat: patch.lat,
          lng: patch.lng,
          placeId: patch.googlePlaceId ?? '',
        });
      }
    } catch {
      /* hand-edited line; skip */
    }
  }
  return map;
}

/** Fill catalog gaps from the bars table. Read-only. */
async function loadFromDb(missing: string[]): Promise<Map<string, CatalogRow>> {
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
    }>('select id, name, address, lat, lng from public.bars where id = any($1)', [missing]);
    for (const r of rows) {
      map.set(r.id, {
        id: r.id,
        name: r.name,
        address: r.address ?? '',
        lat: Number(r.lat),
        lng: Number(r.lng),
      });
    }
    console.log(`DB pass: recovered ${rows.length} of ${missing.length} venue(s) absent from the catalog files.`);
  } finally {
    await client.end();
  }
  return map;
}

async function main() {
  const argv = process.argv.slice(2);
  const osm = loadOsmVenues();
  const catalog = loadCatalog();
  const sidecar = loadSidecar();

  const idsArg = argv.indexOf('--ids');
  const ids =
    idsArg !== -1
      ? argv[idsArg + 1].split(',')
      : argv.includes('--all')
        ? [...sidecar.keys()]
        : PRIORITY;

  // Venues with a sidecar entry but no row in the hand-authored files exist only
  // in the `bars` table (the mass import added venues the catalog never carried).
  // Without this pass their coordinates are never checked at all.
  if (argv.includes('--db')) {
    const missing = ids.filter((id) => !catalog.has(id));
    if (missing.length > 0) {
      for (const [id, row] of await loadFromDb(missing)) catalog.set(id, row);
    }
  }

  console.log(
    `OSM witness: ${osm.length} named venues from cache; checking ${ids.length} venue(s). No Google calls.\n`,
  );

  const rows: Record<string, string>[] = [];
  const lookup: string[] = [
    ['id','name','verdict','our_address','google_maps_link','osm_name','osm_address','osm_link','osm_metres_from_google','osm_lat','osm_lng','our_metres_from_osm'].join('	'),
  ];
  for (const id of ids) {
    const cat = catalog.get(id);
    const goo = sidecar.get(id);
    if (!cat || !goo) {
      rows.push({ id, verdict: 'SKIP', detail: !cat ? 'not in catalog files' : 'no sidecar entry' });
      continue;
    }

    const atCatalog = matchOsmVenue(cat, osm);
    const atGoogle = matchOsmVenue({ ...cat, lat: goo.lat, lng: goo.lng }, osm);

    const c = atCatalog.outcome === 'matched' ? Math.round(atCatalog.meters) : null;
    const g = atGoogle.outcome === 'matched' ? Math.round(atGoogle.meters) : null;

    let verdict: string;
    let detail: string;
    if (c !== null && g === null) {
      verdict = 'GOOGLE WRONG';
      detail = `OSM "${atCatalog.osm.name}" ${c}m from our coords; nothing at Google's`;
    } else if (c === null && g !== null) {
      verdict = 'CATALOG COORDS OFF';
      detail = `OSM "${atGoogle.osm.name}" ${g}m from Google's coords; nothing at ours`;
    } else if (c !== null && g !== null) {
      verdict = 'AGREE';
      detail = `OSM near both (ours ${c}m, Google ${g}m)`;
    } else {
      verdict = 'INCONCLUSIVE';
      detail = `no same-name OSM node near either (${atCatalog.reason ?? ''})`;
    }
    rows.push({ id, name: cat.name, verdict, detail });

    const osmHit =
      atGoogle.outcome === 'matched'
        ? atGoogle.osm
        : atCatalog.outcome === 'matched'
          ? atCatalog.osm
          : null;
    const metres = g !== null ? String(g) : c !== null ? `${c} (from ours)` : '';
    lookup.push(
      [
        id,
        cat.name,
        verdict,
        cat.address,
        goo.placeId ? `https://www.google.com/maps/place/?q=place_id:${goo.placeId}` : '',
        osmHit?.name ?? '',
        osmHit ? (osmAddress.get(osmHit.osmId) ?? '') : '',
        osmHit ? `https://www.openstreetmap.org/${osmHit.osmId}` : '',
        metres,
        osmHit ? String(osmHit.lat) : '',
        osmHit ? String(osmHit.lng) : '',
        osmHit ? String(Math.round(metresBetween(cat, osmHit))) : '',
      ].join('	'),
    );
  }

  const order = ['GOOGLE WRONG', 'CATALOG COORDS OFF', 'INCONCLUSIVE', 'AGREE', 'SKIP'];
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
