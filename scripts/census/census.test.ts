import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  configHashOf,
  saveCheckpoint,
  loadCheckpoint,
  validateCheckpoint,
  type Checkpoint,
} from './checkpoint';
import { normalizeName, RunDeduper, splitAgainstCatalog } from './dedupe';
import { googleAdapter, GOOGLE_PRIMARY_BAR_TYPES } from './providers/google';
import { osmAdapter } from './providers/osm';
import { slaAdapter } from './providers/sla';
import { urlSeedAdapter } from './providers/urlSeed';
import { userSubmissionAdapter } from './providers/userSubmission';
import { runCensus } from './runner';
import {
  applyCurated,
  checkApplyPreconditions,
  type ApplySidecar,
  type BarsWriteClient,
  type CuratedCandidate,
} from './apply';
import { sha256Of } from './checkpoint';
import type { CensusContext, NormalizedCandidate, Transport } from './types';

/**
 * Census rewrite (goal g-4531bbf0). Everything here runs against injected
 * fixture transports — no network, no database, no API keys. The provider
 * contract (normalized candidates, cursors, evidence, retry metadata,
 * saturation) and the checkpoint contract (version, run ID, provider,
 * coverage unit, cursor, call count, config hash, code SHA, data version,
 * last successful unit) are operator-locked; these tests pin them.
 */

let scratch: string;
beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'census-test-'));
});
afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

function ctxWith(transport: Transport, files: Record<string, string> = {}): CensusContext {
  return {
    transport,
    readTextFile: (p: string) => {
      if (p in files) return files[p];
      throw new Error(`no fixture file: ${p}`);
    },
    budgetLeft: 100,
  };
}

const NEVER_TRANSPORT: Transport = async () => {
  throw new Error('transport must not be called');
};

// ---------------------------------------------------------------- checkpoint

describe('checkpoint contract', () => {
  const base: Checkpoint = {
    version: 1,
    runId: 'run-1',
    provider: 'google',
    coverageUnit: 'brooklyn/Williamsburg',
    cursor: 'page-2',
    callCount: 7,
    configHash: 'abc',
    codeSha: 'sha-1',
    dataVersion: 'catalog-v1',
    lastSuccessfulUnit: 'brooklyn/Greenpoint',
  };

  it('configHashOf is stable across key order and whitespace', () => {
    const a = configHashOf({ boroughs: ['brooklyn'], budget: 10, sources: ['osm', 'google'] });
    const b = configHashOf({ sources: ['osm', 'google'], budget: 10, boroughs: ['brooklyn'] });
    expect(a).toBe(b);
    const c = configHashOf({ boroughs: ['manhattan'], budget: 10, sources: ['osm', 'google'] });
    expect(c).not.toBe(a);
  });

  it('round-trips through save/load atomically', () => {
    const file = join(scratch, 'cp.json');
    saveCheckpoint(file, base);
    expect(loadCheckpoint(file)).toEqual(base);
    // No stray temp file left behind by the atomic write.
    expect(readdirSync(scratch)).toEqual(['cp.json']);
  });

  it('REFUSES a stale config hash', () => {
    const v = validateCheckpoint(base, { configHash: 'different', codeSha: 'sha-1' });
    expect(v).toEqual({ ok: false, reason: 'config_hash' });
  });

  it('REFUSES a stale code SHA', () => {
    const v = validateCheckpoint(base, { configHash: 'abc', codeSha: 'other-sha' });
    expect(v).toEqual({ ok: false, reason: 'code_sha' });
  });

  it('REFUSES an unknown version', () => {
    const v = validateCheckpoint(
      { ...base, version: 2 as unknown as 1 },
      { configHash: 'abc', codeSha: 'sha-1' },
    );
    expect(v).toEqual({ ok: false, reason: 'version' });
  });

  it('accepts a compatible checkpoint', () => {
    expect(validateCheckpoint(base, { configHash: 'abc', codeSha: 'sha-1' })).toEqual({ ok: true });
  });
});

