import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// @ts-ignore -- the operator scripts intentionally remain native ESM.
import { SweepInterrupted, runSweep } from './coverage-sweep-engine.mjs';
// @ts-ignore
import {
  MANIFEST_CORRUPT,
  TYPES_EXHAUSTED as MANIFEST_TYPES_EXHAUSTED,
  SATURATED_AT_FLOOR,
  ackEligibility,
  completeness,
  configHash,
  loadManifest,
  openManifest,
} from './coverage-manifest.mjs';
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

  it.each([
    ['every includedType rejected', { includedTypes: ['bad_type'] }],
    ['call budget exhausted', { maxCalls: 0 }],
  ])('still emits recorded places when the cell exits early (%s)', async (_label, extra: any) => {
    // Regression: moving the replay to after the transport left two early exits
    // without one, so a resumed run silently dropped places the manifest still
    // held. Every exit from processCell must preserve recorded data.
    const plan = [cells()[0]];
    const file = path.join(dir, `early-${_label.replace(/\W+/g, '-')}.jsonl`);
    const writer = openManifest(file);
    writer.plan({ configHash: configHash({ t: _label }), cells: plan });
    writer.attempt({ cellId: plan[0].id, attemptN: 1, ok: true, count: 1, capped: false });
    writer.result(plan[0].id, [{ id: 'previously-found' }]);
    writer.close();

    const emitted: string[] = [];
    const resumeWriter = openManifest(file);
    await sweep({
      cells: plan,
      manifest: resumeWriter,
      state: loadManifest(file),
      subdivision: SUBDIVISION,
      maxResultCount: CAP,
      transport: async () => {
        throw new Error('Invalid value at included_types[0] (TYPE_ENUM), "bad_type"');
      },
      onPlaces: (places: any[]) => places.forEach((place) => emitted.push(place.id)),
      ...extra,
    });
    resumeWriter.close();
    expect(emitted).toEqual(['previously-found']);
    expect(completeness(loadManifest(file)).complete).toBe(false);
  });

  it('recovers a manifest that recorded a cap but never subdivided', async () => {
    // Regression: such a manifest (written before saturation became sticky)
    // carried `capped` alongside a stale 'unsaturated' DONE. The
    // completing-status fast path returned first, so resume made zero calls,
    // wrote zero records, and the run could never finish.
    const plan = [cells()[0]];
    const file = path.join(dir, 'stale-cap.jsonl');
    const writer = openManifest(file);
    writer.plan({ configHash: configHash({ t: 'stale' }), cells: plan });
    writer.attempt({ cellId: plan[0].id, attemptN: 1, ok: true, count: CAP, capped: true });
    writer.result(plan[0].id, [{ id: 'recorded' }]);
    writer.done(plan[0].id, 'unsaturated');
    writer.close();
    expect(completeness(loadManifest(file)).unclearedCap).toContain(plan[0].id);

    const called: string[] = [];
    const resumeWriter = openManifest(file);
    await sweep({
      cells: plan,
      manifest: resumeWriter,
      state: loadManifest(file),
      subdivision: SUBDIVISION,
      maxResultCount: CAP,
      transport: async (cell: any) => {
        called.push(cell.id);
        return { places: [] };
      },
    });
    resumeWriter.close();
    // The capped page IS on record, so the parent is not re-queried — only its
    // four children are.
    expect(called).toHaveLength(4);
    expect(called).not.toContain(plan[0].id);
    const report = completeness(loadManifest(file));
    expect(report.complete).toBe(true);
    expect(report.unclearedCap).toEqual([]);
  });

  it('re-queries when the LATEST successful attempt lost its page', async () => {
    // "Does the cell have any places" cannot answer this: an earlier attempt's
    // page says yes while the newest answer is unknown, and a legitimately
    // empty page says no. Only the record order decides.
    const plan = [cells()[0]];
    const file = path.join(dir, 'stale-page.jsonl');
    const writer = openManifest(file);
    writer.plan({ configHash: configHash({ t: 'stalepage' }), cells: plan });
    writer.attempt({ cellId: plan[0].id, attemptN: 1, ok: true, count: 1, capped: false });
    writer.result(plan[0].id, [{ id: 'old' }]);
    writer.done(plan[0].id, 'unsaturated');
    writer.attempt({ cellId: plan[0].id, attemptN: 2, ok: true, count: CAP, capped: true });
    writer.close(); // capped page never persisted

    const called: string[] = [];
    const resumeWriter = openManifest(file);
    await sweep({
      cells: plan,
      manifest: resumeWriter,
      state: loadManifest(file),
      subdivision: SUBDIVISION,
      maxResultCount: CAP,
      transport: async (cell: any) => {
        called.push(cell.id);
        return { places: [] };
      },
    });
    resumeWriter.close();
    expect(called[0]).toBe(plan[0].id); // asked again rather than trusting a stale page
    expect(completeness(loadManifest(file)).complete).toBe(true);
  });

  it('preserves recorded places when the run is interrupted', async () => {
    const plan = [cells()[0]];
    const file = path.join(dir, 'interrupt-replay.jsonl');
    const writer = openManifest(file);
    writer.plan({ configHash: configHash({ t: 'irep' }), cells: plan });
    writer.attempt({ cellId: plan[0].id, attemptN: 1, ok: true, count: 2, capped: false });
    writer.result(plan[0].id, [{ id: 'a' }, { id: 'b' }]);
    writer.close();

    const emitted: string[] = [];
    const resumeWriter = openManifest(file);
    const result = await sweep({
      cells: plan,
      manifest: resumeWriter,
      state: loadManifest(file),
      subdivision: SUBDIVISION,
      maxResultCount: CAP,
      transport: async () => {
        throw new SweepInterrupted();
      },
      onPlaces: (places: any[]) => places.forEach((place) => emitted.push(place.id)),
    });
    resumeWriter.close();
    expect(result.interrupted).toBe(true);
    expect(emitted).toEqual(['a', 'b']);
  });

  it.each([
    ['at the saturation floor', SATURATED_AT_FLOOR],
    ['capped and still subdividable', null],
  ])('honours an acknowledgement across a later resume (%s)', async (_label, priorStatus: any) => {
    // Regression: the cap-recovery guard ran before the completing-status path,
    // so an acknowledged cell was re-subdivided — its ack_terminal overwritten
    // and, when subdivision was still possible, four unconsented API calls
    // spent on children the operator had explicitly excluded.
    const plan = [cells()[0]];
    const file = path.join(dir, `ack-${String(priorStatus)}.jsonl`);
    const writer = openManifest(file);
    writer.plan({ configHash: configHash({ t: _label }), cells: plan });
    writer.attempt({ cellId: plan[0].id, attemptN: 1, ok: true, count: CAP, capped: true });
    writer.result(plan[0].id, [{ id: 'p' }]);
    if (priorStatus) writer.done(plan[0].id, priorStatus, {});
    writer.ackTerminal(plan[0].id, 'permanent rejection', 'operator');
    writer.done(plan[0].id, 'ack_terminal', {});
    writer.close();
    expect(completeness(loadManifest(file)).complete).toBe(true);

    const called: string[] = [];
    const resumeWriter = openManifest(file);
    await sweep({
      cells: plan,
      manifest: resumeWriter,
      state: loadManifest(file),
      subdivision: SUBDIVISION,
      maxResultCount: CAP,
      transport: async (cell: any) => {
        called.push(cell.id);
        return { places: [] };
      },
    });
    resumeWriter.close();
    expect(called).toEqual([]);
    const after = loadManifest(file)!;
    expect(after.cells.get(plan[0].id).terminalStatus).toBe('ack_terminal');
    expect(completeness(after).complete).toBe(true);
  });

  it('re-queries a capped cell whose RESULT was never written', async () => {
    // Regression: a crash between the capped ATTEMPT and its RESULT left
    // `capped` true with no page on record. Subdividing from that skipped the
    // parent's own results entirely — the very venues subdivision exists to
    // reach past.
    const plan = [cells()[0]];
    const file = path.join(dir, 'capped-no-result.jsonl');
    const writer = openManifest(file);
    writer.plan({ configHash: configHash({ t: 'nores' }), cells: plan });
    writer.attempt({ cellId: plan[0].id, attemptN: 1, ok: true, count: CAP, capped: true });
    writer.close();

    const called: string[] = [];
    const resumeWriter = openManifest(file);
    await sweep({
      cells: plan,
      manifest: resumeWriter,
      state: loadManifest(file),
      subdivision: SUBDIVISION,
      maxResultCount: CAP,
      transport: async (cell: any) => {
        called.push(cell.id);
        return { places: [] };
      },
    });
    resumeWriter.close();
    expect(called[0]).toBe(plan[0].id); // the parent is queried first, not skipped
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

  it('gates the budget on requests actually billed, not engine invocations', async () => {
    // --max-calls is documented as a HARD Google call budget, but the engine
    // counted one "call" per transport invocation while the transport retries
    // internally, so a run could spend several times the operator's ceiling.
    // Here every invocation costs 3 requests: a budget of 4 must stop after the
    // SECOND invocation (6 spent), not run on to 4 invocations (12 spent).
    const plan = cells();
    const { writer, file } = manifestFor('budget-requests.jsonl', plan);
    const billed = { requests: 0 };
    const inner = transportFor(venues(12, 340)).transport;

    const result = await sweep({
      cells: plan,
      manifest: writer,
      subdivision: SUBDIVISION,
      maxResultCount: CAP,
      maxCalls: 4,
      spent: () => billed.requests,
      transport: async (cell: any) => {
        billed.requests += 3; // the transport retried twice under the hood
        return inner(cell);
      },
    });
    writer.close();

    expect(result.callsUsed).toBe(2);
    expect(billed.requests).toBe(6);
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

describe('no terminal writer may contradict the invariant', () => {
  /**
   * `resumeChildren` was the one 'cleared' writer that checked the parent's
   * evidence but not its blocking failure — the settle branch and the
   * cap-recovery call site both do. A parent with a successful attempt AND a
   * later quota failure, whose children then all finish during the resume,
   * had 'cleared' written over it while `completeness` reported that same cell
   * in `failed`. This test is the shape that produced it.
   */
  const PARENT = {
    id: 'p',
    kind: 'nearby',
    depth: 0,
    sideMeters: 360,
    bbox: BBOX,
    center: { latitude: 40.7215, longitude: -73.988 },
    radiusMeters: 255,
  };
  const kid = (n: number) => ({
    ...PARENT,
    id: `p/${n}`,
    depth: 1,
    sideMeters: 180,
    radiusMeters: 127,
  });

  function seedBlockedParentWithOneUnfinishedChild(file: string) {
    const writer = openManifest(file);
    writer.plan({ configHash: configHash({ t: 'blocked-parent' }), cells: [PARENT] });
    writer.attempt({ cellId: PARENT.id, attemptN: 1, ok: true, count: CAP, capped: true });
    writer.result(PARENT.id, [{ id: 'v-parent' }]);
    const kids = [kid(0), kid(1), kid(2), kid(3)];
    writer.subdivide(PARENT.id, kids.map((k) => k.id), kids);
    for (const k of kids.slice(0, 3)) {
      writer.attempt({ cellId: k.id, attemptN: 1, ok: true, count: 1, capped: false });
      writer.result(k.id, [{ id: `v-${k.id}` }]);
      writer.done(k.id, 'unsaturated', { count: 1 });
    }
    // Recorded AFTER the success and after the subdivision — the shape the
    // pre-fix engine produced by re-querying such a parent, so in-flight
    // manifests already contain it.
    writer.attempt({ cellId: PARENT.id, attemptN: 2, ok: false, errorClass: 'quota' });
    writer.close();
  }

  it('does not write cleared over a parent the invariant reports failed', async () => {
    const file = path.join(dir, 'blocked-parent.jsonl');
    seedBlockedParentWithOneUnfinishedChild(file);

    const writer = openManifest(file);
    await sweep({
      cells: [PARENT],
      state: loadManifest(file),
      manifest: writer,
      subdivision: SUBDIVISION,
      maxResultCount: CAP,
      // The last child succeeds; the parent's quota is still down.
      transport: async (cell: any) => {
        if (cell.id === PARENT.id) {
          const error: any = new Error('quota exceeded');
          error.status = 429;
          throw error;
        }
        return { places: [{ id: `v-${cell.id}` }] };
      },
    });
    writer.close();

    const after = loadManifest(file)!;
    const report = completeness(after);
    const parentDones = after.records.filter(
      (record: any) => record.type === 'DONE' && record.cellId === PARENT.id,
    );

    // Asserted as the CONTRADICTION, not as "the status equals X": the
    // manifest must never claim a cell finished while the invariant reports
    // the same cell outstanding.
    expect(report.failed).toContain(PARENT.id);
    expect(parentDones.map((record: any) => record.terminalStatus)).not.toContain('cleared');

    // And the cell keeps a lever: the block is what holds it, so a resume
    // retries it rather than skipping it.
    expect(report.status).toBe('incomplete_failed');
  });

  it('writes cleared once the block clears, and stops there', async () => {
    // The complement — the guard must not make a legitimate parent unreachable.
    const file = path.join(dir, 'recovered-parent.jsonl');
    seedBlockedParentWithOneUnfinishedChild(file);

    for (const attempt of [1, 2]) {
      const writer = openManifest(file);
      await sweep({
        cells: [PARENT],
        state: loadManifest(file),
        manifest: writer,
        subdivision: SUBDIVISION,
        maxResultCount: CAP,
        transport: async (cell: any) => ({ places: [{ id: `v-${cell.id}-${attempt}` }] }),
      });
      writer.close();
    }

    const after = loadManifest(file)!;
    expect(completeness(after).complete).toBe(true);
    const parentDones = after.records.filter(
      (record: any) => record.type === 'DONE' && record.cellId === PARENT.id,
    );
    // Converged, not looping: it settles and does not append a DONE per resume.
    expect(parentDones.length).toBeLessThanOrEqual(2);
  });
});

describe('every stuck cell keeps a lever', () => {
  const ROOT = {
    id: 'q',
    kind: 'nearby',
    depth: 0,
    sideMeters: 360,
    bbox: BBOX,
    center: { latitude: 40.7215, longitude: -73.988 },
    radiusMeters: 255,
  };

  /**
   * A SUBDIVIDE that names a child but carries no geometry for it. The engine
   * cannot reconstruct the cell, so it records a failure against the child —
   * and the CLASS of that failure decides whether anyone can ever clear it.
   */
  function seedMissingChildGeometry(file: string) {
    const writer = openManifest(file);
    writer.plan({ configHash: configHash({ t: 'corrupt-subdivide' }), cells: [ROOT] });
    writer.attempt({ cellId: ROOT.id, attemptN: 1, ok: true, count: CAP, capped: true });
    writer.result(ROOT.id, [{ id: 'v-root' }]);
    writer.subdivide(ROOT.id, ['q/0'], []);
    writer.close();
  }

  const resumeWithTypes = async (file: string, transport: any, includedTypes: string[] = []) => {
    const writer = openManifest(file);
    await sweep({
      cells: [ROOT],
      state: loadManifest(file),
      manifest: writer,
      subdivision: SUBDIVISION,
      maxResultCount: CAP,
      includedTypes,
      transport,
    });
    writer.close();
    return loadManifest(file)!;
  };

  const resume = (file: string, transport: any = async () => ({ places: [] })) =>
    resumeWithTypes(file, transport, []);

  it('records missing geometry as permanent, so the operator can waive it', async () => {
    const file = path.join(dir, 'corrupt.jsonl');
    seedMissingChildGeometry(file);
    const after = await resume(file);

    const sentinel = after.records.filter(
      (record: any) => record.type === 'ATTEMPT' && record.cellId === 'q/0',
    );
    expect(sentinel).toHaveLength(1);
    // Not a blocking class: no resume can fetch geometry that is not there, so
    // promising the operator a retry would help is false and leaves no lever.
    expect(sentinel[0].errorClass).toBe(MANIFEST_CORRUPT);
    expect(completeness(after).complete).toBe(false);

    // The lever the blocking class used to deny.
    expect(ackEligibility(after, 'q/0')).toMatchObject({ eligible: true });
  });

  it('never re-records a failure against a waived child that still has an unsettled sibling', async () => {
    // The mixed shape, and the one that actually bites. With a SINGLE
    // geometry-less child, waiving it makes every child settled, so
    // `resumeChildren` is never entered again and the ordering inside it cannot
    // matter -- which is exactly why an earlier reproduction wrongly concluded
    // the defect was not real. Give that waived child an unsettled SIBLING and
    // the parent is pulled back into `resumeChildren` on the sibling's account,
    // where the `!childCell` test fires before any Verdict is consulted.
    const file = path.join(dir, 'corrupt-ack-with-sibling.jsonl');
    const sibling = {
      id: 'q/1',
      kind: 'nearby',
      depth: 1,
      sideMeters: 180,
      bbox: BBOX,
      center: { latitude: 40.7215, longitude: -73.988 },
      radiusMeters: 127,
    };

    const writer = openManifest(file);
    writer.plan({ configHash: configHash({ t: 'corrupt-sibling' }), cells: [ROOT] });
    writer.attempt({ cellId: ROOT.id, attemptN: 1, ok: true, count: CAP, capped: true });
    writer.result(ROOT.id, [{ id: 'v-root' }]);
    // 'q/0' is named with no geometry; 'q/1' is a real, still-unfinished cell.
    writer.subdivide(ROOT.id, ['q/0', 'q/1'], [sibling]);
    writer.ackTerminal('q/0', 'SUBDIVIDE record lost this child geometry', 'operator');
    writer.done('q/0', 'ack_terminal', { reason: 'geometry unrecoverable' });
    writer.close();

    const countCorrupt = (state: any) =>
      state.records.filter(
        (record: any) =>
          record.type === 'ATTEMPT' &&
          record.cellId === 'q/0' &&
          record.errorClass === MANIFEST_CORRUPT,
      ).length;

    // The sibling keeps failing, so the parent keeps re-entering resumeChildren.
    const failSibling = async () => {
      throw Object.assign(new Error('Google Nearby Search failed (429): Quota exceeded'), {
        status: 429,
      });
    };

    const first = await resume(file, failSibling);
    const second = await resume(file, failSibling);

    expect(countCorrupt(first)).toBe(0);
    expect(countCorrupt(second)).toBe(0);
  });

  it('converges once the unreconstructable child is waived', async () => {
    const file = path.join(dir, 'corrupt-ack.jsonl');
    seedMissingChildGeometry(file);
    await resume(file);

    const writer = openManifest(file);
    writer.ackTerminal('q/0', 'SUBDIVIDE record lost this child geometry', 'operator');
    writer.done('q/0', 'ack_terminal', { reason: 'geometry unrecoverable' });
    writer.close();

    const after = await resume(file);
    expect(completeness(after).complete).toBe(true);
  });

  it('never re-records a failure against a child the operator already waived', async () => {
    // A review round claimed `resumeChildren` re-spams MANIFEST_CORRUPT over an
    // already-waived child on every resume, because it tests `!childCell`
    // before consulting the verdict. Reproduction refuted it: `resumeChildren`
    // is only reached when some child fails `isSettledForResume`, and a waived
    // child passes it, so the geometry-less branch is never re-entered. The
    // ordering inside that branch is therefore unreachable in this case.
    //
    // This test pins the guarantee to the behaviour rather than to that one
    // upstream guard, so a future change to the resume path cannot quietly
    // reintroduce the unbounded re-spam. It is a characterisation test, not
    // the regression test for a fix: it passes before and after.
    const file = path.join(dir, 'corrupt-ack-no-respam.jsonl');
    seedMissingChildGeometry(file);
    await resume(file);

    const writer = openManifest(file);
    writer.ackTerminal('q/0', 'SUBDIVIDE record lost this child geometry', 'operator');
    writer.done('q/0', 'ack_terminal', { reason: 'geometry unrecoverable' });
    writer.close();

    const countCorrupt = (state: any) =>
      state.records.filter(
        (record: any) =>
          record.type === 'ATTEMPT' &&
          record.cellId === 'q/0' &&
          record.errorClass === MANIFEST_CORRUPT,
      ).length;

    // One sentinel from the pre-waiver resume above, and no more after it.
    const firstAfterAck = await resume(file);
    expect(countCorrupt(firstAfterAck)).toBe(1);

    const secondAfterAck = await resume(file);
    expect(countCorrupt(secondAfterAck)).toBe(1);
    expect(completeness(secondAfterAck).complete).toBe(true);
  });

  it('numbers repeated sentinels upward instead of rewriting attempt 1', async () => {
    const file = path.join(dir, 'corrupt-twice.jsonl');
    seedMissingChildGeometry(file);
    await resume(file);
    const after = await resume(file);

    const numbers = after.records
      .filter((record: any) => record.type === 'ATTEMPT' && record.cellId === 'q/0')
      .map((record: any) => record.attemptN);
    expect(numbers).toHaveLength(2);
    // `unrecoveredBlocking` and `ackEligibility` both compare attempt NUMBERS,
    // so a second record reusing 1 is a record that sorts before its own
    // predecessor.
    expect(numbers[1]).toBeGreaterThan(numbers[0]);
  });

  it('counts a named-but-geometry-less child as planned work', async () => {
    // It used to be invisible. `replay` planned children only from `childCells`,
    // so a child named in `childIds` alone was skipped by completeness — neither
    // outstanding nor finished nor counted. Waiving it then let the parent
    // settle and the whole run report COMPLETE with "1/1 cells finished", over a
    // quadrant nobody had searched.
    const file = path.join(dir, 'unplanned-child.jsonl');
    seedMissingChildGeometry(file);
    const after = await resume(file);

    expect(after.cells.get('q/0')?.planned).toBe(true);
    const report = completeness(after);
    expect(report.summary.plannedCells).toBe(2);
    expect(report.complete).toBe(false);
    // Visible as outstanding rather than absent.
    expect([...report.missing, ...report.failed]).toContain('q/0');
  });

  it('keeps the waiver visible in the counts once it is granted', async () => {
    // A waived child is legitimately complete — ack_terminal is a completing
    // status by design. The defect was never that the run completes; it was
    // that it completed while reporting 1/1, hiding the waived geography.
    const file = path.join(dir, 'unplanned-child-ack.jsonl');
    seedMissingChildGeometry(file);
    await resume(file);

    const writer = openManifest(file);
    writer.ackTerminal('q/0', 'SUBDIVIDE record lost this child geometry', 'operator');
    writer.done('q/0', 'ack_terminal', { reason: 'geometry unrecoverable' });
    writer.close();

    const report = completeness(await resume(file));
    expect(report.complete).toBe(true);
    expect(report.summary.plannedCells).toBe(2);
    expect(report.summary.finished).toBe(2);
  });

  it('leaves a lever when every includedType is rejected', async () => {
    // The type list is rebuilt from configuration every run, so a resume asks
    // the identical question and gets the identical rejection. Recording that
    // as a blocking class made ackEligibility refuse it as transient while each
    // resume re-bought the calls and appended three more records.
    const file = path.join(dir, 'types-exhausted.jsonl');
    const writer = openManifest(file);
    writer.plan({ configHash: configHash({ t: 'types' }), cells: [ROOT] });
    writer.close();

    const types = ['bar', 'pub'];
    const rejectEachType = () => {
      let n = 0;
      return async () => {
        const type = types[Math.min(n, types.length - 1)];
        n += 1;
        throw new Error(`Invalid value at included_types[0] (TYPE_ENUM), "${type}"`);
      };
    };

    const first = await resumeWithTypes(file, rejectEachType(), types);
    const classes = first.cells
      .get(ROOT.id)
      .attempts.map((attempt: any) => attempt.errorClass);
    expect(classes).toContain(MANIFEST_TYPES_EXHAUSTED);
    // Not transient: a retry asks the same rejected question.
    expect(completeness(first).failed).not.toContain(ROOT.id);
    expect(ackEligibility(first, ROOT.id)).toMatchObject({ eligible: true });
  });

  it('recovers a cell whose recorded attempt numbers are sparse', async () => {
    // A merged or hand-edited manifest can carry a failure numbered far above
    // the record COUNT. Minting the next number from the count produced a
    // success that sorted BELOW that failure, so the cell ended up holding a
    // terminal DONE while the invariant still reported it failed.
    const file = path.join(dir, 'sparse-attempts.jsonl');
    const writer = openManifest(file);
    writer.plan({ configHash: configHash({ t: 'sparse' }), cells: [ROOT] });
    writer.attempt({ cellId: ROOT.id, attemptN: 100, ok: false, errorClass: 'network' });
    writer.close();

    const after = await resume(file, async () => ({ places: [{ id: 'v-1' }] }));
    const report = completeness(after);
    const dones = after.records.filter(
      (record: any) => record.type === 'DONE' && record.cellId === ROOT.id,
    );

    // Stated as the contradiction: a terminal DONE and a `failed` verdict may
    // not describe the same cell.
    expect(dones.length).toBeGreaterThan(0);
    expect(report.failed).not.toContain(ROOT.id);
    expect(report.complete).toBe(true);
  });
});
