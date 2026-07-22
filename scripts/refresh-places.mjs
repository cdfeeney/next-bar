// Weekly Google Places refresh for the Next Bar catalog.
//
// WHY THIS IS ~$0: it makes at most (269 bars × 2) API calls per run. Google's
// free tier resets monthly at 10,000 Place Details + 5,000 Text Search calls.
// A weekly run uses ~1,160 Place Details/month — comfortably free. Users never
// call Google; they read the overlaid catalog. "Open now" is computed client-
// side (src/lib/openNow.ts) from the hours this job stores — never a live call.
//
// FLOW: for each bar, resolve a googlePlaceId (cached after first run via Text
// Search), then Place Details for coords + business status + opening hours.
// Writes the result to src/lib/bars.places.ts (a generated sidecar overlaid in
// bars.ts). Dry-run by default; pass --apply to write the sidecar.
//
// USAGE:  GOOGLE_MAPS_API_KEY=... node scripts/refresh-places.mjs [--apply]
//
// Uses the Places API (New): places:searchText and places/{id} with FieldMasks.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
const APPLY = process.argv.includes('--apply');
const KEY = process.env.GOOGLE_MAPS_API_KEY;
const SIDECAR = path.join(REPO, 'src/lib/bars.places.ts');
const BAR_FILES = ['bars.ts', 'bars.extra.ts', 'bars.expansion.ts', 'bars.expansion2.ts', 'bars.expansion3.ts'];

if (!KEY) {
  console.error('GOOGLE_MAPS_API_KEY is not set. Get a key with the Places API (New) enabled,\n' +
    'then: GOOGLE_MAPS_API_KEY=... node scripts/refresh-places.mjs [--apply]');
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pad = (n) => String(n).padStart(2, '0');

function field(obj, key) {
  const m = obj.match(new RegExp(key + ":\\s*(['\"])((?:[^'\"\\\\]|\\\\.)*)\\1"));
  return m ? m[2].replace(/\\(.)/g, '$1') : null;
}

function parseBars() {
  const bars = [];
  for (const f of BAR_FILES) {
    const t = fs.readFileSync(path.join(REPO, 'src/lib', f), 'utf8');
    const objRe = /\{[^{}]*\}/g;
    let m;
    while ((m = objRe.exec(t))) {
      const o = m[0];
      const id = field(o, 'id'), name = field(o, 'name'), address = field(o, 'address'), neighborhood = field(o, 'neighborhood');
      if (id && name && address) bars.push({ id, name, address, neighborhood });
    }
  }
  return bars;
}

// Reuse already-resolved place ids from the existing sidecar so we skip Text Search.
function loadExistingPlaceIds() {
  const ids = {};
  try {
    const t = fs.readFileSync(SIDECAR, 'utf8');
    const re = /'([^']+)':\s*\{[^}]*googlePlaceId:\s*'([^']+)'/g;
    let m;
    while ((m = re.exec(t))) ids[m[1]] = m[2];
  } catch { /* first run, no sidecar data yet */ }
  return ids;
}

async function resolvePlaceId(bar) {
  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': KEY,
      'X-Goog-FieldMask': 'places.id,places.formattedAddress',
    },
    body: JSON.stringify({ textQuery: `${bar.name}, ${bar.address}` }),
  });
  const j = await res.json();
  return j.places?.[0]?.id ?? null;
}

async function placeDetails(placeId) {
  const res = await fetch(`https://places.googleapis.com/v1/places/${placeId}`, {
    headers: {
      'X-Goog-Api-Key': KEY,
      'X-Goog-FieldMask': 'id,location,businessStatus,regularOpeningHours',
    },
  });
  return res.json();
}

// Google periods -> our WeeklyHours (0=Sun..6=Sat, "HH:MM"; overnight = close<open).
function toWeeklyHours(regularOpeningHours) {
  const periods = regularOpeningHours?.periods;
  if (!Array.isArray(periods)) return undefined;
  const hours = {};
  for (const p of periods) {
    if (!p.open) continue;
    const day = p.open.day;
    const open = `${pad(p.open.hour ?? 0)}:${pad(p.open.minute ?? 0)}`;
    // No close = open 24h that day; represent as 00:00–24:00 fallback.
    const close = p.close ? `${pad(p.close.hour ?? 0)}:${pad(p.close.minute ?? 0)}` : '24:00';
    (hours[day] ||= []).push({ open, close });
  }
  return Object.keys(hours).length ? hours : undefined;
}

(async () => {
  const bars = parseBars();
  const cachedIds = loadExistingPlaceIds();
  console.log(`Refreshing ${bars.length} bars via Google Places (New)${APPLY ? ' [--apply]' : ' [dry-run]'}`);

  const patches = {};
  const flags = [];
  let done = 0, withHours = 0, closed = 0;

  for (const bar of bars) {
    try {
      let placeId = cachedIds[bar.id];
      if (!placeId) { placeId = await resolvePlaceId(bar); await sleep(120); }
      if (!placeId) { flags.push({ id: bar.id, reason: 'no-place-id', q: bar.name }); continue; }

      const d = await placeDetails(placeId);
      await sleep(120);
      const patch = { googlePlaceId: placeId };
      if (d.location?.latitude != null) { patch.lat = d.location.latitude; patch.lng = d.location.longitude; }
      if (d.businessStatus) patch.businessStatus = d.businessStatus;
      const hours = toWeeklyHours(d.regularOpeningHours);
      if (hours) { patch.hours = hours; withHours++; }
      if (d.businessStatus && d.businessStatus !== 'OPERATIONAL') { closed++; flags.push({ id: bar.id, reason: d.businessStatus, name: bar.name }); }
      patches[bar.id] = patch;
    } catch (e) {
      flags.push({ id: bar.id, reason: 'error', detail: String(e.message || e) });
    }
    if (++done % 25 === 0) console.log(`  ${done}/${bars.length}`);
  }

  console.log(`\n=== REFRESH REPORT ===`);
  console.log(`Patched: ${Object.keys(patches).length} | with hours: ${withHours} | non-operational: ${closed} | flags: ${flags.length}`);
  for (const f of flags.slice(0, 20)) console.log(`  - ${f.id} [${f.reason}]${f.name ? ' ' + f.name : ''}${f.detail ? ' ' + f.detail : ''}`);
  fs.writeFileSync(path.join(REPO, 'scripts/refresh-report.json'), JSON.stringify({ patches, flags }, null, 2));

  if (!APPLY) { console.log('\n(dry-run) wrote scripts/refresh-report.json. Re-run with --apply to write the sidecar.'); return; }

  // Regenerate the sidecar wholesale.
  const entries = Object.keys(patches).sort().map((id) => `  '${id}': ${JSON.stringify(patches[id])},`);
  const out = `import type { PlacePatch } from '@/types';\n\n` +
    `// GENERATED by scripts/refresh-places.mjs — do not edit by hand.\n` +
    `export const placesData: Record<string, PlacePatch> = {\n${entries.join('\n')}\n};\n`;
  fs.writeFileSync(SIDECAR, out);
  console.log(`\nAPPLIED: wrote ${Object.keys(patches).length} patches to src/lib/bars.places.ts`);
})();
