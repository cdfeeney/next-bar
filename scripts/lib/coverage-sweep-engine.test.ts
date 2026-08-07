import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// @ts-ignore -- the operator scripts intentionally remain native ESM.
import { SweepInterrupted, runSweep } from './coverage-sweep-engine.mjs';
// @ts-ignore
import { completeness, configHash, loadManifest, openManifest } from './coverage-manifest.mjs';
// @ts-ignore
import { planCells } from './coverage-subdivide.mjs';

// runSweep's option types are inferred from its JS defaults (a frozen literal,
// `never[]`, `() => void`), which are narrower than its real contract.
const sweep = runSweep as (options: any) => Promise<any>;

const LAT = 111_320;
const LNG = LAT * Math.cos((40.72 * Math.PI) / 180);
const BBOX = { south: 40.72, north: 40.72 + 720 / LAT, west: -73.99, east: -73.99 + 720 / LNG };
const SUBDIVISION = { maxDepth: 2, minCellMeters: 90, branching: 4 };
const CAP = 20;

const cells = (): any[] =>
  planCells(BBOX, 360, { prefix: 'n:0' }).map((cell: any) => ({ ...cell, kind: 'nearby' }));

/** Deterministic venue field; `spread` controls how dense the first cell is. */
function venues(count: number, spread: number) {
  let seed = 7;
  const next = () => ((seed = (seed * 1_664_525 + 1_013_904_223) % 4_294_967_296) / 4_294_967_296);
  return Array.from({ length: count }, (_, index) => ({
    id: `v-${index}`,
    location: {
      latitude: BBOX.south + (next() * spread) / LAT,
      longitude: BBOX.west + (next() * spread) / LNG,
    },
  }));
}

const inside = (loc: any, box: any) =>
  loc.latitude >= box.south &&
  loc.latitude <= box.north &&
  loc.longitude >= box.west &&
  loc.longitude <= box.east;

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-test-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function manifestFor(name: string, plan: any[]) {
  const file = path.join(dir, name);
  const writer = openManifest(file);
  writer.plan({ configHash: configHash({ t: name }), cells: plan });
  return { writer, file };
}

function transportFor(field: any[], options: { interruptAfter?: number; cap?: number; only?: Record<string, number> } = {}) {
  const log: string[] = [];
  const transport = async (cell: any) => {
    if (options.interruptAfter !== undefined && log.length >= options.interruptAfter) {
      throw new SweepInterrupted();
    }
    log.push(cell.id);
    const hit = field.filter((venue) => inside(venue.location, cell.bbox));
    const limit = options.only?.[cell.id] ?? options.cap ?? CAP;
    return { places: hit.slice(0, limit) };
  };
  return { transport, log };
}

describe('saturation and bounded subdivision', () => {
  it('subdivides a censored cell and recovers venues the cap had hidden', async () => {
    const field = venues(60, 340);
    const plan = cells();
    const { writer, file } = manifestFor('sat.jsonl', plan);
    const found = new Set<string>();
    await sweep({
      cells: plan,
      manifest: writer,
      subdivision: SUBDIVISION,
      maxResultCount: CAP,
      transport: transportFor(field).transport,
      onPlaces: (places: any[]) => places.forEach((place) => found.add(place.id)),
    });
    writer.close();
    const report = completeness(loadManifest(file));
    expect(report.complete).toBe(true);
    expect(report.summary.subdivided).toBeGreaterThan(0);
    expect(found.size).toBe(60);
  });

  it('records saturated_at_floor rather than claiming completeness', async () => {
    const plan = cells();
    const { writer, file } = manifestFor('floor.jsonl', plan);
    await sweep({
      cells: plan,
      manifest: writer,
      subdivision: SUBDIVISION,
      maxResultCount: CAP,
      transport: transportFor(venues(60, 60)).transport,
    });
    writer.close();
    const report = completeness(loadManifest(file));
    expect(report.complete).toBe(false);
    expect(report.status).toBe('incomplete_saturated');
  });
});

