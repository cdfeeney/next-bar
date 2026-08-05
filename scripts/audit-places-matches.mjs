// Audit the Google Places matches behind the photo/hours sidecar
// (operator report 2026-07-27: at least one bar shows a photo of a
// DIFFERENT venue — a wrong-venue Text Search match that landed inside
// the service area, so the bbox guard never caught it).
//
// OFFLINE pass (default, zero API calls): for every sidecar entry,
//   1. distance between the HAND-AUTHORED catalog coords (bar files)
//      and the Places-resolved coords (sidecar) — a big move means Text
//      Search matched somewhere else;
//   2. whether any photoAttribution matches the bar's own name (venue-
//      owned photos are attributed to the venue; a match is a strong
//      "right venue" signal, absence alone is weak).
// Prints a SUSPECT table sorted by distance. Re-ingest confirmed-bad ids
// with:  node scripts/refresh-places.mjs --only <ids> --apply --photos --force-photos
// (delete the stale <id>*.jpg files first so --photos refetches).
//
// USAGE: node scripts/audit-places-matches.mjs [--miles 0.15]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
const SIDECAR = path.join(REPO, 'src/lib/bars.places.ts');
const BAR_FILES = ['bars.ts', 'bars.core.ts', 'bars.extra.ts', 'bars.expansion.ts', 'bars.expansion2.ts', 'bars.expansion3.ts', 'bars.expansion4.ts', 'bars.expansion5.ts', 'bars.expansion6.ts'];

const MILES_ARG = process.argv.indexOf('--miles');
const THRESHOLD_MILES = MILES_ARG !== -1 ? parseFloat(process.argv[MILES_ARG + 1]) : 0.15;

// Same quote-alternation parser as refresh-places (2026-07-27 fix) —
// apostrophe bars must not be invisible to the audit either.
function field(obj, key) {
  const m = obj.match(
    new RegExp(
      key + ':\\s*(?:\'((?:[^\'\\\\]|\\\\.)*)\'|"((?:[^"\\\\]|\\\\.)*)")',
    ),
  );
  const raw = m ? (m[1] !== undefined ? m[1] : m[2]) : null;
  return raw === null ? null : raw.replace(/\\(.)/g, '$1');
}

function numField(obj, key) {
  const m = obj.match(new RegExp(key + ':\\s*(-?\\d+(?:\\.\\d+)?)'));
  return m ? parseFloat(m[1]) : null;
}

function parseBars() {
  const bars = {};
  for (const f of BAR_FILES) {
    const t = fs.readFileSync(path.join(REPO, 'src/lib', f), 'utf8');
    const objRe = /\{[^{}]*\}/g;
    let m;
    while ((m = objRe.exec(t))) {
      const o = m[0];
      const id = field(o, 'id');
      const name = field(o, 'name');
      const lat = numField(o, 'lat');
      const lng = numField(o, 'lng');
      if (id && name && lat !== null && lng !== null) {
        bars[id] = { id, name, lat, lng };
      }
    }
  }
  return bars;
}

function loadPatches() {
  const patches = {};
  const t = fs.readFileSync(SIDECAR, 'utf8');
  const re = /^\s*'([^']+)':\s*(\{.*\}),$/gm;
  let m;
  while ((m = re.exec(t))) {
    try {
      patches[m[1]] = JSON.parse(m[2]);
    } catch {
      /* hand-edited line; skip */
    }
  }
  return patches;
}

function haversineMiles(a, b) {
  const R = 3958.8;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

const normalize = (s) =>
  s
    .toLowerCase()
    .replace(/['’.&]/g, '')
    .replace(/\bthe\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();

function attributionMatchesName(patch, name) {
  const attrs = [
    ...(patch.photoAttributions ?? []),
    ...(patch.photoAttribution ? [patch.photoAttribution] : []),
  ];
  const n = normalize(name);
  return attrs.some((a) => {
    const an = normalize(String(a));
    return an.includes(n) || n.includes(an);
  });
}

const bars = parseBars();
const patches = loadPatches();

// RETIRED 2026-07-29 — this audit's input no longer exists.
//
// It compared our hand-authored coordinates against the ones Google returned,
// both read from the sidecar. Google's coordinates were removed from the sidecar
// because their terms permit caching lat/lng for at most 30 consecutive days
// (migrations 0029-0032 moved every coordinate onto OpenStreetMap).
//
// So `patch.lat` is now always undefined, every entry hit the `continue` below,
// and this script printed "Audited 0 sidecar matches … No coordinate-divergence
// suspects" — a CLEAN REPORT while checking nothing. That is worse than being
// broken: a green result nobody can distinguish from a real pass. Found by
// /review-routed.
//
// It fails loudly instead. The replacement is scripts/audit-osm-witness.mts,
// which asks the same question without Google: is our stored position
// corroborated by a same-name OpenStreetMap node?
{
  const withCoords = Object.values(patches).filter(
    (p) => p.lat !== undefined && p.lng !== undefined,
  ).length;
  if (withCoords === 0) {
    console.error(
      'audit-places-matches: RETIRED — the sidecar no longer stores Google coordinates,\n' +
        `so there is nothing to compare (${Object.keys(patches).length} entries, 0 with coords).\n` +
        'This script used to report "0 suspects" here, which read as a pass.\n\n' +
        'Use instead:  npx tsx scripts/audit-osm-witness.mts --db',
    );
    process.exit(2);
  }
}

const suspects = [];
let audited = 0;

for (const [id, patch] of Object.entries(patches)) {
  const bar = bars[id];
  if (!bar || patch.lat === undefined || patch.lng === undefined) continue;
  audited++;
  const miles = haversineMiles(bar, { lat: patch.lat, lng: patch.lng });
  const attrMatch = attributionMatchesName(patch, bar.name);
  if (miles >= THRESHOLD_MILES) {
    suspects.push({
      id,
      name: bar.name,
      miles: +miles.toFixed(3),
      photos: patch.photoCount ?? (patch.photoRef ? 1 : 0),
      venueAttribution: attrMatch ? 'yes' : 'no',
    });
  }
}

suspects.sort((a, b) => b.miles - a.miles);
console.log(
  `Audited ${audited} sidecar matches against hand-authored catalog coords ` +
    `(threshold ${THRESHOLD_MILES}mi).\n`,
);
if (suspects.length === 0) {
  console.log('No coordinate-divergence suspects.');
} else {
  console.log(
    `${suspects.length} SUSPECT match(es) — Places resolved far from the ` +
      `catalog location ("venueAttribution: yes" = a photo credit matches ` +
      `the bar's own name, which argues the match is fine):\n`,
  );
  console.table(suspects);
}
