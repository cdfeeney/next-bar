// Weekly Google Places refresh for the Next Bar catalog.
//
// WHY THIS IS ~$0 (cost notes, B5 update):
//   - WEEKLY pass: at most (269 bars × 2) API calls per run — Text Search only
//     on first resolve (cached after), then Place Details. The mask pulls
//     `regularOpeningHours` + `photos`; opening-hours puts each Details call
//     in Google's ENTERPRISE tier (Codex cost review 2026-07-24), so a truly
//     weekly cadence (~1,160/mo) can exceed the ~1,000/mo Enterprise free cap
//     and cost a few $/mo — NOT $0 as an earlier note claimed. Mitigation:
//     nothing schedules this script (no cron/CI — verified), so cost is only
//     incurred on manual runs; run hours-refresh ~monthly, not weekly, and
//     the per-day quota bounds worst case. Photos field is metadata (no call).
//   - PHOTOS (--photos, weekly): one GetPhotoMedia call per bar WITH a photo
//     AND no local file yet (≤269 first run, ~0 after — existing files are
//     skipped unless --force-photos). Inside the Photos SKU free tier.
//   - REVIEWS (--reviews, MONTHLY — do NOT run weekly): adds the `reviews`
//     field to the same Place Details request. Reviews bill at the
//     Enterprise(+Atmosphere) tier whose free allowance is ~1,000 calls/mo;
//     269 calls monthly ≈ ¼ of it → $0, weekly (~1,160/mo) would COST.
//     Between --reviews runs the sidecar's stored reviews are carried forward
//     untouched.
//   Users never call Google; they read the overlaid catalog. "Open now" is
//   computed client-side (src/lib/openNow.ts) from the hours this job stores.
//
// FLOW: for each bar, resolve a googlePlaceId (cached after first run via Text
// Search), then Place Details for business status + opening hours + primary photo
// name. Writes the result to src/lib/bars.places.ts, a generated sidecar overlaid
// in bars.ts. Dry-run by default; pass --apply to write the sidecar.
//
// COORDINATES ARE NOT WRITTEN (2026-07-29). Google permits caching lat/lng for at
// most 30 consecutive days; this sidecar is committed to git and shipped to every
// client, so storing them was non-compliant by construction. Coordinates come
// from OpenStreetMap instead (migrations 0029-0032). place_id is the one
// Google-derived field exempt from those caching restrictions, so it stays.
//
// The wrong-venue bbox guard MOVED HERE from bars.ts as a result: a Details
// response whose coordinates fall outside the service area is discarded before
// anything is written, rather than being shipped and filtered on read. Strictly
// stronger — the bad data never reaches a client.
//
// PHOTO FORMAT (dependency-free choice): GetPhotoMedia's media redirect serves
// JPEG bytes; we re-encode them to WebP and save to
// public/bar-photos/<barId>.webp (phone speed, 2026-07-27 — raw JPEGs
// averaged 124 KB, WebP at the same width is less than half), and
// src/lib/barVisual.ts's barImageUrl() returns the matching .webp path. If a
// dep is ever added, change BOTH places together.
//
// USAGE:
//   GOOGLE_MAPS_API_KEY=... node scripts/refresh-places.mjs [--apply]
//     [--photos]        download missing bar photos to public/bar-photos/
//                       (writes image files even in dry-run — additive + skip-
//                       if-present; the sidecar itself still needs --apply)
//     [--force-photos]  re-download photos that already exist locally
//     [--reviews]       MONTHLY pass: also fetch up to 3 review snippets/bar
//
// Uses the Places API (New): places:searchText, places/{id} with FieldMasks,
// and {photoName}/media for photo bytes.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { refuseIfUnattended } from './loop-guard.mjs';

// Never spend Google quota during the unattended overnight loop.
refuseIfUnattended('Google Places refresh');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
const APPLY = process.argv.includes('--apply');
const PHOTOS = process.argv.includes('--photos');
// --photos-multi (2026-07-25, operator-authorized): one-time carousel
// ingest. Standalone mode — iterates the EXISTING sidecar (no Text Search,
// closed bars skipped), re-reads Details with a photos-only field mask for
// up to PHOTO_MULTI_COUNT photo names, downloads the extras as
// <barId>-<i>.webp (photo 1 keeps <barId>.webp), and MERGES photoRefs +
// per-photo photoAttributions into the sidecar (never wholesale — hours/
// reviews are preserved untouched). Budget at 3 photos/bar: ~240
// GetPlaceRequest + <=~480 GetPhotoMedia — inside the 1500/600 daily caps
// and the monthly free tier. --limit N smoke-tests on N bars first.
const PHOTOS_MULTI = process.argv.includes('--photos-multi');
// --only id1,id2 : restrict the MAIN refresh to specific bar ids (targeted
// enrichment for newly-added bars — a couple of calls instead of a full
// sweep). Existing sidecar entries for other bars are carried forward
// untouched on --apply.
const ONLY_ARG = process.argv.indexOf('--only');
const ONLY = ONLY_ARG !== -1 ? new Set(process.argv[ONLY_ARG + 1].split(',')) : null;
const LIMIT_ARG = process.argv.indexOf('--limit');
const LIMIT = LIMIT_ARG !== -1 ? parseInt(process.argv[LIMIT_ARG + 1], 10) : Infinity;
const PHOTO_MULTI_COUNT = 3;
const FORCE_PHOTOS = process.argv.includes('--force-photos');

