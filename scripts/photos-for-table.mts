/**
 * Photo ingest for bars-TABLE rows (imported venues): for rows with a
 * place_id and photo_count=0, fetch up to 3 photo names via Place
 * Details, download to public/bar-photos/<id>[-n].jpg (repo files — a
 * PR/deploy ships them), and UPDATE the row's photo_count +
 * photo_attributions. Skips rows whose primary file already exists.
 *
 * usage: npx tsx scripts/photos-for-table.mts [--apply] [--budget 1500] [--limit N]
 */
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { refuseIfUnattended } from './loop-guard.mjs';

refuseIfUnattended('table photo ingest');
dotenv.config({ path: '.env.local' });

const APPLY = process.argv.includes('--apply');
const bArg = process.argv.indexOf('--budget');
const BUDGET = bArg !== -1 ? parseInt(process.argv[bArg + 1], 10) : 1500;
const lArg = process.argv.indexOf('--limit');
const LIMIT = lArg !== -1 ? parseInt(process.argv[lArg + 1], 10) : Infinity;
const MAX_PHOTOS = 3;
const MAX_WIDTH = 640;
const DIR = path.join(process.cwd(), 'public/bar-photos');

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const svc = process.env.SUPABASE_SERVICE_ROLE_KEY;
const KEY = process.env.GOOGLE_MAPS_API_KEY;
if (!url || !svc || !KEY) {
  console.error('need supabase url + service key + GOOGLE_MAPS_API_KEY');
  process.exit(1);
}
const admin = createClient(url, svc, { auth: { persistSession: false, autoRefreshToken: false } });
const { data: rows, error } = await admin
  .from('bars')
  .select('id')
  .not('place_id', 'is', null)
  .eq('photo_count', 0);
if (error || !rows) {
  console.error(error?.message);
  process.exit(1);
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
  if (fs.existsSync(path.join(DIR, `${id}.jpg`))) continue;
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
    const file = i === 0 ? `${id}.jpg` : `${id}-${i + 1}.jpg`;
    fs.writeFileSync(path.join(DIR, file), buf);
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