describe('resume', () => {
  it('converges: a subdivision interrupted mid-flight finishes on resume', async () => {
    // Regression: the engine used to re-query the unfinished parent. When the
    // re-query came back under the cap it marked the parent 'unsaturated',
    // stranding the children — runSweep only iterates depth-0 cells, so nothing
    // ever revisited them and the run could NEVER reach complete.
    const field = venues(60, 340);
    const plan = cells();
    const { writer, file } = manifestFor('resume.jsonl', plan);
    await sweep({
      cells: plan,
      manifest: writer,
      subdivision: SUBDIVISION,
      maxResultCount: CAP,
      transport: transportFor(field, { interruptAfter: 3 }).transport,
    });
    writer.close();

    const priorState = loadManifest(file);
    expect(completeness(priorState).complete).toBe(false);

    const resumeWriter = openManifest(file);
    // The re-query returns FEWER results than the original capped call — the
    // exact condition that used to strand the children.
    const { transport, log } = transportFor(field, { only: { 'n:0:0:0': 14 } });
    await sweep({
      cells: plan,
      manifest: resumeWriter,
      state: priorState,
      subdivision: SUBDIVISION,
      maxResultCount: CAP,
      transport,
    });
    resumeWriter.close();

    expect(log).not.toContain('n:0:0:0');
    const report = completeness(loadManifest(file));
    expect(report.complete).toBe(true);
    expect(report.missing).toEqual([]);
  });

  it('replays the places of already-finished cells so the queue is not short', async () => {
    // Regression: resume skipped the CALL and the RESULTS, so a resumed run
    // rebuilt a short candidate list while the manifest reported COMPLETE.
    const field = venues(60, 340);
    const plan = cells();
    const { writer, file } = manifestFor('replay.jsonl', plan);
    const firstPass = new Set<string>();
    await sweep({
      cells: plan,
      manifest: writer,
      subdivision: SUBDIVISION,
      maxResultCount: CAP,
      transport: transportFor(field, { interruptAfter: 4 }).transport,
      onPlaces: (places: any[]) => places.forEach((place) => firstPass.add(place.id)),
    });
    writer.close();

    const resumeWriter = openManifest(file);
    const resumed = new Set<string>();
    await sweep({
      cells: plan,
      manifest: resumeWriter,
      state: loadManifest(file),
      subdivision: SUBDIVISION,
      maxResultCount: CAP,
      transport: transportFor(field).transport,
      onPlaces: (places: any[]) => places.forEach((place) => resumed.add(place.id)),
    });
    resumeWriter.close();

    const report = completeness(loadManifest(file));
    expect(report.complete).toBe(true);
    expect(firstPass.size).toBeGreaterThan(0);
    // A complete run must hand the caller every venue the manifest recorded.
    expect(resumed.size).toBe(report.summary.uniquePlaceIds);
  });

  it('subdivides a known-capped cell from its record instead of re-querying it', async () => {
    // Regression: a crash between the RESULT flush and the SUBDIVIDE flush left
    // a cell recorded as capped with no children. Resume re-queried it; a
    // smaller second answer flipped capped to false, marked it 'unsaturated',
    // and the run reported COMPLETE having never subdivided a censored cell.
    const plan = cells();
    const target = plan[0];
    const file = path.join(dir, 'torn.jsonl');
    const writer = openManifest(file);
    writer.plan({ configHash: configHash({ t: 'torn' }), cells: plan });
    writer.attempt({ cellId: target.id, attemptN: 1, ok: true, count: CAP, capped: true });
    writer.result(
      target.id,
      Array.from({ length: CAP }, (_, index) => ({ id: `orig-${index}` })),
    );
    writer.close();

    const resumeWriter = openManifest(file);
    const emitted = new Set<string>();
    const queried: string[] = [];
    await sweep({
      cells: plan,
      manifest: resumeWriter,
      state: loadManifest(file),
      subdivision: SUBDIVISION,
      maxResultCount: CAP,
      transport: async (cell: any) => {
        queried.push(cell.id);
        return { places: [] };
      },
      onPlaces: (places: any[]) => places.forEach((place) => emitted.add(place.id)),
    });
    resumeWriter.close();

    expect(queried).not.toContain(target.id);
    const state = loadManifest(file);
    expect(state?.cells.get(target.id).children.length).toBe(4);
    expect(state?.cells.get(target.id).terminalStatus).toBe('cleared');
    expect([...emitted].some((id) => id.startsWith('orig-'))).toBe(true);
  });

  it('replays a cleared parent as its whole subtree, not just its own page', async () => {
    // Regression: resuming an already-COMPLETE manifest emitted only the root's
    // capped page, dropping every venue subdivision had been run to find, while
    // still reporting COMPLETE.
    const field = venues(60, 340);
    const plan = cells();
    const { writer, file } = manifestFor('subtree.jsonl', plan);
    const first = new Set<string>();
    await sweep({
      cells: plan,
      manifest: writer,
      subdivision: SUBDIVISION,
      maxResultCount: CAP,
      transport: transportFor(field).transport,
      onPlaces: (places: any[]) => places.forEach((place) => first.add(place.id)),
    });
    writer.close();
    const report = completeness(loadManifest(file));
    expect(report.complete).toBe(true);

    const resumeWriter = openManifest(file);
    const replayed = new Set<string>();
    await sweep({
      cells: plan,
      manifest: resumeWriter,
      state: loadManifest(file),
      subdivision: SUBDIVISION,
      maxResultCount: CAP,
      transport: async () => {
        throw new Error('resuming a complete manifest must make no calls');
      },
      onPlaces: (places: any[]) => places.forEach((place) => replayed.add(place.id)),
    });
    resumeWriter.close();
    expect(replayed.size).toBe(report.summary.uniquePlaceIds);
    expect(replayed.size).toBe(first.size);
  });

  it('replays a recorded result whose DONE was interrupted, then re-queries', async () => {
    // Regression: an uncapped RESULT flushed before an interrupted DONE was
    // re-queried without replaying what was already recorded. Google returns a
    // different slice each time, so the manifest unioned both pages while the
    // rebuilt queue held only the newer one.
    const plan = [cells()[0]];
    const file = path.join(dir, 'interrupted-done.jsonl');
    const writer = openManifest(file);
    writer.plan({ configHash: configHash({ t: 'idone' }), cells: plan });
    writer.attempt({ cellId: plan[0].id, attemptN: 1, ok: true, count: 1, capped: false });
    writer.result(plan[0].id, [{ id: 'old-result' }]);
    writer.close();

    const resumeWriter = openManifest(file);
    const emitted = new Set<string>();
    await sweep({
      cells: plan,
      manifest: resumeWriter,
      state: loadManifest(file),
      subdivision: SUBDIVISION,
      maxResultCount: CAP,
      transport: async () => ({ places: [{ id: 'new-result' }] }),
      onPlaces: (places: any[]) => places.forEach((place) => emitted.add(place.id)),
    });
    resumeWriter.close();
    const report = completeness(loadManifest(file));
    expect(emitted).toContain('old-result');
    expect(emitted).toContain('new-result');
    expect(emitted.size).toBe(report.summary.uniquePlaceIds);
  });

  it('emits a place found by both a parent and its child exactly as a live run does', async () => {
    // The invariant is resume == live, NOT "emit once". onPlaces callbacks are
    // counted as queryHits, which feeds the score gate, so collapsing repeats
    // on resume makes a resumed run DROP candidates an uninterrupted run keeps.
    // A previous fix deduplicated across the subtree and broke exactly that.
    const shared = { id: 'shared' };
    const plan = [cells()[0]];

    const live: string[] = [];
    const liveRun = manifestFor('live.jsonl', plan);
    await sweep({
      cells: plan,
      manifest: liveRun.writer,
      subdivision: { maxDepth: 1, minCellMeters: 90, branching: 4 },
      maxResultCount: 1, // every response caps, forcing subdivision
      transport: async () => ({ places: [shared] }),
      onPlaces: (places: any[]) => places.forEach((place) => live.push(place.id)),
    });
    liveRun.writer.close();
    // Every response caps here, so the children reach the floor and the run is
    // legitimately incomplete — irrelevant to this test, which is about what
    // the two runs EMIT.
    expect(live.length).toBeGreaterThan(1); // parent AND each child emitted it

    const replayed: string[] = [];
    const resumeWriter = openManifest(liveRun.file);
    await sweep({
      cells: plan,
      manifest: resumeWriter,
      state: loadManifest(liveRun.file),
      subdivision: { maxDepth: 1, minCellMeters: 90, branching: 4 },
      maxResultCount: 1,
      transport: async () => {
        throw new Error('resuming a complete manifest must make no calls');
      },
      onPlaces: (places: any[]) => places.forEach((place) => replayed.push(place.id)),
    });
    resumeWriter.close();
    expect(replayed).toEqual(live);
  });

  it('does not double-count a place the re-query returns again', async () => {
    // The other direction: replaying a recorded page and then emitting an
    // overlapping fresh response would count the same place twice for one cell,
    // which a live single-query run never does.
    const plan = [cells()[0]];
    const file = path.join(dir, 'overlap.jsonl');
    const writer = openManifest(file);
    writer.plan({ configHash: configHash({ t: 'overlap' }), cells: plan });
    writer.attempt({ cellId: plan[0].id, attemptN: 1, ok: true, count: 1, capped: false });
    writer.result(plan[0].id, [{ id: 'p' }]);
    writer.close();

    const emissions: string[] = [];
    const resumeWriter = openManifest(file);
    await sweep({
      cells: plan,
      manifest: resumeWriter,
      state: loadManifest(file),
      subdivision: SUBDIVISION,
      maxResultCount: CAP,
      transport: async () => ({ places: [{ id: 'p' }] }),
      onPlaces: (places: any[]) => places.forEach((place) => emissions.push(place.id)),
    });
    resumeWriter.close();
    expect(emissions).toEqual(['p']);
  });

  it('does not re-query cells that already finished', async () => {
    const field = venues(12, 340);
    const plan = cells();
    const { writer, file } = manifestFor('skip.jsonl', plan);
    await sweep({
      cells: plan,
      manifest: writer,
      subdivision: SUBDIVISION,
      maxResultCount: CAP,
      transport: transportFor(field).transport,
    });
    writer.close();

    const resumeWriter = openManifest(file);
    const { transport, log } = transportFor(field);
    await sweep({
      cells: plan,
      manifest: resumeWriter,
      state: loadManifest(file),
      subdivision: SUBDIVISION,
      maxResultCount: CAP,
      transport,
    });
    resumeWriter.close();
    expect(log).toEqual([]);
  });
});