// ------------------------------------------------------------------- dedupe

describe('dedupe', () => {
  it('normalizeName collapses case, punctuation, and whitespace', () => {
    expect(normalizeName("  The  Dead   Rabbit's ")).toBe(normalizeName('the dead rabbits'));
  });

  it('RunDeduper drops repeats by externalId across overlapping units', () => {
    const d = new RunDeduper();
    const cand = {
      externalId: 'g:place-1',
      name: 'Bar A',
      neighborhood: 'Williamsburg',
      lat: 40.71,
      lng: -73.95,
      signals: [],
      evidenceIds: [],
      verification: 'unverified' as const,
      provider: 'google',
    };
    expect(d.add(cand)).toBe(true);
    expect(d.add({ ...cand })).toBe(false); // same venue from an overlapping tile
    // Same name+hood from a DIFFERENT provider is also a within-run duplicate.
    expect(d.add({ ...cand, externalId: 'osm:node-9', provider: 'osm' })).toBe(false);
  });

  it('splitAgainstCatalog separates fresh candidates from existing ones', () => {
    const fresh = {
      externalId: 'g:new',
      name: 'Brand New Bar',
      neighborhood: 'Greenpoint',
      lat: 40.73,
      lng: -73.95,
      signals: [],
      evidenceIds: [],
      verification: 'unverified' as const,
      provider: 'google',
    };
    const dupe = { ...fresh, externalId: 'g:dupe', name: 'The Dead Rabbit', neighborhood: 'FiDi' };
    const { fresh: f, existing } = splitAgainstCatalog(
      [fresh, dupe],
      [{ name: 'the dead rabbit', neighborhood: 'FiDi' }],
    );
    expect(f.map((c) => c.externalId)).toEqual(['g:new']);
    expect(existing.map((c) => c.externalId)).toEqual(['g:dupe']);
  });
});

// ---------------------------------------------------------------- providers

describe('google adapter', () => {
  const page1 = {
    places: [
      {
        id: 'place-bar',
        displayName: { text: 'Skinny Dennis' },
        primaryType: 'bar',
        types: ['bar', 'establishment'],
        location: { latitude: 40.7143, longitude: -73.9572 },
        formattedAddress: '152 Metropolitan Ave, Brooklyn',
      },
      {
        id: 'place-restaurant',
        displayName: { text: 'Pasta Place' },
        primaryType: 'italian_restaurant',
        types: ['restaurant', 'bar'],
        location: { latitude: 40.7144, longitude: -73.9573 },
        formattedAddress: '1 Noodle Way',
      },
    ],
    nextPageToken: 'tok-2',
  };

  it('normalizes, filters by PRIMARY type, advances the cursor, counts the call', async () => {
    const transport: Transport = async () => ({ status: 200, body: page1 });
    const res = await googleAdapter().fetchUnit('brooklyn/Williamsburg', null, ctxWith(transport));
    expect(res.candidates).toHaveLength(1); // restaurant filtered out
    const c = res.candidates[0];
    expect(c.externalId).toBe('google:place-bar');
    expect(c.name).toBe('Skinny Dennis');
    expect(c.neighborhood).toBe('Williamsburg');
    expect(c.verification).toBe('unverified');
    expect(c.evidenceIds).toHaveLength(1);
    expect(res.evidence[0].url).toContain('place-bar');
    expect(res.evidence[0].retrievedAt).toBeTruthy();
    expect(res.nextCursor).toBe('tok-2');
    expect(res.saturated).toBe(false);
    expect(res.callsUsed).toBe(1);
    expect(GOOGLE_PRIMARY_BAR_TYPES.has('italian_restaurant')).toBe(false);
  });

  it('saturates when no nextPageToken is returned', async () => {
    const transport: Transport = async () => ({ status: 200, body: { places: [] } });
    const res = await googleAdapter().fetchUnit('brooklyn/Williamsburg', 'tok-2', ctxWith(transport));
    expect(res.nextCursor).toBeNull();
    expect(res.saturated).toBe(true);
  });

  it('reports retry metadata on 429 without advancing the cursor', async () => {
    const transport: Transport = async () => ({ status: 429, body: {} });
    const res = await googleAdapter().fetchUnit('brooklyn/Williamsburg', 'tok-2', ctxWith(transport));
    expect(res.candidates).toHaveLength(0);
    expect(res.nextCursor).toBe('tok-2'); // unchanged — retry later at same position
    expect(res.saturated).toBe(false);
    expect(res.retry.attempts).toBe(1);
    expect(res.retry.lastError).toContain('429');
    expect(res.callsUsed).toBe(1); // the call was spent even though it failed
  });
});

