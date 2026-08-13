import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config as dotenv } from 'dotenv';
import { Client } from 'pg';
import { createClient } from '@supabase/supabase-js';
import { applyCurated, type CuratedCandidate } from './census/apply';
import {
  reconcilePlaces,
  type GooglePlace,
  type Rejection,
  type StagingBar,
  type ValidatedPlace,
} from './census/manhattan-curation';
import { rowToBar, type BarsTableRow } from '../src/lib/catalogServer';

const PROJECT_REF = 'wqxovhiovgcijmfzxgby';
const BASELINE = 412;
const EXPECTED_INSERTS = 1255;
const V2 = path.resolve('docs/release-artifacts/v7-manhattan-staging-2026-08-13-v2');
const V3 = path.resolve('docs/release-artifacts/v7-manhattan-staging-2026-08-13-v3');
const ENV_PATH = path.resolve(process.argv[3] ?? '.env.local');
const APPROVED_PLACE_IDS = new Set([
  'ChIJ_abIqHtZwokRLWbw0G-lzu8', 'ChIJsVWcZ-xZwokRht1UHKE3DYA',
  'ChIJKYbKCABZwokRt6RlaEpSEP4', 'ChIJN-93ZsBZwokRpyoeLj9bzqQ',
  'ChIJM_yFLxRawokR4OUO3XdR5Yw', 'ChIJhcLI8rn3wokR0x3EH2I_zeI',
  'ChIJKTZTKKVZwokRxEIWK4ln3HA', 'ChIJMXyIpYpZwokR34KDxt5BROI',
  'ChIJHzArVstZwokRwS4dyVXt2jA', 'ChIJb-R6YVhZwokR0G353ivsIRc',
  'ChIJldB8qZNZwokRYwDAq_cgDro', 'ChIJ6-dvhvjzwokRvijkh52fhiQ',
  'ChIJC-0-t_lYwokRaleYQX_GVOk', 'ChIJO851nKf2wokRt0FnUtV9omg',
  'ChIJ_4J9M7BZwokRWbBbGRl-TGY',
]);

const sha256 = (value: string | Buffer): string =>
  createHash('sha256').update(value).digest('hex');
const readJson = <T>(file: string): T => JSON.parse(fs.readFileSync(file, 'utf8')) as T;
const sourceKey = (row: { name: string; address: string }): string => `${row.name}\n${row.address}`;

function writeJson(name: string, value: unknown): string {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  fs.writeFileSync(path.join(V3, name), text, { flag: 'wx' });
  return sha256(text);
}

async function readStaging(): Promise<StagingBar[]> {
  dotenv({ path: ENV_PATH, quiet: true });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key || new URL(url).hostname !== `${PROJECT_REF}.supabase.co`) {
    throw new Error('required staging read credentials are missing or target the wrong project');
  }
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const rows: StagingBar[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await client.from('bars')
      .select('id,name,neighborhood,address,lat,lng,place_id').order('id').range(from, from + 999);
    if (error || !data) throw new Error(`staging read failed: ${error?.message}`);
    rows.push(...data as StagingBar[]);
    if (data.length < 1000) break;
  }
  if (rows.length !== BASELINE) throw new Error(`staging baseline changed: expected ${BASELINE}, got ${rows.length}`);
  return rows;
}

