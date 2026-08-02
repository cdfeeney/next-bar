/**
 * Census command (goal g-4531bbf0) — replaces nearby-sweep.mjs,
 * ingest-bars.ts, and import-bars.mts with one provider-based pipeline.
 *
 *   npx tsx scripts/census/run-census.mts --borough brooklyn [--borough manhattan]
 *       [--sources google,osm,sla,url-seed,user-submission]
 *       [--budget 200] [--resume <runId>] [--report] [--mock]
 *       [--apply <curated.json> --run <runId> [--max-age-days 7]]
 *
 * DRY-RUN BY DEFAULT: without --apply nothing outside scripts/census/out/
 * is written. --apply is the SOLE write path; it refuses under
 * LOOP_UNATTENDED=1, refuses a tampered/stale report (apply-sidecar hash),
 * and refuses curated rows whose provenance is not in the reviewed report.
 * --mock uses local fixtures — the only mode permitted unattended.
 */
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { join } from 'node:path';
import { config as dotenv } from 'dotenv';
import { refuseIfUnattended } from '../loop-guard.mjs';
import {
  applyCurated,
  checkApplyPreconditions,
  type ApplySidecar,
  type CuratedCandidate,
} from './apply';
import { runCensus } from './runner';
import type { Transport } from './types';

const args = process.argv.slice(2);
function flagValue(name: string): string | null {
  const i = args.indexOf(name);
  return i !== -1 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : null;
}
function flagValues(name: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === name && args[i + 1] && !args[i + 1].startsWith('--')) out.push(args[i + 1]);
  }
  return out;
}

const OUT_DIR = 'scripts/census/out';

/**
 * Code identity for checkpoints and the apply sidecar. HEAD alone is blind
 * to UNCOMMITTED edits of the generation logic (santa round-3): a tweaked
 * tiles.ts or dedupe.ts would pass every code_sha/code_drift check while
 * silently changing resume arithmetic and filtering. Dirt in the
 * generation-relevant paths therefore taints the SHA with a CONTENT hash
 * of those files — not a bare '-dirty' marker, which would let two
 * different uncommitted states masquerade as the same code (Codex
 * round-3). Identical uncommitted state still matches itself, so
 * iterating without committing works; any edit changes the identity.
 */
function currentCodeSha(): string {
  const head = execSync('git rev-parse HEAD').toString().trim();
  // -uall is load-bearing (Codex confirm pass): without it an UNTRACKED
  // directory prints as one `?? scripts/census/` line, readFileSync on the
  // directory throws, and the "content hash" collapses to a constant —
  // exactly the fail-open this function exists to prevent.
  const dirtyList = execSync(
    'git status --porcelain -uall -- scripts/census src/lib/catalogServer.ts',
  )
    .toString()
    .trim();
  if (!dirtyList) return head;
  const hash = createHash('sha256');
  const files = dirtyList
    .split('\n')
    .map((line) => line.slice(3).trim())
    .filter((p) => p && !p.startsWith('scripts/census/out'))
    .sort();
  for (const f of files) {
    hash.update(f);
    try {
      hash.update(fs.readFileSync(f));
    } catch {
      hash.update('<deleted>');
    }
  }
  return `${head}-dirty-${hash.digest('hex').slice(0, 12)}`;
}
const boroughs = flagValues('--borough').map((b) => b.toLowerCase());
const sources = (flagValue('--sources') ?? 'google,osm,sla,url-seed,user-submission')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const budget = Number(flagValue('--budget') ?? '200');
const resumeRunId = flagValue('--resume') ?? undefined;
const mock = args.includes('--mock');
const reportOnly = args.includes('--report');
const applyFile = flagValue('--apply');