describe('osm adapter', () => {
  it('parses Overpass elements; one call per tile unit; always saturates', async () => {
    const body = {
      elements: [
        { type: 'node', id: 42, lat: 40.72, lon: -73.95, tags: { name: 'Pencil Factory', amenity: 'bar' } },
        { type: 'node', id: 43, lat: 40.72, lon: -73.95, tags: { amenity: 'bar' } }, // nameless → dropped
      ],
    };
    const transport: Transport = async () => ({ status: 200, body });
    const res = await osmAdapter().fetchUnit('brooklyn/Greenpoint', null, ctxWith(transport));
    expect(res.candidates).toHaveLength(1);
    expect(res.candidates[0].externalId).toBe('osm:node/42');
    expect(res.evidence[0].url).toBe('https://www.openstreetmap.org/node/42');
    expect(res.nextCursor).toBeNull();
    expect(res.saturated).toBe(true);
    expect(res.callsUsed).toBe(1);
  });
});

describe('sla adapter', () => {
  it('pages by offset and saturates on a short page', async () => {
    const fullPage = Array.from({ length: 100 }, (_, i) => ({
      license_serial_number: `L${i}`,
      premises_name: `BAR ${i}`,
      latitude: '40.7',
      longitude: '-73.9',
      actual_address_of_premises_address1: `${i} Ave`,
    }));
    let seenUrl = '';
    const transport: Transport = async (url) => {
      seenUrl = url;
      return { status: 200, body: url.includes('$offset=100') ? fullPage.slice(0, 3) : fullPage };
    };
    const a = slaAdapter();
    const first = await a.fetchUnit('brooklyn', null, ctxWith(transport));
    expect(first.candidates).toHaveLength(100);
    expect(first.nextCursor).toBe('100');
    expect(first.saturated).toBe(false);
    expect(seenUrl).toContain('$offset=0');

    const second = await a.fetchUnit('brooklyn', '100', ctxWith(transport));
    expect(second.candidates).toHaveLength(3);
    expect(second.nextCursor).toBeNull();
    expect(second.saturated).toBe(true);
  });
});

describe('file-based adapters (no network budget)', () => {
  it('urlSeed: rows without a source URL yield NO evidence and stay unverified', async () => {
    const seed = JSON.stringify([
      { name: 'Verified Spot', neighborhood: 'Williamsburg', borough: 'brooklyn', lat: 40.71, lng: -73.95, sourceUrl: 'https://example.com/list', reviewedAt: '2026-07-30' },
      { name: 'Rumor Bar', neighborhood: 'Williamsburg', borough: 'brooklyn', lat: 40.712, lng: -73.951 },
      { name: 'Wrong Borough', neighborhood: 'Astoria', borough: 'queens', lat: 40.76, lng: -73.92, sourceUrl: 'https://example.com/x' },
    ]);
    const a = urlSeedAdapter('seed.json');
    const res = await a.fetchUnit('brooklyn', null, ctxWith(NEVER_TRANSPORT, { 'seed.json': seed }));
    expect(res.callsUsed).toBe(0); // file source: never spends network budget
    expect(res.candidates).toHaveLength(2); // queens row filtered by borough unit
    const withEvidence = res.candidates.find((c) => c.name === 'Verified Spot')!;
    const without = res.candidates.find((c) => c.name === 'Rumor Bar')!;
    expect(withEvidence.evidenceIds).toHaveLength(1);
    expect(without.evidenceIds).toHaveLength(0);
    expect(without.verification).toBe('unverified'); // missing evidence stays unverified
    expect(res.saturated).toBe(true);
  });

  it('userSubmission: normalizes suggestion rows with zero network cost', async () => {
    const subs = JSON.stringify([
      { id: 'sub-1', name: 'Neighborhood Secret', neighborhood: 'Bushwick', borough: 'brooklyn', lat: 40.69, lng: -73.92 },
    ]);
    const a = userSubmissionAdapter('subs.json');
    const res = await a.fetchUnit('brooklyn', null, ctxWith(NEVER_TRANSPORT, { 'subs.json': subs }));
    expect(res.callsUsed).toBe(0);
    expect(res.candidates[0].externalId).toBe('user:sub-1');
    expect(res.candidates[0].verification).toBe('unverified');
  });
});