async function prepare(): Promise<void> {
  if (fs.existsSync(V3) && fs.readdirSync(V3).length > 0) throw new Error(`refusing non-empty output ${V3}`);
  const staging = await readStaging();
  const base = readJson<CuratedCandidate[]>(path.join(V2, 'curated-payload.json'));
  const baseEvidence = readJson<ValidatedPlace[]>(path.join(V2, 'accepted-evidence.json'));
  const responses = readJson<Array<{ source: ValidatedPlace['source']; places: GooglePlace[] }>>(
    path.join(V2, 'places-results.json'),
  );
  const originalRejected = readJson<Rejection[]>(path.join(V2, 'rejections.json'));
  const originalRejectedKeys = new Set(originalRejected.map(sourceKey));
  const approved: ValidatedPlace[] = [];
  const approvedSourceKeys = new Set<string>();
  for (const response of responses) {
    if (!originalRejectedKeys.has(sourceKey(response.source))) continue;
    const place = response.places.find((candidate) => APPROVED_PLACE_IDS.has(candidate.id));
    if (!place) continue;
    approved.push({ source: response.source, place });
    approvedSourceKeys.add(sourceKey(response.source));
  }
  if (approved.length !== 15 || approvedSourceKeys.size !== 15) {
    throw new Error(`owner approval mismatch: expected 15, got ${approved.length}/${approvedSourceKeys.size}`);
  }

  const additions = reconcilePlaces({ validated: approved, rejected: [], staging, verifiedDate: '2026-08-13' });
  const combined = [...base, ...additions.curated];
  let insertRows: Array<Record<string, unknown>> = [];
  const dryRun = await applyCurated({
    selectExisting: async (from, to) => ({
      data: staging.slice(from, to + 1).map(({ id, name, neighborhood }) => ({ id, name, neighborhood })),
      error: null,
    }),
    insert: async (rows) => { insertRows = rows; return { error: null }; },
  }, combined, (row) => rowToBar(row as BarsTableRow) !== null);
  if (dryRun.inserted !== EXPECTED_INSERTS || dryRun.rejected.length !== 3) {
    throw new Error(`apply preflight mismatch: ${dryRun.inserted} inserts, ${dryRun.rejected.length} rejects`);
  }
  const candidateById = new Map<string, CuratedCandidate>();
  combined.forEach((row) => { if (!candidateById.has(row.id)) candidateById.set(row.id, row); });
  const curated = insertRows.map((row) => candidateById.get(row.id as string)!);
  if (curated.some((row) => !row) || new Set(curated.map((row) => row.id)).size !== EXPECTED_INSERTS) {
    throw new Error('final curated payload is missing or duplicating IDs');
  }
  if (new Set(curated.map((row) => row.placeId)).size !== EXPECTED_INSERTS) {
    throw new Error('final curated payload contains duplicate Place IDs');
  }

  const evidenceByPlace = new Map<string, ValidatedPlace>();
  [...baseEvidence, ...approved].forEach((item) => {
    if (!evidenceByPlace.has(item.place.id)) evidenceByPlace.set(item.place.id, item);
  });
  const evidence = curated.map((row) => evidenceByPlace.get(row.placeId!)!);
  if (evidence.some((row) => !row)) throw new Error('accepted evidence is incomplete');
  const unchangedById = new Map<string, StagingBar>();
  readJson<StagingBar[]>(path.join(V2, 'unchanged.json')).forEach((row) => unchangedById.set(row.id, row));
  additions.unchanged.forEach((row) => unchangedById.set(row.id, row));
  const unchanged = [...unchangedById.values()].sort((a, b) => a.id.localeCompare(b.id));
  const rejected: Rejection[] = originalRejected
    .filter((row) => !approvedSourceKeys.has(sourceKey(row)))
    .concat(dryRun.rejected.map((row) => ({
      name: candidateById.get(row.id)?.name ?? row.id,
      address: candidateById.get(row.id)?.address ?? '',
      reason: row.reason,
    })))
    .sort((a, b) => a.name.localeCompare(b.name) || a.address.localeCompare(b.address));
  if (curated.length + unchanged.length + rejected.length !== 1516) throw new Error('final accounting mismatch');

  fs.mkdirSync(V3, { recursive: true });
  const hashes: Record<string, string> = {};
  hashes['curated-payload.json'] = writeJson('curated-payload.json', curated);
  hashes['insert-rows.json'] = writeJson('insert-rows.json', insertRows);
  hashes['accepted-evidence.json'] = writeJson('accepted-evidence.json', evidence);
  hashes['unchanged.json'] = writeJson('unchanged.json', unchanged);
  hashes['rejections.json'] = writeJson('rejections.json', rejected);
  hashes['prewrite-update-backup.json'] = writeJson('prewrite-update-backup.json', []);
  hashes['owner-decisions.json'] = writeJson('owner-decisions.json', {
    approvedPlaceIds: [...APPROVED_PLACE_IDS].sort(),
    approvedSourceRows: approved.map(({ source, place }) => ({
      sourceName: source.name, sourceAddress: source.address, placeId: place.id,
    })),
    checkpoint: 'D:/ClaudeData/NextBar/checkpoints/V7-MANHATTAN-OWNER-DECISIONS-2026-08-13.md',
  });
  const ids = curated.map((row) => `'${row.id}'`).join(', ');
  const rollback = `-- Exact insert-only rollback for V7 Manhattan staging packet v3.\nBEGIN;\nDO $$ BEGIN\n  IF (SELECT count(*) FROM public.bars WHERE source='census' AND id IN (${ids})) <> ${curated.length} THEN\n    RAISE EXCEPTION 'rollback target mismatch';\n  END IF;\nEND $$;\nDELETE FROM public.bars WHERE source='census' AND id IN (${ids});\nCOMMIT;\n`;
  fs.writeFileSync(path.join(V3, 'rollback.sql'), rollback, { flag: 'wx' });
  hashes['rollback.sql'] = sha256(rollback);
  writeJson('preapply-manifest.json', {
    projectRef: PROJECT_REF, sourceRows: 1516, stagingBaseline: BASELINE,
    inserts: curated.length, updates: 0, unchanged: unchanged.length, rejects: rejected.length,
    projectedStagingCount: BASELINE + curated.length, exactInsertIds: curated.map((row) => row.id),
    payloadSha256: hashes['curated-payload.json'], hashes, writePerformed: false,
  });
  console.log(JSON.stringify({ prepared: true, inserts: curated.length, unchanged: unchanged.length,
    rejects: rejected.length, projectedStagingCount: BASELINE + curated.length,
    payloadSha256: hashes['curated-payload.json'], writePerformed: false }, null, 2));
}

