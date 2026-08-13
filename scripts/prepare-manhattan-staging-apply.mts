import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config as dotenv } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import {
  curateManhattanCandidates,
  type OsmNode,
  type SlaLicense,
  type StagingBar,
} from './census/manhattan-curation';
import type { NormalizedCandidate } from './census/types';

const PROJECT_REF = 'wqxovhiovgcijmfzxgby';
const VERIFIED_DATE = '2026-08-13';
const packetPath = path.resolve(
  'scripts/census/out/run-2026-08-05T00-25-06-752Z/expansion-packet.json',
);
const outDir = path.resolve(
  'docs/release-artifacts/v7-manhattan-staging-2026-08-13',
);
const envPath = path.resolve(process.argv[2] ?? '.env.local');

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'NextBar attended Manhattan curation/1.0' },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`read-only source returned HTTP ${response.status}`);
  return response.json() as Promise<T>;
}

function writeJson(name: string, value: unknown): string {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  fs.writeFileSync(path.join(outDir, name), text, { flag: 'wx' });
  return sha256(text);
}

function sqlLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

async function main(): Promise<void> {
  if (fs.existsSync(outDir) && fs.readdirSync(outDir).length > 0) {
    throw new Error(`refusing to overwrite immutable output: ${outDir}`);
  }
  if (!fs.existsSync(packetPath)) throw new Error(`missing reviewed packet: ${packetPath}`);

  dotenv({ path: envPath, quiet: true });
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) throw new Error('staging URL and anon key are required');
  const host = new URL(supabaseUrl).hostname;
  if (host !== `${PROJECT_REF}.supabase.co`) {
    throw new Error(`refusing non-staging Supabase host: ${host}`);
  }

  const packetText = fs.readFileSync(packetPath, 'utf8');
  const packet = JSON.parse(packetText) as {
    newInserts: NormalizedCandidate[];
    newInsertsCount: number;
  };
  if (packet.newInserts.length !== 1286 || packet.newInsertsCount !== 1286) {
    throw new Error('reviewed candidate pool identity/count mismatch');
  }

  const osmIds = packet.newInserts
    .filter((candidate) => candidate.provider === 'osm')
    .map((candidate) => candidate.externalId.match(/^osm:node\/(\d+)$/)?.[1])
    .filter((id): id is string => Boolean(id));
  const osmUrl = `https://api.openstreetmap.org/api/0.6/nodes.json?nodes=${osmIds.join(',')}`;
  const classes = ['Additional Bar', 'Club', 'Cabaret', 'Night Club', 'Bottle Club'];
  const where = `premisescounty='New York' AND description in(${classes.map((item) => `'${item}'`).join(',')})`;
  const slaUrl = 'https://data.ny.gov/resource/9s3h-dpkz.json?'
    + new URLSearchParams({
      '$limit': '5000',
      '$order': 'licensepermitid',
      '$where': where,
    });

  // Exactly one request per public source. There is deliberately no retry loop.
  const [osm, sla] = await Promise.all([
    getJson<{ elements?: OsmNode[] }>(osmUrl),
    getJson<SlaLicense[]>(slaUrl),
  ]);
  if ((osm.elements?.length ?? 0) !== osmIds.length) {
    throw new Error(`OSM completeness mismatch: expected ${osmIds.length}, got ${osm.elements?.length ?? 0}`);
  }
  if (sla.length >= 5000) throw new Error('SLA result hit the request cap; pagination required');

  const supabase = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const countResult = await supabase.from('bars').select('id', { count: 'exact', head: true });
  if (countResult.error || countResult.count === null) {
    throw new Error(`staging count failed: ${countResult.error?.message ?? 'missing count'}`);
  }
  const staging: StagingBar[] = [];
  let pages = 0;
  for (let from = 0; ; from += 1000) {
    const result = await supabase
      .from('bars')
      .select('id,name,neighborhood,address,lat,lng')
      .order('id', { ascending: true })
      .range(from, from + 999);
    if (result.error || !result.data) throw new Error(`staging page failed: ${result.error?.message}`);
    staging.push(...result.data as StagingBar[]);
    pages++;
    if (result.data.length < 1000) break;
  }
  if (staging.length !== countResult.count) {
    throw new Error(`staging pagination mismatch: count ${countResult.count}, rows ${staging.length}`);
  }

  const retrievedAt = new Date().toISOString();
  const result = curateManhattanCandidates({
    candidates: packet.newInserts,
    osmNodes: osm.elements ?? [],
    slaLicenses: sla,
    staging,
    verifiedDate: VERIFIED_DATE,
  });
  const reasonCounts = Object.fromEntries(
    [...new Set(result.rejected.map((item) => item.reason))]
      .sort()
      .map((reason) => [reason, result.rejected.filter((item) => item.reason === reason).length]),
  );

  fs.mkdirSync(outDir, { recursive: true });
  const hashes: Record<string, string> = {};
  hashes['curated-payload.json'] = writeJson('curated-payload.json', result.curated);
  hashes['accepted-evidence.json'] = writeJson('accepted-evidence.json', result.evidence);
  hashes['rejections.json'] = writeJson('rejections.json', result.rejected);
  hashes['prewrite-update-backup.json'] = writeJson('prewrite-update-backup.json', []);
  hashes['staging-baseline.json'] = writeJson('staging-baseline.json', {
    projectRef: PROJECT_REF,
    host,
    retrievedAt,
    exactCount: countResult.count,
    paginatedRows: staging.length,
    pages,
    duplicateIds: staging.length - new Set(staging.map((row) => row.id)).size,
  });

  const ids = result.curated.map((row) => sqlLiteral(row.id)).join(', ');
  const rollback = `-- Generated before apply. Run only after a successful application of this exact payload.\nBEGIN;\nDO $$\nBEGIN\n  IF (SELECT count(*) FROM public.bars WHERE source = 'census' AND id IN (${ids})) <> ${result.curated.length} THEN\n    RAISE EXCEPTION 'rollback target mismatch';\n  END IF;\nEND $$;\nDELETE FROM public.bars WHERE source = 'census' AND id IN (${ids});\nCOMMIT;\n`;
  fs.writeFileSync(path.join(outDir, 'rollback.sql'), rollback, { flag: 'wx' });
  hashes['rollback.sql'] = sha256(rollback);

  const manifest = {
    projectRef: PROJECT_REF,
    retrievedAt,
    catalogGoal: 'g-779223ab-a469-4fc8-bad7-6623c186db67',
    catalogCandidate: '6a9ff0fa8b4edfdaecc328d7916b922dbf0eeba485c262ef07063a2a70fe8127',
    catalogCommit: '8cbb8a64730d61e4ed0a2f8a90491ba2be42107d',
    packetSha256: sha256(packetText),
    candidatePool: packet.newInserts.length,
    stagingBaseline: countResult.count,
    inserts: result.curated.length,
    updates: 0,
    unchanged: 0,
    rejects: result.rejected.length,
    projectedStagingCount: countResult.count + result.curated.length,
    reasonCounts,
    exactInsertIds: result.curated.map((row) => row.id),
    hashes,
    sourceReads: {
      osm: { requested: osmIds.length, returned: osm.elements?.length ?? 0, url: 'OpenStreetMap API v0.6 multi-fetch' },
      sla: { returned: sla.length, dataset: 'Current Liquor Authority Active Licenses (9s3h-dpkz)' },
      staging: { projectRef: PROJECT_REF, rows: staging.length, pages },
    },
    writePerformed: false,
  };
  writeJson('manifest.json', manifest);
  const markdown = `# V7 Manhattan staging apply packet\n\n- Project: \`${PROJECT_REF}\`\n- Fresh staging baseline: **${countResult.count}** rows (${pages} page)\n- Reviewed candidate pool: **${packet.newInserts.length}**\n- Exact inserts: **${result.curated.length}**\n- Exact updates: **0**\n- Unchanged: **0**\n- Rejects: **${result.rejected.length}**\n- Projected staging count: **${countResult.count + result.curated.length}**\n- Payload SHA-256: \`${hashes['curated-payload.json']}\`\n- Rollback SHA-256: \`${hashes['rollback.sql']}\`\n- Database write performed: **no**\n\nAll accepted rows have a current named OpenStreetMap bar record and exactly one current active NY SLA license at the same address within 50 metres. Price tier 2 is an explicit conservative editorial assignment; no paid price provider was contacted. See \`rejections.json\` for complete candidate accounting.\n`;
  fs.writeFileSync(path.join(outDir, 'README.md'), markdown, { flag: 'wx' });

  console.log(JSON.stringify({
    projectRef: PROJECT_REF,
    stagingBaseline: countResult.count,
    candidatePool: packet.newInserts.length,
    inserts: result.curated.length,
    updates: 0,
    rejects: result.rejected.length,
    projectedStagingCount: countResult.count + result.curated.length,
    payloadSha256: hashes['curated-payload.json'],
    rollbackSha256: hashes['rollback.sql'],
    output: outDir,
    writePerformed: false,
  }, null, 2));
}

await main();
