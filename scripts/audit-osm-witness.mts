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
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { matchOsmVenue, type CatalogVenue, type OsmVenue } from '../src/lib/osmMatch';

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
    out.push({ osmId: `${el.type ?? 'node'}/${el.id ?? 0}`, name: tags.name, lat, lng });
  }
  return out;
}

/** Hand-authored catalog rows: id, name, lat, lng straight out of the bar files. */
function loadCatalog(): Map<string, CatalogVenue> {
  const map = new Map<string, CatalogVenue>();
  for (const file of BAR_FILES) {
    const path = join(REPO, 'src/lib', file);
    if (!existsSync(path)) continue;
    const src = readFileSync(path, 'utf-8');
    const re =
      /\{\s*id:\s*'([^']+)'\s*,\s*name:\s*'((?:[^'\\]|\\.)*)'[\s\S]*?lat:\s*(-?\d+\.?\d*)\s*,\s*lng:\s*(-?\d+\.?\d*)/g;
    for (const m of src.matchAll(re)) {
      map.set(m[1], {
        id: m[1],
        name: m[2].replace(/\\'/g, "'"),
        lat: Number(m[3]),
        lng: Number(m[4]),
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

function main() {
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

  console.log(
    `OSM witness: ${osm.length} named venues from cache; checking ${ids.length} venue(s). No Google calls.\n`,
  );

  const rows: Record<string, string>[] = [];
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
}

main();
