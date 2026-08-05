/**
 * Photo ingest for bars-TABLE rows (imported venues): for rows with a
 * place_id and photo_count=0, fetch up to 3 photo names via Place
 * Details, download to public/bar-photos/<id>[-n].webp (repo files — a
 * PR/deploy ships them), and UPDATE the row's photo_count +
 * photo_attributions. Skips rows whose primary file already exists.
 *
 * usage: npx tsx scripts/photos-for-table.mts [--apply] [--budget 1500] [--limit N]
 */
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { refuseIfUnattended } from './loop-guard.mjs';

refuseIfUnattended('table photo ingest');

// ─── FROZEN 2026-07-27 (Phase 1 compliance) ─────────────────────────────
// Downloading Google Place photo bytes to our own storage is the practice
// this phase exists to stop: Google's Places policy permits storing the
// place_id indefinitely and little else, and re-hosting photo files is
// redistribution of their licensed Content. Photos now come from
// first-party media (bar_photos) or live Google UI at display time — see
// src/lib/mediaPolicy.ts.
//
// This freeze is deliberately non-destructive: nothing already on disk is
// touched. Set ALLOW_GOOGLE_PHOTO_INGEST=1 only for a reviewed, documented
// one-off.
if (process.env.ALLOW_GOOGLE_PHOTO_INGEST !== '1') {
  console.error('FROZEN: Google photo ingest is disabled (Phase 1 compliance).');
  console.error('Photos come from first-party media or live Google UI instead.');
  console.error('See docs/WORK-LEDGER.md. Override: ALLOW_GOOGLE_PHOTO_INGEST=1');
  process.exit(2);
}
// ────────────────────────────────────────────────────────────────────────

dotenv.config({ path: '.env.local' });

const APPLY = process.argv.includes('--apply');
const bArg = process.argv.indexOf('--budget');
const BUDGET = bArg !== -1 ? parseInt(process.argv[bArg + 1], 10) : 1500;
const lArg = process.argv.indexOf('--limit');
const LIMIT = lArg !== -1 ? parseInt(process.argv[lArg + 1], 10) : Infinity;
const MAX_PHOTOS = 3;
const MAX_WIDTH = 640;
const WEBP_QUALITY = 78;
const DIR = path.join(process.cwd(), 'public/bar-photos');

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const svc = process.env.SUPABASE_SERVICE_ROLE_KEY;
const KEY = process.env.GOOGLE_MAPS_API_KEY;
if (!url || !svc || !KEY) {
  console.error('need supabase url + service key + GOOGLE_MAPS_API_KEY');
  process.exit(1);
}
const admin = createClient(url, svc, { auth: { persistSession: false, autoRefreshToken: false } });
// PAGINATED (PostgREST caps at 1,000 rows silently).
const rows: Array<{ id: string }> = [];
for (let from = 0; ; from += 1000) {
  const { data, error } = await admin
    .from('bars')
    .select('id')
    .not('place_id', 'is', null)
    .eq('photo_count', 0)
    .order('id', { ascending: true })
    .range(from, from + 999);
  if (error || !data) {
    console.error(error?.message);
    process.exit(1);
  }
  rows.push(...data);
  if (data.length < 1000) break;
}
const targets = rows.slice(0, LIMIT);
console.log(`${rows.length} photo-less enriched rows; processing ${targets.length} [${APPLY ? '--apply' : 'dry-run'}]`);
let calls = 0;
let done = 0;
for (const { id } of targets) {
  if (calls + 1 + MAX_PHOTOS > BUDGET) {
    console.log('budget reached, stopping');
    break;
  }
  if (fs.existsSync(path.join(DIR, `${id}.webp`))) continue;
  const { data: row } = await admin.from('bars').select('place_id').eq('id', id).single();
  const det = await fetch(`https://places.googleapis.com/v1/places/${row!.place_id}`, {
    headers: { 'X-Goog-Api-Key': KEY, 'X-Goog-FieldMask': 'photos' },
  });
  calls++;
  const dj = await det.json();
  const photos = (dj.photos ?? []).slice(0, MAX_PHOTOS);
  if (photos.length === 0) continue;
  if (!APPLY) {
    console.log(`(dry) ${id}: ${photos.length} photos available`);
    continue;
  }
  const attributions: string[] = [];
  let saved = 0;
  for (let i = 0; i < photos.length; i++) {
    const media = await fetch(
      `https://places.googleapis.com/v1/${photos[i].name}/media?maxWidthPx=${MAX_WIDTH}&key=${KEY}`,
    );
    calls++;
    if (!media.ok) continue;
    const buf = Buffer.from(await media.arrayBuffer());
    // Re-encode to WebP before writing (phone speed, 2026-07-27): Google
    // returns ~124 KB JPEGs; WebP at the same width is less than half
    // that. Extension must stay in step with PHOTO_EXT in barVisual.ts.
    const webp = await sharp(buf).webp({ quality: WEBP_QUALITY, effort: 5 }).toBuffer();
    const file = i === 0 ? `${id}.webp` : `${id}-${i + 1}.webp`;
    fs.writeFileSync(path.join(DIR, file), webp);
    attributions.push(photos[i].authorAttributions?.[0]?.displayName ?? 'Google user');
    saved++;
  }
  if (saved > 0) {
    await admin
      .from('bars')
      .update({ photo_count: saved, photo_attributions: attributions })
      .eq('id', id);
    done++;
    if (done % 25 === 0) console.log(`${done} bars photographed, ${calls} calls`);
  }
  await new Promise((r) => setTimeout(r, 100));
}
console.log(`DONE: ${done} bars photographed, ${calls} API calls.`);
console.log('Commit public/bar-photos changes + PR to ship the files.');
