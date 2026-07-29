/**
 * osm-hours-sweep.mts — READ-ONLY OpenStreetMap reconnaissance for H3.
 *
 * Fetches NYC drinking venues from Overpass ONCE, caches the response, matches
 * them against our catalog with src/lib/osmMatch, and reports the split. It
 * writes NOTHING: no database updates, no hours applied. The point of this slice
 * is to find out whether OSM coverage makes two-source corroboration viable at
 * all before any write path exists — if almost nothing matches, every scraped
 * venue would sit at `reported` forever and that changes the plan.
 *
 * Usage:
 *   npx tsx scripts/osm-hours-sweep.mts            # cached if available
 *   npx tsx scripts/osm-hours-sweep.mts --refresh  # force a new Overpass call
 *   npx tsx scripts/osm-hours-sweep.mts --samples 20
 *
 * Politeness: ONE bounding-box query for the whole city rather than 1,265
 * per-venue lookups, a descriptive User-Agent as Overpass's usage policy
 * requires, and an on-disk cache so iterating on the matching logic never hits
 * their servers again.
 */

import { config as loadEnv } from 'dotenv';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { matchOsmVenue, type CatalogVenue, type OsmVenue } from '../src/lib/osmMatch';
import { parseOsmOpeningHours } from '../src/lib/osmOpeningHours';
import { isValidWeeklyHours, resolveHours, sameHours } from '../src/lib/hoursResolution';
import type { WeeklyHours } from '../src/types';

loadEnv({ path: '.env.local' });

const REFRESH = process.argv.includes('--refresh');
/** Writes are OPT-IN. The default is a dry run that reports what it would do. */
const APPLY = process.argv.includes('--apply');

// Same hard gate as the migration runner: never mutate the live catalog from an
// unattended loop. Applying hours is an attended step.
if (APPLY && process.env.LOOP_UNATTENDED === '1') {
  console.error(
    '[loop-guard] --apply is forbidden during the unattended loop ' +
      '(LOOP_UNATTENDED=1). Writing hours is an attended step. Aborting.',
  );
  process.exit(1);
}
const SAMPLES = (() => {
  const i = process.argv.indexOf('--samples');
  return i === -1 ? 8 : Number(process.argv[i + 1]) || 8;
})();

const CACHE_DIR = join(process.cwd(), '.osm-cache');
const CACHE_FILE = join(CACHE_DIR, 'nyc-drinking-venues.json');

// All five boroughs.
const BBOX = '40.49,-74.26,40.92,-73.70';
const OVERPASS = 'https://overpass-api.de/api/interpreter';
const QUERY = `
[out:json][timeout:120];
(
  node["amenity"~"^(bar|pub|nightclub|biergarten)$"](${BBOX});
  way["amenity"~"^(bar|pub|nightclub|biergarten)$"](${BBOX});
);
out center tags;
`;

type OverpassElement = {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
};

async function loadOsm(): Promise<OverpassElement[]> {
  if (!REFRESH && existsSync(CACHE_FILE)) {
    const cached = JSON.parse(readFileSync(CACHE_FILE, 'utf-8')) as { elements: OverpassElement[] };
    console.log(`OSM: ${cached.elements.length} elements from cache (--refresh to re-fetch)`);
    return cached.elements;
  }

  console.log('OSM: querying Overpass (one bounding-box request)…');
  const res = await fetch(OVERPASS, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      // Overpass's usage policy asks for an identifiable agent.
      'User-Agent': 'next-bar/0.1 hours-provenance-sweep (contact: hi@next-bar.app)',
    },
    body: new URLSearchParams({ data: QUERY }).toString(),
  });
  if (!res.ok) {
    throw new Error(
      `Overpass returned ${res.status} ${res.statusText}. It rate-limits aggressively; wait and retry.`,
    );
  }
  const json = (await res.json()) as { elements: OverpassElement[] };
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(CACHE_FILE, JSON.stringify(json), 'utf-8');
  console.log(`OSM: ${json.elements.length} elements fetched and cached`);
  return json.elements;
}

