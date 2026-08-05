/**
 * H3 slice 6 — venue-website hours crawl.
 *
 * Seeds from the `website` tags the OSM sweep already captured, fetches each
 * venue's own site through the SSRF-guarded client, runs the finished
 * `parseSiteHours` parser over it, and reports what the trust ladder WOULD do
 * with the result. Writes only under --apply.
 *
 * Usage:
 *   npx tsx scripts/site-hours-crawl.mts                 # dry run, cached
 *   npx tsx scripts/site-hours-crawl.mts --limit 10      # small sample
 *   npx tsx scripts/site-hours-crawl.mts --refresh       # ignore the cache
 *   npx tsx scripts/site-hours-crawl.mts --apply         # attended write
 *
 * Design rules that are NOT negotiable here:
 *   - Missing is not wrong. A site that is unreachable, times out, or parses
 *     to nothing NEVER demotes a venue and NEVER overwrites existing hours.
 *     Only present, disagreeing evidence may lower confidence.
 *   - Writes are per-venue and idempotent, so a crash mid-run leaves no venue
 *     holding another venue's hours and a re-run is safe.
 *   - Only the JSON-LD tier stands as a source on its own. The schema-text
 *     tier is recorded for a human, never published.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { Client } from 'pg';
import { config as loadEnv } from 'dotenv';
import { matchOsmVenue, type CatalogVenue, type OsmVenue } from '../src/lib/osmMatch';
import { parseSiteHours } from '../src/lib/siteHours';
import { parseOsmOpeningHours } from '../src/lib/osmOpeningHours';
import { assessSiteCandidate } from '../src/lib/sourceCorrelation';
import { resolveHours, type HoursCandidate } from '../src/lib/hoursResolution';
import { checkUrl } from '../src/lib/netGuard';
import { safeFetch } from './lib/safeFetch.mts';
import type { WeeklyHours } from '../src/types';

loadEnv({ path: '.env.local' });

const REFRESH = process.argv.includes('--refresh');
const APPLY = process.argv.includes('--apply');

// Same hard gate as the OSM sweep and the migration runner: never mutate the
// live catalog from an unattended loop. Applying hours is an attended step.
if (APPLY && process.env.LOOP_UNATTENDED === '1') {
  console.error(
    '[loop-guard] --apply is forbidden during the unattended loop ' +
      '(LOOP_UNATTENDED=1). Writing hours is an attended step. Aborting.',
  );
  process.exit(1);
}

const argNum = (flag: string, fallback: number): number => {
  const i = process.argv.indexOf(flag);
  return i === -1 ? fallback : Number(process.argv[i + 1]) || fallback;
};

const LIMIT = argNum('--limit', Number.POSITIVE_INFINITY);
/** Concurrent fetches across the whole run. Politeness, not throughput. */
const CONCURRENCY = argNum('--concurrency', 4);
/** Minimum gap between two requests to the SAME host. */
const PER_HOST_DELAY_MS = argNum('--host-delay', 2_000);

const OSM_CACHE = join(process.cwd(), '.osm-cache', 'nyc-drinking-venues.json');
const SITE_CACHE_DIR = join(process.cwd(), '.site-cache');

type OverpassElement = {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
};

type CatalogRow = CatalogVenue & {
  hours: WeeklyHours | null;
  hours_source: string | null;
  hours_confidence: string | null;
};

function toOsmVenue(el: OverpassElement): OsmVenue | null {
  const tags = el.tags ?? {};
  const lat = el.lat ?? el.center?.lat;
  const lng = el.lon ?? el.center?.lon;
  if (typeof lat !== 'number' || typeof lng !== 'number' || !tags.name) return null;
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

// ---------------------------------------------------------------- cache

function cachePath(url: string): string {
  return join(SITE_CACHE_DIR, `${createHash('sha1').update(url).digest('hex')}.json`);
}

type CachedPage = { url: string; fetchedAt: string; ok: boolean; reason?: string; body?: string };

function readCache(url: string): CachedPage | null {
  if (REFRESH) return null;
  const p = cachePath(url);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as CachedPage;
  } catch {
    return null;
  }
}

function writeCache(page: CachedPage): void {
  mkdirSync(SITE_CACHE_DIR, { recursive: true });
  writeFileSync(cachePath(page.url), JSON.stringify(page), 'utf8');
}

// ------------------------------------------------------- robots + rate

const robotsByOrigin = new Map<string, Promise<string[]>>();

/** Disallow prefixes that apply to us. 4xx ⇒ allow all; 5xx/error ⇒ allow none. */
async function disallowedPrefixes(origin: string): Promise<string[]> {
  let pending = robotsByOrigin.get(origin);
  if (!pending) {
    pending = (async () => {
      const res = await safeFetch(`${origin}/robots.txt`, { totalTimeoutMs: 10_000 });
      if (!res.ok) {
        // A 404 means "no rules". Anything else (5xx, timeout, blocked) is
        // treated as "we could not confirm we are welcome" — stay out.
        return res.status !== undefined && res.status >= 400 && res.status < 500
          ? []
          : ['/'];
      }
      return parseRobots(res.body);
    })();
    robotsByOrigin.set(origin, pending);
  }
  return pending;
}

