/**
 * Google-enrich `bars` TABLE rows that have no place_id yet (imported
 * batches — refresh-places.mjs only patches the STATIC sidecar and never
 * sees table-only rows). For each un-enriched row: Text Search → Place
 * Details → UPDATE the row with place_id, business_status, hours, and
 * Google-corrected coords (guarded: a big move flags the row instead of
 * silently relocating it — the wrong-venue class from 2026-07-27).
 * CLOSED_PERMANENTLY rows are flagged for removal, not deleted.
 *
 * Photos deliberately NOT ingested here (repo-file pipeline, phase 2).
 * ~2 API calls per row; respects a per-run budget so the 600/day quota
 * survives multiple batches.
 *
 * usage: npx tsx scripts/enrich-table-bars.mts [--apply] [--budget 200] [--only id1,id2]
 */
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { refuseIfUnattended } from './loop-guard.mjs';

refuseIfUnattended('Google Places table enrichment');
dotenv.config({ path: '.env.local' });

const APPLY = process.argv.includes('--apply');
const budgetArg = process.argv.indexOf('--budget');
const BUDGET = budgetArg !== -1 ? parseInt(process.argv[budgetArg + 1], 10) : 200;
const onlyArg = process.argv.indexOf('--only');
const ONLY = onlyArg !== -1 ? new Set(process.argv[onlyArg + 1].split(',')) : null;

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
const KEY = process.env.GOOGLE_MAPS_API_KEY;
if (!url || !service || !KEY) {
  console.error('need NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY + GOOGLE_MAPS_API_KEY');
  process.exit(1);
}

const MAX_MOVE_MILES = 0.6; // bigger move = suspect wrong venue → flag, don't write
const pad = (n: number): string => String(n).padStart(2, '0');
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function haversineMiles(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 3958.8;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// Google periods -> WeeklyHours (same mapping as refresh-places.mjs).
function toWeeklyHours(roh: any): Record<string, Array<{ open: string; close: string }>> | null {
  const periods = roh?.periods;
  if (!Array.isArray(periods)) return null;
  const hours: Record<string, Array<{ open: string; close: string }>> = {};
  for (const p of periods) {
    if (!p.open) continue;
    const open = `${pad(p.open.hour ?? 0)}:${pad(p.open.minute ?? 0)}`;
    const close = p.close ? `${pad(p.close.hour ?? 0)}:${pad(p.close.minute ?? 0)}` : '24:00';
    (hours[p.open.day] ||= []).push({ open, close });
  }
  return Object.keys(hours).length ? hours : null;
}

const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
// NOTE: bounded by the place_id-null filter, which stays far below
// PostgREST's silent 1,000-row cap; add .range() paging if that changes.
let query = admin.from('bars').select('id,name,address,neighborhood,lat,lng').is('place_id', null);
const { data: rows, error } = await query;
if (error || !rows) {
  console.error('read failed:', error?.message);
  process.exit(1);
}
const targets = (ONLY ? rows.filter((r) => ONLY.has(r.id)) : rows).slice(0, Math.floor(BUDGET / 2));
console.log(`${rows.length} un-enriched rows; processing ${targets.length} (budget ${BUDGET} calls) [${APPLY ? '--apply' : 'dry-run'}]`);

let calls = 0;
let updated = 0;
const flags: string[] = [];
for (const bar of targets) {
  const search = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': KEY,
      'X-Goog-FieldMask': 'places.id,places.displayName',
    },
    body: JSON.stringify({ textQuery: `${bar.name}, ${bar.address}, New York` }),
  });
  calls++;
  const sj = await search.json();
  const placeId = sj.places?.[0]?.id;
  const matchedName = sj.places?.[0]?.displayName?.text ?? '?';
  if (!placeId) {
    flags.push(`${bar.id}: NO MATCH — verify manually`);
    continue;
  }
  const det = await fetch(`https://places.googleapis.com/v1/places/${placeId}`, {
    headers: { 'X-Goog-Api-Key': KEY, 'X-Goog-FieldMask': 'id,location,businessStatus,regularOpeningHours' },
  });
  calls++;
  const dj = await det.json();
  const gLat = dj.location?.latitude;
  const gLng = dj.location?.longitude;
  const move =
    typeof gLat === 'number' && typeof gLng === 'number'
      ? haversineMiles(bar, { lat: gLat, lng: gLng })
      : null;
  if (move !== null && move > MAX_MOVE_MILES) {
    flags.push(`${bar.id}: SUSPECT — matched "${matchedName}" ${move.toFixed(2)}mi away; not written`);
    continue;
  }
  if (dj.businessStatus === 'CLOSED_PERMANENTLY') {
    flags.push(`${bar.id}: CLOSED_PERMANENTLY per Google ("${matchedName}") — review for removal`);
  }
  const patch: Record<string, unknown> = {
    place_id: placeId,
    business_status: dj.businessStatus ?? null,
    hours: toWeeklyHours(dj.regularOpeningHours),
  };
  // COORDINATES ARE NEVER WRITTEN FROM GOOGLE.
  //
  // This block used to do `patch.lat = gLat; patch.lng = gLng`, which would undo
  // migrations 0029-0032: those moved every venue coordinate onto OpenStreetMap
  // because Google's terms permit caching lat/lng for at most 30 consecutive days
  // and only place_id indefinitely. One `--apply` run here reintroduced the very
  // data four migrations removed. Found by /review-routed 2026-07-29.
  //
  // The distance is still computed above and still gates the write — a match more
  // than MAX_MOVE_MILES away is treated as the wrong venue and nothing is written
  // for it. Google's position remains a transient SIGNAL; it is simply no longer
  // persisted. To correct a coordinate, use OSM:
  //   npx tsx scripts/audit-osm-witness.mts --db
  if (APPLY) {
    const { error: upErr } = await admin.from('bars').update(patch).eq('id', bar.id);
    if (upErr) {
      flags.push(`${bar.id}: UPDATE failed ${upErr.message}`);
      continue;
    }
  }
  updated++;
  console.log(`  ${APPLY ? 'enriched' : '(dry) would enrich'} ${bar.id} ← "${matchedName}" (${move?.toFixed(2) ?? '?'}mi, ${dj.businessStatus ?? 'status?'})`);
  await sleep(120);
}

console.log(`\n=== ENRICH REPORT: ${updated}/${targets.length} written, ${calls} API calls, ${flags.length} flags ===`);
for (const f of flags) console.log('  ⚠ ' + f);