async function apply(): Promise<void> {
  dotenv({ path: ENV_PATH, quiet: true });
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  const parsed = new URL(databaseUrl);
  if (!`${parsed.username}@${parsed.hostname}`.includes(PROJECT_REF)) throw new Error('refusing non-staging database');
  const manifest = readJson<{ stagingBaseline: number; inserts: number; projectedStagingCount: number; payloadSha256: string; hashes: Record<string, string> }>(path.join(V3, 'preapply-manifest.json'));
  if (manifest.stagingBaseline !== BASELINE || manifest.inserts !== EXPECTED_INSERTS
      || manifest.projectedStagingCount !== BASELINE + EXPECTED_INSERTS) throw new Error('manifest count mismatch');
  for (const [name, expected] of Object.entries(manifest.hashes)) {
    if (sha256(fs.readFileSync(path.join(V3, name))) !== expected) throw new Error(`${name} hash mismatch`);
  }
  const insertRows = readJson<Array<Record<string, unknown>>>(path.join(V3, 'insert-rows.json'));
  if (insertRows.length !== EXPECTED_INSERTS || new Set(insertRows.map((row) => row.id)).size !== EXPECTED_INSERTS) {
    throw new Error('insert row identity mismatch');
  }

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  let committed = false;
  try {
    await client.query('begin isolation level serializable');
    await client.query('lock table public.bars in share row exclusive mode');
    const before = await client.query<{ count: number }>('select count(*)::integer as count from public.bars');
    if (before.rows[0]?.count !== BASELINE) throw new Error(`staging changed before apply: ${before.rows[0]?.count}`);
    const inserted = await client.query<{ id: string }>(`
      insert into public.bars
        (id,name,lat,lng,tags,neighborhood,price_tier,hours,blurb,address,place_id,
         business_status,photo_count,photo_attributions,reviews,last_verified,source)
      select id,name,lat,lng,tags,neighborhood,price_tier,hours,blurb,address,place_id,
             business_status,photo_count,photo_attributions,reviews,last_verified,source
        from jsonb_populate_recordset(null::public.bars, $1::jsonb)
      returning id
    `, [JSON.stringify(insertRows)]);
    if (inserted.rowCount !== EXPECTED_INSERTS) throw new Error(`insert returned ${inserted.rowCount}`);
    const after = await client.query<{ count: number }>('select count(*)::integer as count from public.bars');
    if (after.rows[0]?.count !== BASELINE + EXPECTED_INSERTS) throw new Error(`transaction count mismatch: ${after.rows[0]?.count}`);
    await client.query('commit');
    committed = true;
  } catch (error) {
    if (!committed) await client.query('rollback').catch(() => {});
    throw error;
  } finally {
    await client.end();
  }

  const verifier = new Client({ connectionString: databaseUrl });
  await verifier.connect();
  const ids = insertRows.map((row) => row.id as string);
  const post = await verifier.query<{ total: number; inserted: number; unique_places: number }>(`
    select (select count(*)::integer from public.bars) as total,
           count(*)::integer as inserted,
           count(distinct place_id)::integer as unique_places
      from public.bars where id = any($1::text[])
  `, [ids]);
  await verifier.end();
  if (post.rows[0]?.total !== BASELINE + EXPECTED_INSERTS
      || post.rows[0]?.inserted !== EXPECTED_INSERTS
      || post.rows[0]?.unique_places !== EXPECTED_INSERTS) throw new Error('post-commit verification failed');
  const result = {
    projectRef: PROJECT_REF, appliedAt: new Date().toISOString(),
    inserted: EXPECTED_INSERTS, postWriteCount: post.rows[0].total,
    uniqueInsertedPlaceIds: post.rows[0].unique_places,
    payloadSha256: manifest.payloadSha256, writePerformed: true,
  };
  writeJson('apply-result.json', result);
  console.log(JSON.stringify(result, null, 2));
}

const command = process.argv[2];
if (command === '--prepare') await prepare();
else if (command === '--apply') await apply();
else throw new Error('usage: tsx scripts/finalize-apply-manhattan-staging.mts <--prepare|--apply> <env-file>');