/** Minimal robots parser: the `*` group plus any group naming our bot. */
export function parseRobots(text: string): string[] {
  const lines = text.split(/\r?\n/).map((l) => l.replace(/#.*$/, '').trim());
  const disallow: string[] = [];
  let applies = false;
  for (const line of lines) {
    const [rawKey, ...rest] = line.split(':');
    if (rest.length === 0) continue;
    const key = rawKey.trim().toLowerCase();
    const value = rest.join(':').trim();
    if (key === 'user-agent') {
      applies = value === '*' || /nextbarhoursbot/i.test(value);
    } else if (applies && key === 'disallow' && value !== '') {
      disallow.push(value);
    } else if (applies && key === 'allow' && value === '/') {
      // An explicit blanket Allow cancels a blanket Disallow in the same group.
      const idx = disallow.indexOf('/');
      if (idx !== -1) disallow.splice(idx, 1);
    }
  }
  return disallow;
}

const lastHitByHost = new Map<string, number>();

async function politeDelay(host: string): Promise<void> {
  const last = lastHitByHost.get(host) ?? 0;
  const wait = last + PER_HOST_DELAY_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastHitByHost.set(host, Date.now());
}

// ------------------------------------------------------------- fetch one

type SiteOutcome = {
  barId: string;
  name: string;
  url: string;
  status:
    | 'parsed'
    | 'correlated'
    | 'rejected-google'
    | 'low-tier'
    | 'needs_human'
    | 'no-hours'
    | 'blocked'
    | 'robots'
    | 'error';
  detail?: string;
  hours?: WeeklyHours;
};

async function crawlOne(row: CatalogRow, url: string, osmHours?: WeeklyHours): Promise<SiteOutcome> {
  const base = { barId: row.id, name: row.name, url };
  const checked = checkUrl(url);
  if (!checked.ok) return { ...base, status: 'blocked', detail: checked.reason };

  const origin = checked.url.origin;
  const path = checked.url.pathname || '/';
  const blocked = await disallowedPrefixes(origin);
  if (blocked.some((prefix) => path.startsWith(prefix))) {
    return { ...base, status: 'robots', detail: `robots.txt disallows ${path}` };
  }

  let page = readCache(url);
  if (page === null) {
    await politeDelay(checked.url.host);
    const res = await safeFetch(url);
    page = res.ok
      ? { url, fetchedAt: new Date().toISOString(), ok: true, body: res.body }
      : { url, fetchedAt: new Date().toISOString(), ok: false, reason: res.reason };
    writeCache(page);
  }
  if (!page.ok || !page.body) {
    return {
      ...base,
      status: page.reason?.includes('blocked') ? 'blocked' : 'error',
      detail: page.reason,
    };
  }

  const parsed = parseSiteHours(page.body);
  if (parsed.outcome === 'none') return { ...base, status: 'no-hours', detail: parsed.reason };
  if (parsed.outcome === 'needs_human') {
    return { ...base, status: 'needs_human', detail: parsed.reason };
  }
  // Only the structured tier is trustworthy enough to publish. schema-text is
  // a hint for a human, never a source.
  if (parsed.tier !== 'jsonld') {
    return { ...base, status: 'low-tier', detail: `tier=${parsed.tier}`, hours: parsed.hours };
  }

  const verdict = assessSiteCandidate({ html: page.body, siteHours: parsed.hours, osmHours });
  if (verdict.verdict === 'reject') {
    return { ...base, status: 'rejected-google', detail: verdict.reason };
  }
  if (verdict.verdict === 'correlated') {
    return { ...base, status: 'correlated', detail: verdict.reason, hours: parsed.hours };
  }
  return { ...base, status: 'parsed', hours: parsed.hours };
}

// ------------------------------------------------------------------ main

async function loadCatalog(): Promise<CatalogRow[]> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const { rows } = await client.query<CatalogRow>(
      'select id, name, lat, lng, hours, hours_source, hours_confidence from public.bars',
    );
    return rows;
  } finally {
    await client.end();
  }
}

