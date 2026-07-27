/**
 * Ground-truth coverage sweep: ask Google Places what bars actually
 * EXIST in a neighborhood, instead of asking a model to remember them.
 *
 * Every sourcing method so far has been recall-based — GLM's training
 * knowledge, Reddit threads, editorial lists — and recall has two
 * failure modes we keep paying for: it misses ordinary neighborhood
 * bars nobody blogs about, and it confidently returns venues that
 * closed years ago. Nearby Search inverts that: it enumerates what is
 * standing at a coordinate right now, typed and status-checked at the
 * source. For a question like "have we missed any bars in Chinatown"
 * this is the only method that can actually answer it.
 *
 * Tiles a set of circles over each target neighborhood (one circle
 * caps at 20 results, so dense areas need overlap) and reports every
 * bar-typed, currently-operational venue that is NOT already in the
 * catalog.
 *
 *   node scripts/nearby-sweep.mjs <hood> [<hood>…] [--radius 400] [--out file.json]
 */
import fs from 'node:fs';
import { config } from 'dotenv';

config({ path: '.env.local' });

const KEY = process.env.GOOGLE_MAPS_API_KEY;
const SUPA = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!KEY || !SUPA || !ANON) {
  console.error('need GOOGLE_MAPS_API_KEY + supabase url/anon key');
  process.exit(1);
}

const args = process.argv.slice(2);
const rIdx = args.indexOf('--radius');
const RADIUS = rIdx !== -1 ? Number(args[rIdx + 1]) : 400;
const oIdx = args.indexOf('--out');
const OUT = oIdx !== -1 ? args[oIdx + 1] : null;
const hoods = args.filter((a, i) => {
  if (a.startsWith('--')) return false;
  if (rIdx !== -1 && i === rIdx + 1) return false;
  if (oIdx !== -1 && i === oIdx + 1) return false;
  return true;
});
if (hoods.length === 0) {
  console.error('usage: node scripts/nearby-sweep.mjs "Chinatown" "Hudson Square" [--radius 400]');
  process.exit(1);
}

// Types to ASK for. Nearby Search matches a place if ANY of its types
// match, which is why an Italian restaurant with a wine list comes back
// under `bar` — so the request is deliberately broad and the PRIMARY
// type below is what actually decides.
const INCLUDED = ['bar', 'pub', 'wine_bar', 'night_club', 'bar_and_grill'];

// A venue only counts if its PRIMARY type is a drinking establishment.
// Without this the sweep is ~75% restaurants (measured: 136 raw hits,
// 34 real bars).
const PRIMARY_BAR_TYPES = new Set([
  'bar', 'pub', 'irish_pub', 'wine_bar', 'night_club', 'bar_and_grill',
  'cocktail_bar', 'sports_bar', 'dive_bar', 'karaoke_bar', 'gastropub',
  'brewery', 'brewpub', 'beer_garden', 'beer_hall', 'taproom', 'distillery',
  'winery', 'pool_hall', 'jazz_club', 'live_music_venue',
]);

// Tile offsets in degrees (~150m lat, ~200m lng at NYC latitude) so a
// neighborhood is covered by overlapping circles rather than one circle
// that silently truncates at 20 results.
const OFFSETS = [
  [0, 0], [0.0018, 0], [-0.0018, 0], [0, 0.0024], [0, -0.0024],
  [0.0018, 0.0024], [0.0018, -0.0024], [-0.0018, 0.0024], [-0.0018, -0.0024],
];

const constants = fs.readFileSync('src/lib/constants.ts', 'utf8');
const centroids = {};
for (const m of constants
  .slice(constants.indexOf('NEIGHBORHOOD_CENTROIDS'))
  .matchAll(/'([^']+)':\s*\{\s*lat:\s*(-?[\d.]+),\s*lng:\s*(-?[\d.]+)\s*\}/g)) {
  centroids[m[1]] ??= { lat: Number(m[2]), lng: Number(m[3]) };
}

const norm = (s) =>
  s.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]/g, '').replace(/^the/, '');

const catalog = await (
  await fetch(`${SUPA}/rest/v1/bars?select=id,name,place_id`, {
    headers: { apikey: ANON, Authorization: `Bearer ${ANON}` },
  })
).json();
const havePid = new Set(catalog.filter((b) => b.place_id).map((b) => b.place_id));
const haveName = new Set(catalog.map((b) => norm(b.name)));
console.log(`catalog: ${catalog.length} venues (${havePid.size} pinned)\n`);

const found = [];
const seen = new Set();
let calls = 0;

for (const hood of hoods) {
  const c = centroids[hood];
  if (!c) {
    console.error(`unknown neighborhood: ${hood}`);
    continue;
  }
  let hoodNew = 0;
  let hoodTotal = 0;
  for (const [dLat, dLng] of OFFSETS) {
    const res = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
      method: 'POST',
      headers: {
        'X-Goog-Api-Key': KEY,
        'X-Goog-FieldMask':
          'places.id,places.displayName,places.formattedAddress,places.location,places.businessStatus,places.primaryType,places.priceLevel,places.rating,places.userRatingCount',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        includedTypes: INCLUDED,
        maxResultCount: 20,
        locationRestriction: {
          circle: {
            center: { latitude: c.lat + dLat, longitude: c.lng + dLng },
            radius: RADIUS,
          },
        },
      }),
    });
    calls++;
    const json = await res.json();
    if (json.error) {
      console.error(`  API error: ${json.error.message}`);
      break;
    }
    for (const p of json.places ?? []) {
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      hoodTotal++;
      if (p.businessStatus && p.businessStatus !== 'OPERATIONAL') continue;
      if (!PRIMARY_BAR_TYPES.has(p.primaryType ?? '')) continue;
      if (havePid.has(p.id)) continue;
      const name = p.displayName?.text ?? '';
      if (!name || haveName.has(norm(name))) continue;
      hoodNew++;
      found.push({
        hood,
        placeId: p.id,
        name,
        address: p.formattedAddress ?? '',
        lat: p.location?.latitude,
        lng: p.location?.longitude,
        primaryType: p.primaryType ?? '',
        priceLevel: p.priceLevel ?? null,
        rating: p.rating ?? null,
        ratings: p.userRatingCount ?? 0,
      });
    }
    await new Promise((r) => setTimeout(r, 60));
  }
  console.log(`${hood}: ${hoodTotal} bar-typed venues seen, ${hoodNew} NOT in catalog`);
}

found.sort((a, b) => (b.ratings ?? 0) - (a.ratings ?? 0));
console.log(`\n${found.length} missing venues across ${hoods.length} hoods (${calls} API calls)\n`);
for (const f of found) {
  console.log(
    `  ${f.hood} | ${f.name} | ${f.address.replace(/, New York.*$/, '')} | ${f.primaryType} | ${f.ratings} ratings`,
  );
}
if (OUT) {
  fs.writeFileSync(OUT, JSON.stringify(found, null, 1));
  console.log(`\nwrote ${OUT}`);
}