// ------------------------------------------------------------------- runner

describe('runCensus (end-to-end, mocked)', () => {
  function fixtureTransport(): Transport {
    return async (url: string) => {
      if (url.includes('places.googleapis.com')) {
        return {
          status: 200,
          body: {
            places: [
              {
                id: `p-${url.length}`,
                displayName: { text: `Fixture Bar ${url.length}` },
                primaryType: 'bar',
                types: ['bar'],
                location: { latitude: 40.71, longitude: -73.95 },
                formattedAddress: '1 Fixture St',
              },
            ],
          },
        };
      }
      if (url.includes('overpass')) {
        return {
          status: 200,
          body: {
            elements: [
              { type: 'node', id: 7, lat: 40.72, lon: -73.95, tags: { name: 'Overlap Tavern', amenity: 'bar' } },
            ],
          },
        };
      }
      throw new Error(`unexpected url: ${url}`);
    };
  }

  const baseOpts = () => ({
    boroughs: ['brooklyn'],
    sources: ['google', 'osm'] as string[],
    budget: 100,
    outDir: scratch,
    codeSha: 'test-sha',
    dataVersion: 'catalog-test',
    now: () => new Date('2026-08-02T03:00:00Z'),
    transport: fixtureTransport(),
    readTextFile: () => {
      throw new Error('not used');
    },
    catalog: [] as Array<{ name: string; neighborhood: string }>,
  });

  it('dry-run writes per-unit files, a report, checkpoints — and never touches the catalog', async () => {
    const result = await runCensus(baseOpts());
    expect(result.stopped).toBe('complete');
    const runDir = join(scratch, result.runId);
    expect(existsSync(join(runDir, 'report.json'))).toBe(true);
    expect(existsSync(join(runDir, 'report.md'))).toBe(true);
    expect(existsSync(join(runDir, 'checkpoint.google.json'))).toBe(true);
    expect(existsSync(join(runDir, 'checkpoint.osm.json'))).toBe(true);
    const report = JSON.parse(readFileSync(join(runDir, 'report.json'), 'utf8'));
    expect(report.candidates.length).toBeGreaterThan(0);
    // Every candidate in a mocked run is unverified; missing evidence never upgrades.
    for (const c of report.candidates) expect(c.verification).toBe('unverified');
    // Sidecar binds the payload for a future ATTENDED --apply.
    const sidecar = JSON.parse(readFileSync(join(runDir, 'apply-sidecar.json'), 'utf8'));
    expect(sidecar.payloadSha256).toBeTruthy();
    expect(sidecar.configHash).toBe(result.configHash);
    expect(sidecar.codeSha).toBe('test-sha');
  });

  it('stops when the network budget is exhausted and records it', async () => {
    const result = await runCensus({ ...baseOpts(), budget: 2 });
    expect(result.stopped).toBe('budget_exhausted');
    const cps = result.checkpoints;
    const used = Object.values(cps).reduce((n, cp) => n + cp.callCount, 0);
    expect(used).toBeLessThanOrEqual(2);
  });

  it('resume validates hashes: continues on match, REFUSES stale config', async () => {
    const first = await runCensus({ ...baseOpts(), budget: 2 });
    expect(first.stopped).toBe('budget_exhausted');

    // Compatible resume: same config, same code SHA → picks up and finishes.
    const resumed = await runCensus({ ...baseOpts(), budget: 100, resumeRunId: first.runId });
    expect(resumed.stopped).toBe('complete');
    expect(resumed.runId).toBe(first.runId);

    // Stale config (different boroughs) → typed refusal, nothing executed.
    await expect(
      runCensus({ ...baseOpts(), boroughs: ['manhattan'], resumeRunId: first.runId }),
    ).rejects.toThrow(/config_hash/);

    // Stale code SHA → typed refusal.
    await expect(
      runCensus({ ...baseOpts(), budget: 100, resumeRunId: first.runId, codeSha: 'other-sha' }),
    ).rejects.toThrow(/code_sha/);
  });

  it('budget on resume comes from the checkpoints, not a fresh counter', async () => {
    const first = await runCensus({ ...baseOpts(), budget: 2 });
    const resumed = await runCensus({ ...baseOpts(), budget: 3, resumeRunId: first.runId });
    // 2 calls were already spent; a budget of 3 leaves exactly 1 more call.
    const used = Object.values(resumed.checkpoints).reduce((n, cp) => n + cp.callCount, 0);
    expect(used).toBeLessThanOrEqual(3);
  });

  it('each checkpoint carries only ITS provider calls — the sum equals real spend', async () => {
    // Codex round-2: the global counter was being copied into every
    // provider checkpoint, so a resume reconstructed 2x the real spend.
    const result = await runCensus(baseOpts()); // budget 100: full clean run
    const google = result.checkpoints.google.callCount;
    const osm = result.checkpoints.osm.callCount;
    expect(google).toBe(4); // 4 brooklyn tiles, one page each
    expect(osm).toBe(4);
    // The report's budgetUsed is the true global total, not a doubled sum.
    const report = JSON.parse(
      readFileSync(join(scratch, result.runId, 'report.json'), 'utf8'),
    );
    expect(report.budgetUsed).toBe(8);
  });

  it('REFUSES to resume with a different source set (no fail-open on missing checkpoints)', async () => {
    const first = await runCensus({ ...baseOpts(), sources: ['google'] });
    expect(first.stopped).toBe('complete');
    // Same run resumed with a DIFFERENT source list: the google checkpoint
    // on disk no longer matches the new configHash → typed refusal, not a
    // silent rebinding of old unit files to the new config.
    await expect(
      runCensus({ ...baseOpts(), sources: ['osm'], resumeRunId: first.runId }),
    ).rejects.toThrow(/config_hash/);
  });

  it('REFUSES to resume with reordered boroughs (positional resume is order-sensitive)', async () => {
    const twoBoroughs = { ...baseOpts(), boroughs: ['brooklyn', 'manhattan'], budget: 2 };
    const first = await runCensus(twoBoroughs);
    expect(first.stopped).toBe('budget_exhausted');
    await expect(
      runCensus({
        ...twoBoroughs,
        boroughs: ['manhattan', 'brooklyn'],
        budget: 100,
        resumeRunId: first.runId,
      }),
    ).rejects.toThrow(/config_hash/);
  });

  it('a stale partial next to a completed unit file is swept, not resumed into', async () => {
    // Codex round-2 crash window: final checkpoint saved, partial delete
    // didn't happen. The sweep must remove it; the completed unit keeps its
    // full content and the run does not report incomplete coverage.
    const first = await runCensus(baseOpts());
    const unitsDir = join(scratch, first.runId, 'units');
    const completed = readdirSync(unitsDir).find((f) => f.startsWith('google__'))!;
    const stalePartial = join(unitsDir, completed.replace(/\.json$/, '.partial.json'));
    writeFileSync(
      stalePartial,
      JSON.stringify({ unit: 'x', provider: 'google', cursor: 'tok', candidates: [], evidence: [] }),
    );
    const resumed = await runCensus({ ...baseOpts(), resumeRunId: first.runId });
    expect(resumed.stopped).toBe('complete');
    expect(existsSync(stalePartial)).toBe(false);
  });

  it('cross-provider duplicates collapse in the report (same name+neighborhood)', async () => {
    const dupTransport: Transport = async (url: string) => {
      if (url.includes('places.googleapis.com')) {
        return {
          status: 200,
          body: {
            places: [
              {
                id: 'dup-1',
                displayName: { text: 'Overlap Tavern' },
                primaryType: 'bar',
                types: ['bar'],
                location: { latitude: 40.72, longitude: -73.95 },
                formattedAddress: '2 Same St',
              },
            ],
          },
        };
      }
      return {
        status: 200,
        body: {
          elements: [
            { type: 'node', id: 7, lat: 40.72, lon: -73.95, tags: { name: 'Overlap Tavern', amenity: 'bar' } },
          ],
        },
      };
    };
    // OSM tiles map to the same neighborhoods google uses, so the venue
    // "Overlap Tavern" arrives once per provider — the report must hold ONE.
    const result = await runCensus({ ...baseOpts(), transport: dupTransport });
    const report = JSON.parse(
      readFileSync(join(scratch, result.runId, 'report.json'), 'utf8'),
    );
    const names = report.candidates.map((c: { name: string }) => c.name);
    expect(names.filter((n: string) => n === 'Overlap Tavern')).toHaveLength(1);
  });
});

