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
// Search), then Place Details for coords + business status + opening hours +
// primary photo name. Writes the result to src/lib/bars.places.ts (a generated
// sidecar overlaid in bars.ts — its wrong-venue bbox guard drops a whole patch,
// photos/reviews included, when coords resolve outside the service area).
// Dry-run by default; pass --apply to write the sidecar.
//
// PHOTO FORMAT (dependency-free choice): GetPhotoMedia's media redirect serves
// JPEG bytes; we save them AS-IS to public/bar-photos/<barId>.jpg. Converting
// to WebP would require adding `sharp` (not a dep) — so .jpg it is, and
// src/lib/barVisual.ts's barImageUrl() returns the matching .jpg path. If a
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
// <barId>-<i>.jpg (photo 1 keeps <barId>.jpg), and MERGES photoRefs +
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
const REVIEWS = process.argv.includes('--reviews');
const KEY = process.env.GOOGLE_MAPS_API_KEY;
const SIDECAR = path.join(REPO, 'src/lib/bars.places.ts');
const PHOTO_DIR = path.join(REPO, 'public/bar-photos');
const PHOTO_MAX_WIDTH = 640;
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
// as-is — no re-encode, no image dep (see PHOTO FORMAT header note).
async function downloadPhoto(photoRef, file) {
  const url = `https://places.googleapis.com/v1/${photoRef}/media?maxWidthPx=${PHOTO_MAX_WIDTH}&key=${KEY}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`photo media HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length === 0) throw new Error('photo media returned 0 bytes');
  fs.writeFileSync(file, buf);
  return buf.length;
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
      if (d.location?.latitude != null) { patch.lat = d.location.latitude; patch.lng = d.location.longitude; }
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
      const file = path.join(PHOTO_DIR, `${id}.jpg`);
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
        const file = path.join(PHOTO_DIR, i === 0 ? `${id}.jpg` : `${id}-${i + 1}.jpg`);
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
