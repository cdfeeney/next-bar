/**
 * Seed/refresh the `bars` table (migration 0019) from the static catalog +
 * Places sidecar — the merged runtime view the app serves today.
 *
 * Re-runnable: UPSERTs on id, so curated edits re-seed cleanly. Rows the
 * import pipeline adds later (source != 'curated') are NEVER touched by
 * this script — it only writes the ids present in the static catalog.
 *
 * usage: npx tsx scripts/seed-bars-table.mts [--dry-run]
 * env:   NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (.env.local)
 */
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { refuseIfUnattended } from './loop-guard.mjs';
import { bars } from '../src/lib/bars';

refuseIfUnattended('bars table seed');
dotenv.config({ path: '.env.local' });

const DRY = process.argv.includes('--dry-run');
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('need NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const rows = bars.map((b) => ({
  id: b.id,
  name: b.name,
  lat: b.lat,
  lng: b.lng,
  tags: b.tags,
  neighborhood: b.neighborhood,
  price_tier: b.priceTier,
  hours: b.hours ?? null,
  blurb: b.blurb,
  address: b.address,
  source: 'curated',
  place_id: b.googlePlaceId ?? null,
  business_status: b.businessStatus ?? null,
  photo_count: b.photoCount ?? (b.photoRef ? 1 : 0),
  photo_attributions: b.photoAttributions ?? null,
  reviews: b.reviews ?? null,
  last_verified: b.lastVerified,
  updated_at: new Date().toISOString(),
}));

console.log(`${rows.length} catalog rows prepared (merged static + sidecar).`);
if (DRY) {
  console.log('(dry-run) sample row:', JSON.stringify(rows[0]).slice(0, 300));
  process.exit(0);
}

const admin = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Chunked upserts — PostgREST bodies stay comfortably sized.
const CHUNK = 100;
let written = 0;
for (let i = 0; i < rows.length; i += CHUNK) {
  const slice = rows.slice(i, i + CHUNK);
  const { error } = await admin.from('bars').upsert(slice, { onConflict: 'id' });
  if (error) {
    console.error(`chunk ${i / CHUNK}: FAILED`, error.code, error.message);
    process.exit(1);
  }
  written += slice.length;
  console.log(`upserted ${written}/${rows.length}`);
}

const { count, error: countErr } = await admin
  .from('bars')
  .select('id', { count: 'exact', head: true });
if (countErr) {
  console.error('verify count failed:', countErr.message);
  process.exit(1);
}
console.log(`DONE. bars table now holds ${count} rows.`);