// ─── FROZEN 2026-07-27 (Phase 1 compliance) ─────────────────────────────
// Only the PHOTO-DOWNLOAD paths are frozen; hours/status refresh still
// runs, because that data is fetched live rather than re-hosted. Writing
// Google photo bytes to our own storage is redistribution of their
// licensed Content — see src/lib/mediaPolicy.ts.
if ((PHOTOS || PHOTOS_MULTI) && process.env.ALLOW_GOOGLE_PHOTO_INGEST !== '1') {
  console.error('FROZEN: --photos / --photos-multi are disabled (Phase 1 compliance).');
  console.error('Other refresh modes still work. Override: ALLOW_GOOGLE_PHOTO_INGEST=1');
  process.exit(2);
}
// ────────────────────────────────────────────────────────────────────────
const REVIEWS = process.argv.includes('--reviews');

// ─── FROZEN 2026-07-28 (Phase 1 compliance, criterion 16) ───────────────
// --reviews requested Google review TEXT and author names, wrote them to the
// sidecar, and from there seed-bars-table.mts persisted them into the
// bars.reviews column. Places terms do not permit storing review content, and
// unlike hours it cannot be re-derived from a first-party source — it is
// someone else's copyrighted text about someone else's venue.
//
// Operator decision 2026-07-28: the product does not need review snippets, so
// the cheapest correct fix is to stop ingesting them entirely rather than
// build a compliant alternative.
if (REVIEWS && process.env.ALLOW_GOOGLE_REVIEW_INGEST !== '1') {
  console.error('FROZEN: --reviews is disabled (Phase 1 compliance, criterion 16).');
  console.error('Other refresh modes still work. Override: ALLOW_GOOGLE_REVIEW_INGEST=1');
  process.exit(2);
}
// ────────────────────────────────────────────────────────────────────────
const KEY = process.env.GOOGLE_MAPS_API_KEY;
const SIDECAR = path.join(REPO, 'src/lib/bars.places.ts');
const PHOTO_DIR = path.join(REPO, 'public/bar-photos');
const PHOTO_MAX_WIDTH = 640;
const WEBP_QUALITY = 78;
const REVIEW_MAX = 3;
const REVIEW_EXCERPT_CHARS = 200;
// Drift fix 2026-07-25: bars.core.ts was MISSING after the bars.ts split
// (bars.ts is assembly-only — contributed zero entries here, silently
// skipping ~40 core bars every refresh). Keep in lockstep with bars.ts
// imports AND catalog.slim.ts AND review-mining-apply BAR_FILES.
const BAR_FILES = ['bars.ts', 'bars.core.ts', 'bars.extra.ts', 'bars.expansion.ts', 'bars.expansion2.ts', 'bars.expansion3.ts', 'bars.expansion4.ts', 'bars.expansion5.ts', 'bars.expansion6.ts'];