async function pool<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    new Array(Math.min(size, items.length)).fill(0).map(async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

async function main(): Promise<void> {
  if (!existsSync(OSM_CACHE)) {
    console.error(`missing ${OSM_CACHE} — run scripts/osm-hours-sweep.mts first`);
    process.exit(1);
  }
  const elements = (JSON.parse(readFileSync(OSM_CACHE, 'utf8')) as { elements: OverpassElement[] })
    .elements;
  const osmVenues = elements.map(toOsmVenue).filter((v): v is OsmVenue => v !== null);
  const catalog = await loadCatalog();
  console.log(`catalog: ${catalog.length} venues · OSM: ${osmVenues.length} named venues`);

  // Seed: catalog venues whose matched OSM record carries a website.
  const seeds: Array<{ row: CatalogRow; url: string; osmHours?: WeeklyHours }> = [];
  for (const row of catalog) {
    const match = matchOsmVenue(row, osmVenues);
    if (match.outcome !== 'matched' || !match.osm.website) continue;
    const osmParsed = match.osm.openingHours
      ? parseOsmOpeningHours(match.osm.openingHours)
      : null;
    seeds.push({
      row,
      url: match.osm.website,
      osmHours: osmParsed?.outcome === 'parsed' ? osmParsed.hours : undefined,
    });
  }
  const targets = seeds.slice(0, LIMIT === Infinity ? seeds.length : LIMIT);
  console.log(
    `seeded ${seeds.length} venues with a website${
      targets.length !== seeds.length ? ` (crawling ${targets.length} — --limit)` : ''
    }\n`,
  );

  const results = await pool(targets, CONCURRENCY, (t) => crawlOne(t.row, t.url, t.osmHours));

  const byStatus = new Map<string, number>();
  for (const r of results) byStatus.set(r.status, (byStatus.get(r.status) ?? 0) + 1);
  console.log('OUTCOMES');
  for (const [status, n] of [...byStatus].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${status.padEnd(16)} ${n}`);
  }

  // What the ladder would do, and what the correlation gate costs.
  let wouldVerify = 0;
  let wouldReport = 0;
  let suppressedByCorrelation = 0;
  const now = new Date().toISOString();
  const writes: Array<{ id: string; hours: WeeklyHours; confidence: string }> = [];

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const seed = targets[i];
    if (!r.hours || (r.status !== 'parsed' && r.status !== 'correlated')) continue;

    const candidates: HoursCandidate[] = [
      { source: 'official_site', hours: r.hours, observedAt: now, evidenceUrl: r.url },
    ];
    if (seed.osmHours) {
      candidates.push({ source: 'osm', hours: seed.osmHours, observedAt: now });
    }
    const resolved = resolveHours(candidates);

    if (r.status === 'correlated') {
      // The site agreed with OSM. Without the gate this pair would have been
      // two agreeing sources = verified; with it, the site stands alone.
      if (resolved.outcome === 'verified') suppressedByCorrelation++;
      const solo = resolveHours([candidates[0]]);
      if (solo.outcome === 'reported') {
        wouldReport++;
        writes.push({ id: r.barId, hours: solo.hours, confidence: 'reported' });
      }
      continue;
    }
    if (resolved.outcome === 'verified') {
      wouldVerify++;
      writes.push({ id: r.barId, hours: resolved.hours, confidence: 'verified' });
    } else if (resolved.outcome === 'reported') {
      wouldReport++;
      writes.push({ id: r.barId, hours: resolved.hours, confidence: 'reported' });
    }
  }

  console.log('\nLADDER (what --apply would write)');
  console.log(`  verified   ${wouldVerify}`);
  console.log(`  reported   ${wouldReport}`);
  console.log(
    `  suppressed ${suppressedByCorrelation}  ` +
      '(site agreed with OSM; correlation gate refused to call that verified)',
  );

  const samples = results.filter((r) => r.status === 'parsed').slice(0, 5);
  if (samples.length > 0) {
    console.log('\nSAMPLE PARSES');
    for (const s of samples) console.log(`  ${s.name} — ${s.url}`);
  }
  const failures = results.filter((r) => r.status === 'error' || r.status === 'blocked').slice(0, 5);
  if (failures.length > 0) {
    console.log('\nSAMPLE FAILURES (these must NEVER demote a venue)');
    for (const f of failures) console.log(`  ${f.name} — ${f.status}: ${f.detail}`);
  }

  if (!APPLY) {
    console.log('\nDRY RUN — nothing written. Re-run with --apply to write.');
    return;
  }
  await applyWrites(writes);
}

/**
 * Per-venue, idempotent writes. Deliberately NOT one big transaction: a
 * partial crawl should keep the venues it did resolve rather than roll the
 * whole run back, and each statement is safe to repeat.
 */
async function applyWrites(
  writes: Array<{ id: string; hours: WeeklyHours; confidence: string }>,
): Promise<void> {
  if (writes.length === 0) {
    console.log('\nnothing to write.');
    return;
  }
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  let ok = 0;
  let failed = 0;
  try {
    for (const w of writes) {
      try {
        await client.query(
          `update public.bars
              set hours = $2::jsonb,
                  hours_source = 'official_site',
                  hours_confidence = $3,
                  hours_verified_at = now()
            where id = $1`,
          [w.id, JSON.stringify(w.hours), w.confidence],
        );
        ok++;
      } catch (e) {
        failed++;
        console.error(`  write failed for ${w.id}: ${(e as Error).message}`);
      }
    }
  } finally {
    await client.end();
  }
  console.log(`\nAPPLIED ${ok} row(s), ${failed} failed.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