describe('runCensus interruption recovery (santa round-1 CRITICALs)', () => {
  /** Google returns page 1 with a token, page 2 final — a two-page unit. */
  function pagedGoogleTransport(): Transport {
    return async (url, init) => {
      if (!url.includes('places.googleapis.com')) throw new Error(`unexpected: ${url}`);
      const isPage2 = init?.body?.includes('"pageToken":"tok-p2"');
      return {
        status: 200,
        body: {
          places: [
            {
              id: isPage2 ? 'page2-bar' : 'page1-bar',
              displayName: { text: isPage2 ? 'Page Two Bar' : 'Page One Bar' },
              primaryType: 'bar',
              types: ['bar'],
              location: { latitude: 40.71, longitude: -73.95 },
              formattedAddress: 'x',
            },
          ],
          ...(isPage2 ? {} : { nextPageToken: 'tok-p2' }),
        },
      };
    };
  }

  const pagedOpts = () => ({
    boroughs: ['brooklyn'],
    sources: ['google'],
    budget: 1, // stops INSIDE the first unit, between page 1 and page 2
    outDir: scratch,
    codeSha: 'test-sha',
    dataVersion: 'catalog-test',
    now: () => new Date('2026-08-02T04:00:00Z'),
    transport: pagedGoogleTransport(),
    readTextFile: () => {
      throw new Error('not used');
    },
    catalog: [] as Array<{ name: string; neighborhood: string }>,
  });

  it('pages fetched before a mid-unit budget pause SURVIVE into the resumed unit file', async () => {
    const first = await runCensus(pagedOpts());
    expect(first.stopped).toBe('budget_exhausted');

    const resumed = await runCensus({ ...pagedOpts(), budget: 100, resumeRunId: first.runId });
    expect(resumed.stopped).toBe('complete');
    const report = JSON.parse(
      readFileSync(join(scratch, first.runId, 'report.json'), 'utf8'),
    );
    const names = report.candidates.map((c: { name: string }) => c.name).sort();
    // Page 1 was fetched (and paid for) before the pause; page 2 after
    // resume. BOTH must be present — losing page 1 was the round-1 CRITICAL.
    expect(names).toEqual(['Page One Bar', 'Page Two Bar']);
    // The partial scratch file is superseded once the unit completes.
    const unitFiles = readdirSync(join(scratch, first.runId, 'units'));
    expect(unitFiles.some((f) => f.endsWith('.partial.json'))).toBe(false);
  });

  it('a partial ORPHANED ahead of its checkpoint is still loaded on resume (GLM round-3)', async () => {
    // Crash window: partial written for unit N, checkpoint save never
    // happened (still points before this unit with cursor null). Resume
    // enters N and must load the persisted page, not re-fetch page 1.
    const first = await runCensus(pagedOpts()); // budget 1: pauses mid-unit
    expect(first.stopped).toBe('budget_exhausted');
    const unitsDir = join(scratch, first.runId, 'units');
    const partial = readdirSync(unitsDir).find((f) => f.endsWith('.partial.json'))!;
    // Simulate the crash: rewind the checkpoint to "no unit in flight".
    const cpFile = join(scratch, first.runId, 'checkpoint.google.json');
    const cp = JSON.parse(readFileSync(cpFile, 'utf8'));
    writeFileSync(
      cpFile,
      JSON.stringify({ ...cp, coverageUnit: '', cursor: null }, null, 2),
    );
    const resumed = await runCensus({ ...pagedOpts(), budget: 100, resumeRunId: first.runId });
    expect(resumed.stopped).toBe('complete');
    const report = JSON.parse(
      readFileSync(join(scratch, first.runId, 'report.json'), 'utf8'),
    );
    const names = report.candidates.map((c: { name: string }) => c.name).sort();
    // Page One survives ONLY via the orphaned partial — losing it was the bug.
    expect(names).toEqual(['Page One Bar', 'Page Two Bar']);
    expect(readdirSync(unitsDir).some((f) => f === partial)).toBe(false);
  });

  it('a FAILED unit halts that adapter and is retried on resume — never skipped', async () => {
    let failFirstUnit = true;
    const flakyTransport: Transport = async (url) => {
      if (!url.includes('places.googleapis.com')) throw new Error(`unexpected: ${url}`);
      if (failFirstUnit) {
        failFirstUnit = false; // only the very first request 429s
        return { status: 429, body: {} };
      }
      return {
        status: 200,
        body: {
          places: [
            {
              id: `ok-${url.length}-${Math.trunc(Math.random() * 1e9)}`,
              displayName: { text: `Recovered Bar` },
              primaryType: 'bar',
              types: ['bar'],
              location: { latitude: 40.71, longitude: -73.95 },
              formattedAddress: 'x',
            },
          ],
        },
      };
    };
    const opts = { ...pagedOpts(), budget: 100, transport: flakyTransport };
    const first = await runCensus(opts);
    // The failed FIRST unit stopped the adapter; later units did not run and
    // did not overwrite the checkpoint's memory of the failure.
    expect(first.stopped).toBe('incomplete_units');
    expect(first.incompleteUnits.length).toBeGreaterThan(0);
    expect(first.checkpoints.google.lastSuccessfulUnit).toBeNull();

    // Resume retries the SAME unit first (transport now healthy) and the
    // run completes every unit.
    const resumed = await runCensus({ ...opts, resumeRunId: first.runId });
    expect(resumed.stopped).toBe('complete');
    expect(resumed.incompleteUnits).toEqual([]);
    const unitFiles = readdirSync(join(scratch, first.runId, 'units'));
    expect(unitFiles.filter((f) => f.endsWith('.partial.json'))).toEqual([]);
    // All four brooklyn tiles have a completed unit file.
    expect(unitFiles.filter((f) => f.startsWith('google__'))).toHaveLength(4);
  });
});