if (!KEY) {
  console.error('GOOGLE_MAPS_API_KEY is not set. Get a key with the Places API (New) enabled,\n' +
    'then: GOOGLE_MAPS_API_KEY=... node scripts/refresh-places.mjs [--apply]');
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pad = (n) => String(n).padStart(2, '0');

function field(obj, key) {
  // Quote-type-specific alternation (operator bug 2026-07-27): the old
  // single character class excluded BOTH quote chars from the content,
  // so `name: "Jimmy's Corner"` — an apostrophe inside double quotes —
  // never matched and 14 bars were SILENTLY skipped by every ingest
  // (no placeId, no hours, no photos).
  const m = obj.match(
    new RegExp(
      key + ':\\s*(?:\'((?:[^\'\\\\]|\\\\.)*)\'|"((?:[^"\\\\]|\\\\.)*)")',
    ),
  );
  const raw = m ? (m[1] !== undefined ? m[1] : m[2]) : null;
  return raw === null ? null : raw.replace(/\\(.)/g, '$1');
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

// Parse the existing generated sidecar back into patch objects. Entry values
// are JSON.stringify output (see the writer below), so JSON.parse round-trips.
// Used to (a) reuse resolved place ids and skip Text Search, and (b) carry
// stored reviews forward on runs that don't pass --reviews — the sidecar is
// regenerated wholesale, so without this a weekly run would wipe the monthly
// review data.
function loadExistingPatches() {
  const patches = {};
  try {
    const t = fs.readFileSync(SIDECAR, 'utf8');
    const re = /^\s*'([^']+)':\s*(\{.*\}),$/gm;
    let m;
    while ((m = re.exec(t))) {
      try { patches[m[1]] = JSON.parse(m[2]); } catch { /* hand-edited line; skip */ }
    }
  } catch { /* first run, no sidecar data yet */ }
  return patches;
}

/**
 * The app's service area, mirrored from src/lib/constants.ts SERVICE_AREA_BBOX.
 *
 * Duplicated rather than imported because this is a plain .mjs script and the
 * constant lives in TypeScript. A test (bars.test.ts) asserts the two agree, so
 * the copy cannot drift silently.
 */
const SERVICE_AREA = { minLat: 40.640, maxLat: 40.885, minLng: -74.030, maxLng: -73.890 };

function insideServiceArea(lat, lng) {
  return (
    lat >= SERVICE_AREA.minLat && lat <= SERVICE_AREA.maxLat &&
    lng >= SERVICE_AREA.minLng && lng <= SERVICE_AREA.maxLng
  );
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
  // `photos` = first photo resource name + authorAttributions (metadata only).
  // `reviews` is added ONLY on the monthly --reviews pass (Enterprise tier —
  // see cost notes in the header).
  const fields = 'id,location,businessStatus,regularOpeningHours,photos' + (REVIEWS ? ',reviews' : '');
  const res = await fetch(`https://places.googleapis.com/v1/places/${placeId}`, {
    headers: {
      'X-Goog-Api-Key': KEY,
      'X-Goog-FieldMask': fields,
    },
  });
  return res.json();
}

// Trim a review to a ≤N-char excerpt on a word boundary with an ellipsis.
function excerpt(text, max) {
  const t = String(text).replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > max / 2 ? cut.slice(0, lastSpace) : cut) + '…';
}

// Google review objects -> up to REVIEW_MAX stored snippets.
function toReviews(reviews) {
  if (!Array.isArray(reviews)) return undefined;
  const out = reviews
    .map((r) => ({
      text: excerpt(r.text?.text ?? r.originalText?.text ?? '', REVIEW_EXCERPT_CHARS),
      author: r.authorAttribution?.displayName ?? 'Google user',
      rating: typeof r.rating === 'number' ? r.rating : 0,
    }))
    .filter((r) => r.text)
    .slice(0, REVIEW_MAX);
  return out.length ? out : undefined;
}

