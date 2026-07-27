/**
 * Import a candidate-bar batch into the `bars` table (mass import,
 * goal g-c81262b5). NO code deploy involved — CatalogRefresh serves new
 * rows on next app load.
 *
 * Input: a JSON file of candidates (the verify-stage output of the
 * import workflow):
 *   [{ id, name, neighborhood, address, lat, lng, priceTier, tags,
 *      blurb, lastVerified }]
 *
 * Every candidate passes the SAME boundary validation the client uses
 * (src/lib/catalogServer.ts) plus: no collision with an existing id and
 * no (normalized-name, neighborhood) duplicate against the live table —
 * the dedup class the static-catalog guard tests cover.
 *
 * Rows land with source='import'. Dry-run by default; --apply writes.
 *
 * usage: npx tsx scripts/import-bars.mts <candidates.json> [--apply]
 */
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { refuseIfUnattended } from './loop-guard.mjs';
import { rowToBar, type BarsTableRow } from '../src/lib/catalogServer';

refuseIfUnattended('bars table import');
dotenv.config({ path: '.env.local' });

const file = process.argv[2];
const APPLY = process.argv.includes('--apply');
if (!file || file.startsWith('--')) {
  console.error('usage: npx tsx scripts/import-bars.mts <candidates.json> [--apply]');
  process.exit(1);
}
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('need NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

type Candidate = {
  id: string;
  name: string;
  neighborhood: string;
  address: string;
  lat: number;
  lng: number;
  priceTier: number;
  tags: string[];
  blurb: string;
  lastVerified: string;
};

const candidates = JSON.parse(fs.readFileSync(file, 'utf8')) as Candidate[];
const normalize = (s: string): string =>
  s
    .toLowerCase()
    .replace(/['’.&]/g, '')
    .replace(/\band\b|\bthe\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const admin = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});
// PAGINATED: PostgREST caps every response at 1,000 rows, silently. An
// unpaginated read here means the dedup sees only the first thousand
// bars and the whole insert then dies on a duplicate key — which is
// exactly what happened once the catalog crossed 1,000 (2026-07-27).
const existing: Array<{ id: string; name: string; neighborhood: string }> = [];
for (let from = 0; ; from += 1000) {
  const { data, error: exErr } = await admin
    .from('bars')
    .select('id,name,neighborhood')
    .order('id', { ascending: true })
    .range(from, from + 999);
  if (exErr || !data) {
    console.error('failed to read existing bars:', exErr?.message);
    process.exit(1);
  }
  existing.push(...data);
  if (data.length < 1000) break;
}
const existingIds = new Set(existing.map((b) => b.id));
const existingNameHood = new Set(
  existing.map((b) => `${normalize(b.name)}|${b.neighborhood}`),
);

const accepted: BarsTableRow[] = [];
const rejected: Array<{ id: string; reason: string }> = [];
for (const c of candidates) {
  const row: BarsTableRow = {
    id: c.id,
    name: c.name,
    lat: c.lat,
    lng: c.lng,
    tags: c.tags,
    neighborhood: c.neighborhood,
    price_tier: c.priceTier,
    hours: null,
    blurb: c.blurb,
    address: c.address,
    place_id: null,
    business_status: null,
    photo_count: 0,
    photo_attributions: null,
    reviews: null,
    last_verified: c.lastVerified,
  };
  const bar = rowToBar(row);
  if (bar === null) {
    rejected.push({ id: c.id, reason: 'boundary validation failed' });
    continue;
  }
  if (existingIds.has(c.id)) {
    rejected.push({ id: c.id, reason: 'id already exists' });
    continue;
  }
  const nh = `${normalize(c.name)}|${c.neighborhood}`;
  if (existingNameHood.has(nh)) {
    rejected.push({ id: c.id, reason: 'name+neighborhood duplicate' });
    continue;
  }
  existingIds.add(c.id);
  existingNameHood.add(nh);
  accepted.push({ ...row, tags: bar.tags });
}

console.log(
  `${candidates.length} candidates → ${accepted.length} accepted, ${rejected.length} rejected`,
);
for (const r of rejected) console.log(`  REJECT ${r.id}: ${r.reason}`);

if (!APPLY) {
  console.log('(dry-run) pass --apply to insert.');
  process.exit(0);
}
if (accepted.length === 0) process.exit(0);

const rows = accepted.map((r) => ({ ...r, source: 'import' }));
// CHUNKED: a single insert is all-or-nothing, so one bad row silently
// costs the entire batch. Chunk it, and on a chunk failure fall back to
// row-by-row so the offender is NAMED instead of taking 247 good rows
// down with it.
let inserted = 0;
const failures: Array<{ id: string; reason: string }> = [];
for (let i = 0; i < rows.length; i += 50) {
  const chunk = rows.slice(i, i + 50);
  const { error } = await admin.from('bars').insert(chunk);
  if (!error) {
    inserted += chunk.length;
    continue;
  }
  for (const row of chunk) {
    const { error: rowErr } = await admin.from('bars').insert([row]);
    if (rowErr) failures.push({ id: row.id, reason: rowErr.message });
    else inserted++;
  }
}
console.log(`INSERTED ${inserted}/${rows.length} rows (source='import').`);
for (const f of failures) console.log(`  FAILED ${f.id}: ${f.reason}`);
if (inserted === 0) process.exit(1);
console.log('Next: refresh-places --only for hours/status, then audit-places-matches.');
