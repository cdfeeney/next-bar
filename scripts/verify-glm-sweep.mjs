/**
 * Verify a GLM data sweep against Google Places (operator rule
 * 2026-07-27: GLM generates, Claude/Codex only review).
 *
 * GLM produces candidate NAMES from world knowledge — fast and cheap,
 * but it cannot check itself: its Chinatown pass returned restaurants
 * (Wo Hop), venues in the wrong neighborhood (Nitecap is LES), and at
 * least one long-closed bar (Coogan's). So every candidate is settled
 * by an oracle rather than an opinion:
 *
 *   - businessStatus            → drops closed venues
 *   - primaryType / types       → decides "is this actually a bar",
 *                                 deterministically, instead of asking
 *                                 a model to judge its own output
 *   - location                  → decides the NEIGHBORHOOD (nearest
 *                                 centroid), so GLM mis-filing a venue
 *                                 fixes itself instead of rejecting it
 *
 * Input:  scratchpad/glm-*.out  (lines: name | address | price | tags)
 * Output: scratchpad/glm-verified.json (import-ready minus blurb)
 *
 *   node scripts/verify-glm-sweep.mjs <scratchpad-dir> [--limit N]
 */
import fs from 'node:fs';
import path from 'node:path';
import { config } from 'dotenv';

config({ path: '.env.local' });

const DIR = process.argv[2];
const lArg = process.argv.indexOf('--limit');
const LIMIT = lArg !== -1 ? parseInt(process.argv[lArg + 1], 10) : Infinity;
const KEY = process.env.GOOGLE_MAPS_API_KEY;
if (!DIR || !KEY) {
  console.error('usage: node scripts/verify-glm-sweep.mjs <dir>  (needs GOOGLE_MAPS_API_KEY)');
  process.exit(1);
}

// Google place types that make something a drinking venue. `restaurant`
// is deliberately NOT here — a restaurant only qualifies when Google
// ALSO tags it `bar`, which is exactly the "its bar is a destination"
// distinction we want.
const BAR_TYPES = new Set([
  'bar', 'pub', 'wine_bar', 'night_club', 'bar_and_grill', 'brewery',
  'beer_garden', 'beer_hall', 'cocktail_bar', 'sports_bar', 'karaoke_bar',
  'irish_pub', 'dive_bar', 'brewpub', 'taproom', 'distillery', 'winery',
]);

const TAG_VOCAB = new Set([
  'dive','cocktail','wine','beer','dance','lounge','speakeasy','pub','rooftop',
  'garden','club','restaurant-bar','chill','buzzy','loud','locals','post-work',
  'date','tourist','industry','rough','polished','romantic','instagrammable',
  'old-nyc','trendy','indie','hiphop','house','jazz','live','cheap','mid',
  'pricey','splurge',
]);

// Service-area centroids, parsed from the app's own constants so this
// script can never drift from the shipped neighborhood list.
const constants = fs.readFileSync('src/lib/constants.ts', 'utf8');
const block = constants.slice(constants.indexOf('NEIGHBORHOOD_CENTROIDS'));
const CENTROIDS = [];
// Quote-type alternation — a combined ['"] class drops apostrophe
// names like "Hell's Kitchen" entirely.
for (const m of block.matchAll(
  /(?:'([^']+)'|"([^"]+)")\s*:\s*\{\s*lat:\s*(-?[\d.]+),\s*lng:\s*(-?[\d.]+)\s*\}/g,
)) {
  CENTROIDS.push({ hood: m[1] ?? m[2], lat: Number(m[3]), lng: Number(m[4]) });
  if (block.slice(0, m.index).includes('};')) break;
}
if (CENTROIDS.length < 30) {
  console.error(`parsed only ${CENTROIDS.length} centroids — aborting`);
  process.exit(1);
}

function milesBetween(aLat, aLng, bLat, bLng) {
  const R = 3959;
  const rad = (x) => (x * Math.PI) / 180;
  const dLat = rad(bLat - aLat);
  const dLng = rad(bLng - aLng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(h));
}