// Download one bar's photo via GetPhotoMedia. The endpoint 302-redirects to
// the image bytes; fetch follows the redirect, and we save the (JPEG) bytes
// then re-encoded to WebP before writing (see PHOTO FORMAT header note).
async function downloadPhoto(photoRef, file) {
  const url = `https://places.googleapis.com/v1/${photoRef}/media?maxWidthPx=${PHOTO_MAX_WIDTH}&key=${KEY}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`photo media HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length === 0) throw new Error('photo media returned 0 bytes');
  const webp = await sharp(buf).webp({ quality: WEBP_QUALITY, effort: 5 }).toBuffer();
  fs.writeFileSync(file, webp);
  return webp.length;
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
  if (PHOTOS_MULTI) {
    await runPhotosMulti();
    return;
  }
  let bars = parseBars();
  const existing = loadExistingPatches();
  if (ONLY) {
    bars = bars.filter((b) => ONLY.has(b.id));
    console.log(`--only: restricted to ${bars.map((b) => b.id).join(', ')}`);
  }
  const modes = [APPLY ? '--apply' : 'dry-run', PHOTOS && '--photos', FORCE_PHOTOS && '--force-photos', REVIEWS && '--reviews'].filter(Boolean).join(' ');
  console.log(`Refreshing ${bars.length} bars via Google Places (New) [${modes}]`);

  const patches = {};
  const flags = [];
  let done = 0, withHours = 0, closed = 0, withPhoto = 0, withReviews = 0;

  for (const bar of bars) {
    try {
      let placeId = existing[bar.id]?.googlePlaceId;
      if (!placeId) { placeId = await resolvePlaceId(bar); await sleep(120); }
      if (!placeId) { flags.push({ id: bar.id, reason: 'no-place-id', q: bar.name }); continue; }

      const d = await placeDetails(placeId);
      await sleep(120);
      const patch = { googlePlaceId: placeId };

      // COORDINATES ARE NOT PERSISTED, and the wrong-venue guard moved HERE.
      //
      // Google's terms permit caching lat/lng for at most 30 consecutive days;
      // only place_id may be kept indefinitely. This sidecar is a generated file
      // committed to git and shipped to every client, so anything written here
      // outlives that window by design. Coordinates now come from OpenStreetMap
      // (migrations 0029-0032) and are held in the catalog files and the bars
      // table, where they have no expiry.
      //
      // bars.ts used to run the bbox check at RUNTIME on these coordinates and
      // drop the entire patch — hours, photos, everything — when Google had
      // resolved the wrong venue. Removing the coordinates would have removed
      // that protection too, so the check runs here instead: a wrong-venue match
      // is now discarded at generation and never reaches the file at all, which
      // is strictly better than shipping it and filtering on read.
      const lat = d.location?.latitude;
      const lng = d.location?.longitude;
      if (lat != null && lng != null && !insideServiceArea(lat, lng)) {
        flags.push({ id: bar.id, reason: 'outside-service-area', q: `${lat},${lng}` });
        continue;
      }
      if (d.businessStatus) patch.businessStatus = d.businessStatus;
      const hours = toWeeklyHours(d.regularOpeningHours);
      if (hours) { patch.hours = hours; withHours++; }

      // First photo: resource name + author attribution (required on render).
      const photo = d.photos?.[0];
      if (photo?.name) {
        patch.photoRef = photo.name;
        const attr = photo.authorAttributions?.[0]?.displayName;
        if (attr) patch.photoAttribution = attr;
        withPhoto++;
      }

      // Reviews: fresh on a --reviews run; otherwise carry the sidecar's
      // stored snippets forward so the weekly wholesale regen can't wipe them.
      const reviews = REVIEWS ? toReviews(d.reviews) : existing[bar.id]?.reviews;
      if (reviews) { patch.reviews = reviews; withReviews++; }

      if (d.businessStatus && d.businessStatus !== 'OPERATIONAL') { closed++; flags.push({ id: bar.id, reason: d.businessStatus, name: bar.name }); }
      patches[bar.id] = patch;
    } catch (e) {
      flags.push({ id: bar.id, reason: 'error', detail: String(e.message || e) });
    }
    if (++done % 25 === 0) console.log(`  ${done}/${bars.length}`);
  }

  // --photos: fetch missing photo files. Additive + idempotent (skip when the
  // file exists unless --force-photos), so it runs even in dry-run; only the
  // sidecar write is gated on --apply.
  if (PHOTOS) {
    fs.mkdirSync(PHOTO_DIR, { recursive: true });
    let downloaded = 0, skipped = 0;
    for (const [id, patch] of Object.entries(patches)) {
      if (!patch.photoRef) continue;
      const file = path.join(PHOTO_DIR, `${id}.webp`);
      if (fs.existsSync(file) && !FORCE_PHOTOS) { skipped++; continue; }
      try {
        await downloadPhoto(patch.photoRef, file);
        downloaded++;
        await sleep(120);
      } catch (e) {
        flags.push({ id, reason: 'photo-error', detail: String(e.message || e) });
      }
    }
    console.log(`Photos: downloaded ${downloaded}, skipped ${skipped} existing (public/bar-photos/)`);
  }

  console.log(`\n=== REFRESH REPORT ===`);
  console.log(`Patched: ${Object.keys(patches).length} | with hours: ${withHours} | with photo: ${withPhoto} | with reviews: ${withReviews} | non-operational: ${closed} | flags: ${flags.length}`);
  for (const f of flags.slice(0, 20)) console.log(`  - ${f.id} [${f.reason}]${f.name ? ' ' + f.name : ''}${f.detail ? ' ' + f.detail : ''}`);
  fs.writeFileSync(path.join(REPO, 'scripts/refresh-report.json'), JSON.stringify({ patches, flags }, null, 2));

  if (!APPLY) { console.log('\n(dry-run) wrote scripts/refresh-report.json. Re-run with --apply to write the sidecar.'); return; }

  // Regenerate the sidecar — wholesale normally; MERGED under --only so a
  // targeted run can't wipe every other bar's data.
  const finalPatches = ONLY ? { ...existing, ...patches } : patches;
  const entries = Object.keys(finalPatches).sort().map((id) => `  '${id}': ${JSON.stringify(finalPatches[id])},`);
  const out = `import type { PlacePatch } from '@/types';\n\n` +
    `// GENERATED by scripts/refresh-places.mjs — do not edit by hand.\n` +
    `export const placesData: Record<string, PlacePatch> = {\n${entries.join('\n')}\n};\n`;
  fs.writeFileSync(SIDECAR, out);
  console.log(`\nAPPLIED: wrote ${Object.keys(patches).length} patches to src/lib/bars.places.ts`);
})();