async function main(): Promise<void> {
  if (applyFile) {
    await runApply(applyFile);
    return;
  }

  if (reportOnly) {
    // Regenerate report.json/report.md (+ sidecar) from an existing run's
    // unit files without fetching anything — e.g. after reviewing units.
    if (!resumeRunId) {
      console.error('--report requires --resume <runId> (the run to re-report)');
      process.exit(2);
    }
    const { reassembleReport } = await import('./runner');
    const path = reassembleReport(OUT_DIR, resumeRunId, () => new Date());
    console.log(`report regenerated at ${path}`);
    return;
  }

  if (boroughs.length === 0) {
    console.error('usage: run-census.mts --borough <name> [--sources a,b] [--budget N] [--resume runId] [--mock]');
    process.exit(2);
  }

  // A NaN/Infinity budget would disable the exhaustion comparison entirely
  // and let live providers run uncapped (Codex review) — refuse it.
  if (!Number.isFinite(budget) || budget <= 0 || !Number.isInteger(budget)) {
    console.error(`--budget must be a positive integer (got: ${flagValue('--budget')})`);
    process.exit(2);
  }

  // Live provider calls spend money/quota — attended only. Mocked runs are
  // free and deterministic, so the unattended loop may use them.
  if (!mock) refuseIfUnattended('live census provider calls');

  const transport = mock ? mockTransport() : liveTransport();
  const codeSha = currentCodeSha();
  const result = await runCensus({
    boroughs,
    sources,
    budget,
    outDir: OUT_DIR,
    codeSha,
    dataVersion: 'bars-table-v1',
    now: () => new Date(),
    transport,
    readTextFile: (p) => fs.readFileSync(p, 'utf8'),
    catalog: [], // dry-run dedup against live catalog happens at ATTENDED apply
    resumeRunId,
  });
  console.log(
    `census ${result.runId}: ${result.stopped}; report at ${result.reportPath}`,
  );
}

async function runApply(curatedPath: string): Promise<void> {
  // Structural guard #1: never unattended, checked before anything else.
  refuseIfUnattended('census --apply (bars table write)');

  const runId = flagValue('--run');
  if (!runId) {
    console.error('--apply requires --run <runId> (the reviewed dry-run to bind against)');
    process.exit(2);
  }
  const runDir = join(OUT_DIR, runId);
  const sidecar = JSON.parse(
    fs.readFileSync(join(runDir, 'apply-sidecar.json'), 'utf8'),
  ) as ApplySidecar;
  const report = JSON.parse(fs.readFileSync(join(runDir, 'report.json'), 'utf8'));
  const curated = JSON.parse(fs.readFileSync(curatedPath, 'utf8')) as CuratedCandidate[];

  const pre = checkApplyPreconditions({
    unattended: process.env.LOOP_UNATTENDED === '1',
    sidecar,
    reportCandidates: report.candidates,
    curated,
    maxAgeDays: Number(flagValue('--max-age-days') ?? '7'),
    now: new Date(),
    currentCodeSha: currentCodeSha(),
    allowCodeDrift: args.includes('--allow-code-drift'),
  });
  if (!pre.ok) {
    console.error(`apply REFUSED: ${pre.reason}`);
    process.exit(3);
  }

  dotenv({ path: '.env.local' });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('apply needs NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY');
    process.exit(2);
  }
  const { createClient } = await import('@supabase/supabase-js');
  const { rowToBar } = await import('../../src/lib/catalogServer');
  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const client = {
    selectExisting: async (from: number, to: number) => {
      const { data, error } = await admin
        .from('bars')
        .select('id,name,neighborhood')
        .order('id', { ascending: true })
        .range(from, to);
      return { data, error };
    },
    insert: async (rows: Array<Record<string, unknown>>) => {
      const { error } = await admin.from('bars').insert(rows);
      return { error };
    },
  };
  const { inserted, rejected } = await applyCurated(
    client,
    curated,
    (row) => rowToBar(row as never) !== null,
  );
  console.log(`APPLIED ${inserted}/${curated.length} rows (source='census').`);
  for (const r of rejected) console.log(`  REJECT ${r.id}: ${r.reason}`);
  if (inserted === 0 && curated.length > 0) process.exit(1);
}

function liveTransport(): Transport {
  return async (url, init) => {
    const headers: Record<string, string> = { ...(init?.headers ?? {}) };
    if (url.includes('places.googleapis.com')) {
      const key = process.env.GOOGLE_MAPS_API_KEY;
      if (!key) throw new Error('GOOGLE_MAPS_API_KEY required for live google census');
      headers['X-Goog-Api-Key'] = key;
      headers['X-Goog-FieldMask'] =
        'places.id,places.displayName,places.primaryType,places.types,places.location,places.formattedAddress,nextPageToken';
      headers['Content-Type'] = 'application/json';
    }
    const res = await fetch(url, { method: init?.method ?? 'GET', headers, body: init?.body });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  };
}

/** Deterministic local fixtures — the only transport the overnight loop may use. */
function mockTransport(): Transport {
  const fixtureDir = 'scripts/census/fixtures';
  return async (url) => {
    const name = url.includes('places.googleapis.com')
      ? 'google.json'
      : url.includes('overpass')
        ? 'osm.json'
        : url.includes('data.ny.gov')
          ? 'sla.json'
          : null;
    if (!name) throw new Error(`no fixture for url: ${url}`);
    return { status: 200, body: JSON.parse(fs.readFileSync(join(fixtureDir, name), 'utf8')) };
  };
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