// -------------------------------------------------------------------- apply

describe('apply preconditions (the sole write path refuses first)', () => {
  const reportCandidates: NormalizedCandidate[] = [
    {
      externalId: 'google:p1',
      name: 'Mock Alehouse',
      neighborhood: 'Williamsburg',
      lat: 40.71,
      lng: -73.95,
      signals: [],
      evidenceIds: ['google:p1'],
      verification: 'unverified',
      provider: 'google',
    },
  ];
  const sidecar: ApplySidecar = {
    runId: 'run-x',
    payloadSha256: sha256Of(JSON.stringify(reportCandidates)),
    configHash: 'cfg',
    codeSha: 'sha',
    generatedAt: '2026-08-01T00:00:00.000Z',
  };
  const curated: CuratedCandidate[] = [
    {
      id: 'mock-alehouse',
      externalId: 'google:p1',
      name: 'Mock Alehouse',
      neighborhood: 'Williamsburg',
      address: '100 Mock St',
      lat: 40.71,
      lng: -73.95,
      priceTier: 2,
      tags: ['dive'],
      blurb: 'A mock.',
      lastVerified: '2026-08-01',
    },
  ];
  const base = {
    unattended: false,
    sidecar,
    reportCandidates,
    curated,
    maxAgeDays: 7,
    now: new Date('2026-08-02T00:00:00.000Z'),
    currentCodeSha: 'sha',
  };

  it('REFUSES when generation code drifted from current HEAD (unless overridden)', () => {
    expect(
      checkApplyPreconditions({ ...base, currentCodeSha: 'newer-sha' }),
    ).toEqual({ ok: false, reason: 'code_drift' });
    expect(
      checkApplyPreconditions({ ...base, currentCodeSha: 'newer-sha', allowCodeDrift: true }),
    ).toEqual({ ok: true });
  });

  it('REFUSES under LOOP_UNATTENDED (unattended flag)', () => {
    expect(checkApplyPreconditions({ ...base, unattended: true })).toEqual({
      ok: false,
      reason: 'unattended',
    });
  });

  it('REFUSES a tampered report payload (sidecar hash mismatch)', () => {
    const tampered = [...reportCandidates, { ...reportCandidates[0], externalId: 'google:evil' }];
    expect(
      checkApplyPreconditions({ ...base, reportCandidates: tampered }),
    ).toEqual({ ok: false, reason: 'payload_hash' });
  });

  it('REFUSES a stale report beyond max age', () => {
    expect(
      checkApplyPreconditions({ ...base, now: new Date('2026-08-20T00:00:00.000Z') }),
    ).toEqual({ ok: false, reason: 'stale_report' });
  });

  it('REFUSES (fail-closed) on malformed staleness inputs — NaN never passes', () => {
    expect(
      checkApplyPreconditions({
        ...base,
        sidecar: { ...sidecar, generatedAt: 'not-a-date' },
      }),
    ).toEqual({ ok: false, reason: 'stale_report' });
    expect(
      checkApplyPreconditions({ ...base, maxAgeDays: Number.NaN }),
    ).toEqual({ ok: false, reason: 'stale_report' });
  });

  it('REFUSES curated rows with provenance outside the reviewed report', () => {
    const fabricated = [{ ...curated[0], externalId: 'google:not-in-report' }];
    const v = checkApplyPreconditions({ ...base, curated: fabricated });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toContain('unknown_provenance');
  });

  it('accepts the attended, bound, fresh, provenance-clean case', () => {
    expect(checkApplyPreconditions(base)).toEqual({ ok: true });
  });

  it('applyCurated dedupes against existing rows and names row-level failures', async () => {
    const inserts: Array<Array<Record<string, unknown>>> = [];
    const client: BarsWriteClient = {
      selectExisting: async () => ({
        data: [{ id: 'existing-bar', name: 'Mock Alehouse', neighborhood: 'Williamsburg' }],
        error: null,
      }),
      insert: async (rows) => {
        inserts.push(rows);
        return { error: null };
      },
    };
    const twoRows: CuratedCandidate[] = [
      curated[0], // name+neighborhood duplicate of existing-bar → rejected
      { ...curated[0], id: 'fresh-bar', name: 'Fresh Fixture', externalId: 'google:p1' },
    ];
    const result = await applyCurated(client, twoRows, () => true);
    expect(result.inserted).toBe(1);
    expect(result.rejected).toEqual([
      { id: 'mock-alehouse', reason: 'name+neighborhood duplicate' },
    ]);
    expect(inserts.flat().map((r) => r.id)).toEqual(['fresh-bar']);
    expect(inserts.flat()[0].source).toBe('census');
  });
});