describe('budget and error paths', () => {
  it('stops at the call budget and records it as a blocking failure', async () => {
    const plan = cells();
    const { writer, file } = manifestFor('budget.jsonl', plan);
    const result = await sweep({
      cells: plan,
      manifest: writer,
      subdivision: SUBDIVISION,
      maxResultCount: CAP,
      maxCalls: 2,
      transport: transportFor(venues(12, 340)).transport,
    });
    writer.close();
    expect(result.callsUsed).toBe(2);
    const report = completeness(loadManifest(file));
    expect(report.complete).toBe(false);
    expect(report.status).toBe('incomplete_failed');
  });

  it('classifies a quota error as blocking and names the cell', async () => {
    const plan = cells();
    const { writer, file } = manifestFor('quota.jsonl', plan);
    await sweep({
      cells: plan,
      manifest: writer,
      subdivision: SUBDIVISION,
      maxResultCount: CAP,
      transport: async (cell: any) => {
        if (cell.id === plan[1].id) {
          const error: any = new Error('failed (429): Quota exceeded per day');
          error.status = 429;
          throw error;
        }
        return { places: [] };
      },
    });
    writer.close();
    const report = completeness(loadManifest(file));
    expect(report.failed).toContain(plan[1].id);
    expect(report.status).toBe('incomplete_failed');
  });

  it('drops a type Google rejects, retries once, and terminates', async () => {
    const plan = [cells()[0]];
    const { writer, file } = manifestFor('types.jsonl', plan);
    let calls = 0;
    const result = await sweep({
      cells: plan,
      manifest: writer,
      subdivision: SUBDIVISION,
      maxResultCount: CAP,
      includedTypes: ['bar', 'dance_hall'],
      transport: async () => {
        calls += 1;
        if (calls === 1) throw new Error('Invalid value at included_types[1] (TYPE_ENUM), "dance_hall"');
        return { places: [] };
      },
    });
    writer.close();
    expect(result.droppedTypes).toEqual(['dance_hall']);
    expect(result.includedTypes).toEqual(['bar']);
    expect(calls).toBe(2);
    expect(completeness(loadManifest(file)).complete).toBe(true);
  });

  it('gives each attempt on a cell a strictly increasing number', async () => {
    const plan = [cells()[0]];
    const { writer, file } = manifestFor('attempts.jsonl', plan);
    let calls = 0;
    await sweep({
      cells: plan,
      manifest: writer,
      subdivision: SUBDIVISION,
      maxResultCount: CAP,
      includedTypes: ['bar', 'dance_hall'],
      transport: async () => {
        calls += 1;
        if (calls === 1) throw new Error('Invalid value at included_types[1] (TYPE_ENUM), "dance_hall"');
        return { places: [] };
      },
    });
    writer.close();
    const attempts = (loadManifest(file)?.records ?? [])
      .filter((record: any) => record.type === 'ATTEMPT')
      .map((record: any) => record.attemptN);
    expect(attempts).toEqual([1, 2]);
  });
});