function nearestHood(lat, lng) {
  let best = null;
  for (const c of CENTROIDS) {
    const d = milesBetween(lat, lng, c.lat, c.lng);
    if (!best || d < best.miles) best = { hood: c.hood, miles: d };
  }
  return best;
}

const slug = (s) =>
  s.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '').slice(0, 60);

// ---- parse every GLM sweep file -------------------------------------
const candidates = [];
const seen = new Set();
for (const file of fs.readdirSync(DIR).filter((f) => /^glm-.*\.out$/.test(f))) {
  for (const raw of fs.readFileSync(path.join(DIR, file), 'utf8').split('\n')) {
    const parts = raw.split('|').map((p) => p.trim());
    if (parts.length !== 4) continue;
    const [name, address, price, tagStr] = parts;
    if (!name || !address || !/^[1-4]$/.test(price)) continue;
    if (/^name$/i.test(name) || name.includes('example')) continue;
    // GLM is inconsistent about the tag separator between runs (commas
    // one call, spaces the next) — accept either rather than silently
    // dropping a whole sweep to zero usable tags.
    const tags = tagStr
      .split(/[,\s]+/)
      .map((t) => t.trim())
      .filter((t) => TAG_VOCAB.has(t));
    if (tags.length < 2) continue;
    const key = slug(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    candidates.push({ id: key, name, address, priceTier: Number(price), tags });
  }
}
console.log(`${candidates.length} unique candidates parsed from GLM sweeps`);

// ---- Google adjudication --------------------------------------------
const kept = [];
const dropped = [];
let calls = 0;
for (const c of candidates.slice(0, LIMIT)) {
  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'X-Goog-Api-Key': KEY,
      'X-Goog-FieldMask':
        'places.id,places.displayName,places.formattedAddress,places.location,places.businessStatus,places.regularOpeningHours,places.primaryType,places.types',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ textQuery: `${c.name}, ${c.address}, New York, NY` }),
  });
  calls++;
  const json = await res.json();
  const p = (json.places ?? [])[0];
  if (!p) {
    dropped.push([c.name, 'no Google match']);
    continue;
  }
  if (p.businessStatus === 'CLOSED_PERMANENTLY') {
    dropped.push([c.name, 'CLOSED_PERMANENTLY']);
    continue;
  }
  const types = new Set([p.primaryType, ...(p.types ?? [])].filter(Boolean));
  const isBar = [...types].some((t) => BAR_TYPES.has(t));
  if (!isBar) {
    dropped.push([c.name, `not a bar (${p.primaryType ?? 'unknown'})`]);
    continue;
  }
  const { latitude: lat, longitude: lng } = p.location ?? {};
  if (typeof lat !== 'number' || typeof lng !== 'number') {
    dropped.push([c.name, 'no coordinates']);
    continue;
  }
  const near = nearestHood(lat, lng);
  // Outside every serviced neighborhood by a wide margin = not our city.
  if (near.miles > 1.2) {
    dropped.push([c.name, `${near.miles.toFixed(1)}mi from nearest hood (${near.hood})`]);
    continue;
  }
  kept.push({
    id: c.id,
    name: p.displayName?.text ?? c.name,
    neighborhood: near.hood,
    address: p.formattedAddress ?? c.address,
    lat,
    lng,
    priceTier: c.priceTier,
    tags: c.tags,
    placeId: p.id,
    hours: p.regularOpeningHours ? { raw: p.regularOpeningHours } : null,
    businessStatus: p.businessStatus ?? null,
    lastVerified: new Date().toISOString().slice(0, 10),
  });
  await new Promise((r) => setTimeout(r, 80));
}

fs.writeFileSync(path.join(DIR, 'glm-verified.json'), JSON.stringify(kept, null, 1));
console.log(`\nKEPT ${kept.length} / DROPPED ${dropped.length}  (${calls} Google calls)`);
const byHood = {};
kept.forEach((k) => (byHood[k.neighborhood] = (byHood[k.neighborhood] ?? 0) + 1));
console.log('kept by hood: ' + JSON.stringify(byHood));
console.log('\ndropped:');
for (const [n, why] of dropped) console.log(`  x ${n} — ${why}`);