function toOsmVenue(el: OverpassElement): OsmVenue | null {
  const tags = el.tags ?? {};
  const lat = el.lat ?? el.center?.lat;
  const lng = el.lon ?? el.center?.lon;
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;
  if (!tags.name) return null;
  return {
    osmId: `${el.type}/${el.id}`,
    name: tags.name,
    lat,
    lng,
    openingHours: tags.opening_hours,
    website: tags.website ?? tags['contact:website'],
    phone: tags.phone ?? tags['contact:phone'],
    email: tags.email ?? tags['contact:email'],
    instagram: tags['contact:instagram'],
  };
}

/** Catalog row plus the CURRENT hours, so a write can be diffed before it lands. */
type CatalogRow = CatalogVenue & {
  hours: WeeklyHours | null;
  hours_source: string | null;
};

async function loadCatalog(): Promise<CatalogRow[]> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const { rows } = await client.query<CatalogRow>(
      'select id, name, lat, lng, hours, hours_source from public.bars',
    );
    console.log(`catalog: ${rows.length} venues`);
    return rows;
  } finally {
    await client.end();
  }
}

const pct = (n: number, total: number) => `${((n / total) * 100).toFixed(1)}%`;

async function main() {
  const [elements, catalog] = await Promise.all([loadOsm(), loadCatalog()]);
  const osmVenues = elements.map(toOsmVenue).filter((v): v is OsmVenue => v !== null);
  console.log(`OSM: ${osmVenues.length} named venues with usable coordinates`);
  console.log(
    `OSM: ${osmVenues.filter((v) => v.openingHours).length} of those carry opening_hours\n`,
  );

  const tally = {
    exact: 0,
    subset: 0,
    ambiguous: 0,
    none: 0,
    withHours: 0,
    hoursParsed: 0,
    hoursRefused: 0,
    withWebsite: 0,
    withPhone: 0,
    withSocial: 0,
  };
  const refusedSpecs: string[] = [];
  const matchedSamples: string[] = [];
  /** Rows the ladder cleared for writing. Collected, then written in one txn. */
  // Google cross-check (operator decision, 2026-07-28): before replacing a
  // Google-derived row, compare what OSM says with what Google said. Agreement
  // is a free second opinion on the parser; a DIFFERENCE is the interesting
  // case and gets surfaced for hand verification rather than silently applied.
  // Google's value is only ever READ here for comparison — it is never carried
  // forward or persisted, so this stays inside the display-vs-persist line.
  const agreesWithGoogle: string[] = [];
  const differsFromGoogle: Array<{ name: string; id: string }> = [];
  const noGoogleBaseline: string[] = [];

  const writes: {
    id: string;
    hours: unknown;
    source: string;
    confidence: string;
  }[] = [];

  for (const venue of catalog) {
    const r = matchOsmVenue(venue, osmVenues);
    if (r.outcome === 'ambiguous') {
      tally.ambiguous++;
      continue;
    }
    if (r.outcome === 'none') {
      tally.none++;
      continue;
    }

    if (r.reason === 'exact-name') tally.exact++;
    else tally.subset++;

    if (r.osm.website) tally.withWebsite++;
    if (r.osm.phone) tally.withPhone++;
    if (r.osm.instagram || r.osm.email) tally.withSocial++;

    if (r.osm.openingHours) {
      tally.withHours++;
      const parsed = parseOsmOpeningHours(r.osm.openingHours);
      if (parsed) {
        tally.hoursParsed++;
        // The ladder decides, not this script. OSM alone is one source, so this
        // resolves to `reported`; it becomes `verified` only once a second,
        // independent source agrees. A conflict or a rejection writes NOTHING.
        const resolved = resolveHours([
          { source: 'osm', hours: parsed, observedAt: new Date().toISOString() },
        ]);
        if (resolved.outcome === 'reported' || resolved.outcome === 'verified') {
          writes.push({
            id: venue.id,
            hours: resolved.hours,
            source: resolved.source,
            confidence: resolved.confidence,
          });
          if (
            venue.hours_source === 'google' &&
            venue.hours &&
            isValidWeeklyHours(venue.hours)
          ) {
            if (sameHours(resolved.hours, venue.hours)) agreesWithGoogle.push(venue.name);
            else differsFromGoogle.push({ name: venue.name, id: venue.id });
          } else {
            noGoogleBaseline.push(venue.name);
          }
        }
        if (matchedSamples.length < SAMPLES) {
          matchedSamples.push(
            `  ${venue.name}  ->  ${r.osm.name} (${Math.round(r.meters)}m, ${r.reason})\n` +
              `      ${r.osm.openingHours}`,
          );
        }
      } else {
        tally.hoursRefused++;
        if (refusedSpecs.length < SAMPLES) refusedSpecs.push(`  ${venue.name}: ${r.osm.openingHours}`);
      }
    }
  }

  const total = catalog.length;
  const matched = tally.exact + tally.subset;

  console.log('=== MATCH SPLIT (per catalog venue) ===');
  console.log(`  matched            ${matched}  (${pct(matched, total)})`);
  console.log(`    exact-name       ${tally.exact}`);
  console.log(`    token-subset     ${tally.subset}`);
  console.log(`  ambiguous (review) ${tally.ambiguous}  (${pct(tally.ambiguous, total)})`);
  console.log(`  no match           ${tally.none}  (${pct(tally.none, total)})`);

  console.log('\n=== HOURS YIELD (the number that decides viability) ===');
  console.log(`  matched venues with an opening_hours tag  ${tally.withHours}`);
  console.log(`    parsed successfully                    ${tally.hoursParsed}`);
  console.log(`    refused by the parser (-> human)       ${tally.hoursRefused}`);
  console.log(
    `  => ${tally.hoursParsed} of ${total} venues (${pct(tally.hoursParsed, total)}) could get a` +
      ' `reported` claim from OSM alone,\n     and become corroboration candidates for `verified`.',
  );

  console.log('\n=== OUTREACH YIELD (free, same request) ===');
  console.log(`  matched venues with a website   ${tally.withWebsite}`);
  console.log(`  matched venues with a phone     ${tally.withPhone}`);
  console.log(`  matched venues with email/insta ${tally.withSocial}`);

  if (matchedSamples.length > 0) {
    console.log('\n=== SAMPLE MATCHES WITH PARSED HOURS ===');
    for (const s of matchedSamples) console.log(s);
  }
  if (refusedSpecs.length > 0) {
    console.log('\n=== SAMPLE SPECS THE PARSER REFUSED (candidates for subset expansion) ===');
    for (const s of refusedSpecs) console.log(s);
  }

  console.log('\n=== GOOGLE CROSS-CHECK (before replacing anything) ===');
  console.log(`  OSM agrees with Google        ${agreesWithGoogle.length}  (safe to apply)`);
  console.log(`  OSM DIFFERS from Google       ${differsFromGoogle.length}  <- hand-verify these`);
  console.log(`  no Google baseline to compare ${noGoogleBaseline.length}`);
  if (differsFromGoogle.length > 0) {
    console.log('\n  VENUES WHERE OSM AND GOOGLE DISAGREE - verify before trusting OSM:');
    for (const d of differsFromGoogle) console.log(`    ${d.name}  (${d.id})`);
  }

  console.log('\n=== WRITE PLAN ===');
  console.log(`  rows the trust ladder cleared for writing: ${writes.length}`);
  console.log('  each becomes hours_source=osm, hours_confidence=reported,');
  console.log('  hours_verified_at=now(), REPLACING the Google-derived hours.');
  console.log('  That replacement is the point: it swaps a source we may not rely');
  console.log('  on for one we may, and retires those rows from H4 in passing.');

  if (!APPLY) {
    console.log('\nDRY RUN — nothing written. Re-run with --apply to write.');
    return;
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query('begin');
    for (const w of writes) {
      await client.query(
        `update public.bars
            set hours = $1::jsonb,
                hours_source = $2,
                hours_confidence = $3,
                hours_verified_at = now()
          where id = $4`,
        [JSON.stringify(w.hours), w.source, w.confidence, w.id],
      );
    }
    await client.query('commit');
    console.log(`\nAPPLIED ${writes.length} row(s) in one transaction.`);
  } catch (err) {
    await client.query('rollback').catch(() => {});
    console.error('\nWrite FAILED and rolled back; the catalog is unchanged.\n', err);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
