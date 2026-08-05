/**
 * catalog-dedupe-report.mts — READ-ONLY duplicate detection for the bar catalog.
 *
 * The catalog grew from ~1,000 to 1,265 venues across three sweeps and picked up
 * duplicates on the way: "Death & Co" and "Death & Company" are the same East
 * Village bar under two ids, and users see it twice in pickers, results and lists.
 *
 * Deduping cannot be automated, and this script deliberately does not try. NYC is
 * full of genuine multi-location venues — Barcade, Bar Veloce, Blue Haven — whose
 * names collide exactly while being different bars. So this RANKS pairs by how
 * strong the evidence is and hands them to a human. It writes nothing.
 *
 * Evidence, strongest first:
 *   1. SAME place_id      — unambiguous. Google issues one per real venue.
 *   2. same name, <100m   — one venue, two rows.
 *   3. name contains, <100m — very likely one venue ("Blind Tiger" / "Blind Tiger
 *                            Ale House").
 *   4. same/similar name, >400m — almost certainly DISTINCT locations of a chain.
 *   5. everything else    — review.
 *
 * Rating counts are included so a merge keeps the row users have actually touched.
 *
 * Usage: npx tsx scripts/catalog-dedupe-report.mts [--all]
 */

import { config as loadEnv } from 'dotenv';
import { Client } from 'pg';
import { haversineMiles } from '../src/lib/distance';
import { normalizeVenueName } from '../src/lib/osmMatch';

loadEnv({ path: '.env.local' });

const SHOW_ALL = process.argv.includes('--all');
const MILES_TO_M = 1609.344;
const SAME_SITE_M = 100;
const CHAIN_M = 400;

type Row = {
  id: string;
  name: string;
  neighborhood: string;
  lat: number;
  lng: number;
  place_id: string | null;
  ratings: number;
};

type Verdict =
  | 'DUPLICATE — same place_id'
  | 'DUPLICATE — same name, same spot'
  | 'LIKELY DUPLICATE — one name contains the other, same spot'
  | 'DISTINCT — same name, far apart (multi-location)'
  | 'REVIEW';

function verdictFor(a: Row, b: Row, meters: number): Verdict {
  if (a.place_id && b.place_id && a.place_id === b.place_id) {
    return 'DUPLICATE — same place_id';
  }
  const na = normalizeVenueName(a.name);
  const nb = normalizeVenueName(b.name);
  const identical = na === nb;
  const contains = !identical && (nb.startsWith(`${na} `) || na.startsWith(`${nb} `));

  if (identical && meters <= SAME_SITE_M) return 'DUPLICATE — same name, same spot';
  if (contains && meters <= SAME_SITE_M) {
    return 'LIKELY DUPLICATE — one name contains the other, same spot';
  }
  if (identical && meters > CHAIN_M) return 'DISTINCT — same name, far apart (multi-location)';
  return 'REVIEW';
}

const ORDER: Verdict[] = [
  'DUPLICATE — same place_id',
  'DUPLICATE — same name, same spot',
  'LIKELY DUPLICATE — one name contains the other, same spot',
  'REVIEW',
  'DISTINCT — same name, far apart (multi-location)',
];

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  let rows: Row[];
  try {
    const res = await client.query<Row>(`
      select b.id, b.name, b.neighborhood, b.lat, b.lng, b.place_id,
             (select count(*)::int from public.ratings r where r.bar_id = b.id) as ratings
        from public.bars b`);
    rows = res.rows;
  } finally {
    await client.end();
  }
  console.log(`catalog: ${rows.length} venues\n`);

  // Candidate pairs: identical normalised name, or one name a prefix of the
  // other, or a shared place_id. O(n^2) at 1,265 rows is instant.
  const pairs: { a: Row; b: Row; meters: number; verdict: Verdict }[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const a = rows[i];
      const b = rows[j];
      const na = normalizeVenueName(a.name);
      const nb = normalizeVenueName(b.name);
      if (na === '' || nb === '') continue;

      const samePlace = Boolean(a.place_id && b.place_id && a.place_id === b.place_id);
      const related =
        na === nb || nb.startsWith(`${na} `) || na.startsWith(`${nb} `) || samePlace;
      if (!related) continue;

      const key = [a.id, b.id].sort().join('|');
      if (seen.has(key)) continue;
      seen.add(key);

      const meters = haversineMiles(a, b) * MILES_TO_M;
      pairs.push({ a, b, meters, verdict: verdictFor(a, b, meters) });
    }
  }

  const grouped = new Map<Verdict, typeof pairs>();
  for (const p of pairs) {
    if (!grouped.has(p.verdict)) grouped.set(p.verdict, []);
    grouped.get(p.verdict)!.push(p);
  }

  console.log('=== SUMMARY ===');
  for (const v of ORDER) console.log(`  ${String(grouped.get(v)?.length ?? 0).padStart(3)}  ${v}`);
  console.log(`  ${String(pairs.length).padStart(3)}  TOTAL candidate pairs\n`);

  for (const v of ORDER) {
    const group = grouped.get(v);
    if (!group || group.length === 0) continue;
    console.log(`=== ${v} (${group.length}) ===`);
    const show = SHOW_ALL ? group : group.slice(0, 40);
    for (const { a, b, meters } of show.sort((x, y) => x.meters - y.meters)) {
      const keep = a.ratings >= b.ratings ? a : b;
      console.log(
        `  ${Math.round(meters).toString().padStart(5)}m  ` +
          `"${a.name}" [${a.id}] ${a.neighborhood} (${a.ratings}★)  <->  ` +
          `"${b.name}" [${b.id}] ${b.neighborhood} (${b.ratings}★)` +
          (v.startsWith('DUPLICATE') || v.startsWith('LIKELY') ? `   keep: ${keep.id}` : ''),
      );
    }
    if (!SHOW_ALL && group.length > show.length) {
      console.log(`  … ${group.length - show.length} more (--all to list)`);
    }
    console.log('');
  }

  console.log('Nothing was written. Merging is an operator decision.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