// --photos-multi implementation (see flag comment).
async function runPhotosMulti() {
  const existing = loadExistingPatches();
  fs.mkdirSync(PHOTO_DIR, { recursive: true });
  const ids = Object.keys(existing)
    .filter((id) => existing[id].googlePlaceId)
    .filter((id) => existing[id].businessStatus !== 'CLOSED_PERMANENTLY')
    // --only support (2026-07-25): targeted ingest for newly-landed bars
    // instead of a full-sidecar sweep re-paying ~400 details calls.
    .filter((id) => !ONLY || ONLY.has(id))
    .sort()
    .slice(0, LIMIT);
  console.log(`photos-multi: ${ids.length} bars, up to ${PHOTO_MULTI_COUNT} photos each${Number.isFinite(LIMIT) ? ` (--limit ${LIMIT})` : ''}`);

  const flags = [];
  const allRefs = {};
  let details = 0, media = 0, skippedFiles = 0, updated = 0;

  for (const id of ids) {
    const patch = existing[id];
    try {
      const d = await placeDetailsPhotosOnly(patch.googlePlaceId);
      details++;
      await sleep(120);
      const photos = Array.isArray(d.photos) ? d.photos.slice(0, PHOTO_MULTI_COUNT) : [];
      if (photos.length === 0) { flags.push({ id, reason: 'no-photos' }); continue; }

      const refs = [];
      const attrs = [];
      for (let i = 0; i < photos.length; i++) {
        const p = photos[i];
        if (!p?.name) continue;
        refs.push(p.name);
        attrs.push(p.authorAttributions?.[0]?.displayName ?? '');
        const file = path.join(PHOTO_DIR, i === 0 ? `${id}.webp` : `${id}-${i + 1}.webp`);
        if (fs.existsSync(file) && !FORCE_PHOTOS) { skippedFiles++; continue; }
        try {
          await downloadPhoto(p.name, file);
          media++;
          await sleep(150);
        } catch (e) {
          flags.push({ id, reason: 'photo-error', detail: `photo ${i + 1}: ${String(e.message || e)}` });
        }
      }
      if (refs.length > 0) {
        // MERGE into the existing entry — photo 1 fields stay for
        // back-compat with every current consumer.
        patch.photoCount = refs.length;
        patch.photoAttributions = attrs;
        allRefs[id] = refs;
        patch.photoRef = refs[0];
        if (attrs[0]) patch.photoAttribution = attrs[0];
        updated++;
      }
    } catch (e) {
      flags.push({ id, reason: 'error', detail: String(e.message || e) });
    }
    if ((details) % 25 === 0) console.log(`  ${details}/${ids.length}`);
  }

  console.log(`\n=== PHOTOS-MULTI REPORT ===`);
  console.log(`details calls: ${details} | media downloads: ${media} | files skipped (existing): ${skippedFiles} | patches updated: ${updated} | flags: ${flags.length}`);
  for (const f of flags.slice(0, 20)) console.log(`  - ${f.id} [${f.reason}]${f.detail ? ' ' + f.detail : ''}`);

  if (!APPLY) { console.log('\n(dry-run) downloads done; re-run with --apply to write the sidecar merge.'); return; }
  const entries = Object.keys(existing).sort().map((k) => `  '${k}': ${JSON.stringify(existing[k])},`);
  const out = `import type { PlacePatch } from '@/types';\n\n` +
    `// GENERATED by scripts/refresh-places.mjs — do not edit by hand.\n` +
    `export const placesData: Record<string, PlacePatch> = {\n${entries.join('\n')}\n};\n`;
  fs.writeFileSync(SIDECAR, out);
  console.log(`APPLIED: merged multi-photo data into src/lib/bars.places.ts (${updated} entries)`);
}

// Details with a photos-only field mask — cheaper mental model, same SKU.
async function placeDetailsPhotosOnly(placeId) {
  const res = await fetch(`https://places.googleapis.com/v1/places/${placeId}`, {
    headers: {
      'X-Goog-Api-Key': KEY,
      'X-Goog-FieldMask': 'id,photos',
    },
  });
  return res.json();
}
