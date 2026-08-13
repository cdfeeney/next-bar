import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config as dotenv } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import {
  parseFivePm,
  reconcilePlaces,
  selectPlace,
  type GooglePlace,
  type Rejection,
  type StagingBar,
  type ValidatedPlace,
} from './census/manhattan-curation';

const PROJECT_REF = 'wqxovhiovgcijmfzxgby';
const SOURCE_URL = 'https://5pm.nyc/best-happy-hours-manhattan/';
const VERIFIED_DATE = '2026-08-13';
const outDir = path.resolve('docs/release-artifacts/v7-manhattan-staging-2026-08-13-v2');
const stagingEnvPath = path.resolve(process.argv[2] ?? '.env.local');
const googleEnvPath = path.resolve(process.argv[3] ?? process.argv[2] ?? '.env.local');
const FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.location',
  'places.addressComponents',
  'places.primaryType',
  'places.types',
  'places.businessStatus',
].join(',');

const sha256 = (value: string | Buffer): string =>
  createHash('sha256').update(value).digest('hex');

function writeJson(name: string, value: unknown): string {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  fs.writeFileSync(path.join(outDir, name), text, { flag: 'wx' });
  return sha256(text);
}

async function fetchPlace(
  source: ReturnType<typeof parseFivePm>[number],
  apiKey: string,
): Promise<GooglePlace[]> {
  const response = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': FIELD_MASK,
    },
    body: JSON.stringify({
      textQuery: `${source.name}, ${source.address}`,
      maxResultCount: 3,
      locationBias: {
        rectangle: {
          low: { latitude: 40.68, longitude: -74.03 },
          high: { latitude: 40.89, longitude: -73.90 },
        },
      },
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Google Places returned HTTP ${response.status}`);
  const body = await response.json() as { places?: GooglePlace[] };
  return body.places ?? [];
}

async function main(): Promise<void> {
  if (fs.existsSync(path.join(outDir, 'manifest.json'))) {
    throw new Error(`refusing to overwrite immutable output: ${outDir}`);
  }
  dotenv({ path: stagingEnvPath, quiet: true });
  // `override:false` preserves the already-loaded staging identity while adding the Google key.
  dotenv({ path: googleEnvPath, quiet: true, override: false });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!url || !anonKey || !apiKey) throw new Error('staging read and Google Places credentials are required');
  if (new URL(url).hostname !== `${PROJECT_REF}.supabase.co`) throw new Error('refusing non-staging Supabase host');

  const sourceResponse = await fetch(SOURCE_URL, { signal: AbortSignal.timeout(60_000) });
  if (!sourceResponse.ok) throw new Error(`5PM returned HTTP ${sourceResponse.status}`);
  const sourceHtml = await sourceResponse.text();
  const sources = parseFivePm(sourceHtml);
  if (sources.length !== 1516) throw new Error(`5PM completeness mismatch: expected 1516, got ${sources.length}`);

  const supabase = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const count = await supabase.from('bars').select('id', { count: 'exact', head: true });
  if (count.error || count.count === null) throw new Error(`staging count failed: ${count.error?.message}`);
  const staging: StagingBar[] = [];
  let pages = 0;
  for (let from = 0; ; from += 1000) {
    const result = await supabase.from('bars')
      .select('id,name,neighborhood,address,lat,lng,place_id')
      .order('id', { ascending: true }).range(from, from + 999);
    if (result.error || !result.data) throw new Error(`staging page failed: ${result.error?.message}`);
    staging.push(...result.data as StagingBar[]);
    pages++;
    if (result.data.length < 1000) break;
  }
  if (staging.length !== count.count) throw new Error('staging pagination count mismatch');

  fs.mkdirSync(outDir, { recursive: true });
  const preservedPath = path.join(outDir, 'places-results.partial.json');
  const resumePath = path.join(outDir, 'places-results.resume.ndjson');
  const preserved = fs.existsSync(preservedPath)
    ? JSON.parse(fs.readFileSync(preservedPath, 'utf8')) as Array<{ source: typeof sources[number]; places: GooglePlace[] }>
    : [];
  const resumed = fs.existsSync(resumePath)
    ? fs.readFileSync(resumePath, 'utf8').split(/\r?\n/).filter(Boolean)
      .map((line) => JSON.parse(line) as { source: typeof sources[number]; places: GooglePlace[] })
    : [];
  const responses = [...preserved, ...resumed];
  const sourceKey = (source: typeof sources[number]) => `${source.name}\n${source.address}`;
  responses.forEach((row, index) => {
    if (sourceKey(row.source) !== sourceKey(sources[index])) {
      throw new Error(`preserved Google response does not match source row ${index + 1}`);
    }
  });
  if (responses.length > sources.length) throw new Error('preserved Google responses exceed source rows');

  // Sequential 2 QPS; every successful response is durably appended before the next call. No retries.
  for (let index = responses.length; index < sources.length; index++) {
    const source = sources[index];
    const places = await fetchPlace(source, apiKey);
    const row = { source, places };
    fs.appendFileSync(resumePath, `${JSON.stringify(row)}\n`);
    responses.push(row);
    if ((index + 1) % 100 === 0) process.stdout.write(`validated ${index + 1}/${sources.length}\n`);
    if (index + 1 < sources.length) await new Promise((resolve) => setTimeout(resolve, 500));
  }

  const validated: ValidatedPlace[] = [];
  const rejected: Rejection[] = [];
  for (const row of responses) {
    const selected = selectPlace(row.source, row.places);
    if (selected.place) validated.push({ source: row.source, place: selected.place });
    else rejected.push({ name: row.source.name, address: row.source.address, reason: selected.reason! });
  }

  const result = reconcilePlaces({ validated, rejected, staging, verifiedDate: VERIFIED_DATE });
  if (result.curated.length + result.unchanged.length + result.rejected.length !== sources.length) {
    throw new Error('candidate accounting mismatch');
  }

  fs.mkdirSync(outDir, { recursive: true });
  const hashes: Record<string, string> = {};
  hashes['source-snapshot.json'] = writeJson('source-snapshot.json', sources);
  hashes['places-results.json'] = writeJson('places-results.json', responses);
  hashes['curated-payload.json'] = writeJson('curated-payload.json', result.curated);
  hashes['accepted-evidence.json'] = writeJson('accepted-evidence.json', validated);
  hashes['unchanged.json'] = writeJson('unchanged.json', result.unchanged);
  hashes['rejections.json'] = writeJson('rejections.json', result.rejected);
  hashes['prewrite-update-backup.json'] = writeJson('prewrite-update-backup.json', []);
  hashes['staging-baseline.json'] = writeJson('staging-baseline.json', {
    projectRef: PROJECT_REF,
    retrievedAt: new Date().toISOString(),
    exactCount: count.count,
    paginatedRows: staging.length,
    pages,
    duplicateIds: staging.length - new Set(staging.map((row) => row.id)).size,
  });

  const ids = result.curated.map((row) => `'${row.id.replaceAll("'", "''")}'`).join(', ');
  const rollback = `-- Generated before apply; exact insert-only rollback.\nBEGIN;\nDO $$ BEGIN\n  IF (SELECT count(*) FROM public.bars WHERE source='census' AND id IN (${ids})) <> ${result.curated.length} THEN\n    RAISE EXCEPTION 'rollback target mismatch';\n  END IF;\nEND $$;\nDELETE FROM public.bars WHERE source='census' AND id IN (${ids});\nCOMMIT;\n`;
  fs.writeFileSync(path.join(outDir, 'rollback.sql'), rollback, { flag: 'wx' });
  hashes['rollback.sql'] = sha256(rollback);

  const reasonCounts = Object.fromEntries([...new Set(result.rejected.map((row) => row.reason))]
    .sort().map((reason) => [reason, result.rejected.filter((row) => row.reason === reason).length]));
  const manifest = {
    projectRef: PROJECT_REF,
    source: SOURCE_URL,
    sourceRows: sources.length,
    googlePlacesCalls: sources.length,
    preservedGoogleResponses: preserved.length,
    resumedGoogleCalls: responses.length - preserved.length,
    googleFieldMask: FIELD_MASK,
    stagingBaseline: count.count,
    inserts: result.curated.length,
    updates: 0,
    unchanged: result.unchanged.length,
    rejects: result.rejected.length,
    projectedStagingCount: count.count + result.curated.length,
    exactInsertIds: result.curated.map((row) => row.id),
    reasonCounts,
    hashes,
    writePerformed: false,
  };
  writeJson('manifest.json', manifest);
  fs.writeFileSync(path.join(outDir, 'README.md'), `# V7 Manhattan staging apply packet v2\n\n- 5PM Manhattan source rows: **${sources.length}**\n- Google Places calls: **${sources.length}** (no retries)\n- Fresh staging baseline: **${count.count}**\n- Exact inserts: **${result.curated.length}**\n- Exact updates: **0**\n- Already present: **${result.unchanged.length}**\n- Rejected after Google validation: **${result.rejected.length}**\n- Projected staging count: **${count.count + result.curated.length}**\n- Payload SHA-256: \`${hashes['curated-payload.json']}\`\n- Database write performed: **no**\n`, { flag: 'wx' });
  console.log(JSON.stringify({
    sourceRows: sources.length,
    googlePlacesCalls: sources.length,
    stagingBaseline: count.count,
    inserts: result.curated.length,
    updates: 0,
    unchanged: result.unchanged.length,
    rejects: result.rejected.length,
    projectedStagingCount: count.count + result.curated.length,
    payloadSha256: hashes['curated-payload.json'],
    rollbackSha256: hashes['rollback.sql'],
    writePerformed: false,
  }, null, 2));
}

await main();
