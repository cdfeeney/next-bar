import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// @ts-ignore -- the operator scripts intentionally remain native ESM.
import { runSweep } from './coverage-sweep-engine.mjs';
// @ts-ignore
import {
  SATURATED_AT_FLOOR,
  ackEligibility,
  completeness,
  configHash,
  loadManifest,
  openManifest,
} from './coverage-manifest.mjs';
// @ts-ignore
import { planCells } from './coverage-subdivide.mjs';

/**
 * Exhaustive resume-state matrix.
 *
 * Eight review rounds produced the same class of defect: `processCell` takes
 * the wrong branch for some reachable manifest state, and the run either loses
 * recall or can never converge. Sampling that space one bug at a time has not
 * worked. This enumerates it instead and asserts the invariants directly, so a
 * future edit to the guard chain fails here rather than in production.
 *
 * The three invariants, all of which the recurring bugs violated:
 *   1. PROGRESS — resuming a state that owes work either does something
 *      (a call, or a record) or is already terminal. No dead ends.
 *   2. CONVERGENCE — repeated resumes reach either `complete`, or a state whose
 *      blocker is nameable AND waivable by the operator. Nothing is stuck with
 *      no lever.
 *   3. HONESTY — `complete` is never reported while a cell owes work, and a
 *      completed run's rebuilt queue holds everything the manifest recorded.
 */

const LAT = 111_320;
const LNG = LAT * Math.cos((40.72 * Math.PI) / 180);
const BBOX = { south: 40.72, north: 40.72 + 720 / LAT, west: -73.99, east: -73.99 + 720 / LNG };
const CAP = 20;
const SUBDIVISION = { maxDepth: 2, minCellMeters: 90, branching: 4 };
const sweep = runSweep as (options: any) => Promise<any>;

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'matrix-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function baseCell(): any {
  return { ...planCells(BBOX, 360, { prefix: 'n:0' })[0], kind: 'nearby' };
}

const page = (n: number, tag: string) =>
  Array.from({ length: n }, (_, index) => ({ id: `${tag}-${index}` }));

/** The reachable shapes a cell can be in when a run is resumed. */
const STATES: Array<{ name: string; write: (w: any, id: string) => void }> = [
  { name: 'never attempted', write: () => {} },
  {
    name: 'uncapped, complete',
    write: (w, id) => {
      w.attempt({ cellId: id, attemptN: 1, ok: true, count: 2, capped: false });
      w.result(id, page(2, 'a'));
      w.done(id, 'unsaturated');
    },
  },
  {
    name: 'attempt flushed, result lost',
    write: (w, id) => w.attempt({ cellId: id, attemptN: 1, ok: true, count: 2, capped: false }),
  },
  {
    name: 'result flushed, DONE lost',
    write: (w, id) => {
      w.attempt({ cellId: id, attemptN: 1, ok: true, count: 2, capped: false });
      w.result(id, page(2, 'b'));
    },
  },
  {
    name: 'capped, result lost',
    write: (w, id) => w.attempt({ cellId: id, attemptN: 1, ok: true, count: CAP, capped: true }),
  },
  {
    name: 'capped with page, no subdivide',
    write: (w, id) => {
      w.attempt({ cellId: id, attemptN: 1, ok: true, count: CAP, capped: true });
      w.result(id, page(CAP, 'c'));
    },
  },
  {
    name: 'capped with page, stale unsaturated DONE',
    write: (w, id) => {
      w.attempt({ cellId: id, attemptN: 1, ok: true, count: CAP, capped: true });
      w.result(id, page(CAP, 'd'));
      w.done(id, 'unsaturated');
    },
  },
  {
    name: 'capped then a later ok attempt whose page was lost',
    write: (w, id) => {
      w.attempt({ cellId: id, attemptN: 1, ok: true, count: CAP, capped: true });
      w.result(id, page(CAP, 'e'));
      w.done(id, 'unsaturated');
      w.attempt({ cellId: id, attemptN: 2, ok: true, count: 3, capped: false });
    },
  },
  {
    name: 'subdivided, children unfinished',
    write: (w, id) => {
      const kids = [0, 1, 2, 3].map((i) => ({ id: `${id}/${i}`, depth: 1, sideMeters: 180 }));
      w.attempt({ cellId: id, attemptN: 1, ok: true, count: CAP, capped: true });
      w.result(id, page(CAP, 'f'));
      w.subdivide(id, kids.map((k) => k.id), kids);
      w.attempt({ cellId: kids[0].id, attemptN: 1, ok: true, count: 1, capped: false });
      w.result(kids[0].id, page(1, 'g'));
      w.done(kids[0].id, 'unsaturated');
    },
  },
  {
    name: 'subdivided, children unfinished, stale parent DONE',
    write: (w, id) => {
      const kids = [0, 1, 2, 3].map((i) => ({ id: `${id}/${i}`, depth: 1, sideMeters: 180 }));
      w.attempt({ cellId: id, attemptN: 1, ok: true, count: CAP, capped: true });
      w.result(id, page(CAP, 'h'));
      w.done(id, 'unsaturated');
      w.subdivide(id, kids.map((k) => k.id), kids);
    },
  },
  {
    name: 'transient failure (quota)',
    write: (w, id) => w.attempt({ cellId: id, attemptN: 1, ok: false, errorClass: 'quota' }),
  },
  {
    name: 'permanent failure (http4xx)',
    write: (w, id) => w.attempt({ cellId: id, attemptN: 1, ok: false, errorClass: 'http4xx' }),
  },
  {
    name: 'acknowledged permanent failure',
    write: (w, id) => {
      w.attempt({ cellId: id, attemptN: 1, ok: false, errorClass: 'http4xx' });
      w.ackTerminal(id, 'permanent rejection', 'operator');
      w.done(id, 'ack_terminal');
    },
  },
  {
    name: 'saturated at the floor',
    write: (w, id) => {
      w.attempt({ cellId: id, attemptN: 1, ok: true, count: CAP, capped: true });
      w.result(id, page(CAP, 'i'));
      w.done(id, SATURATED_AT_FLOOR);
    },
  },
];

function build(state: (typeof STATES)[number]) {
  const cell = baseCell();
  const file = path.join(dir, `${state.name.replace(/\W+/g, '-')}.jsonl`);
  const writer = openManifest(file);
  writer.plan({ configHash: configHash({ t: state.name }), cells: [cell] });
  state.write(writer, cell.id);
  writer.close();
  return { cell, file };
}

/** A transport that always answers, so nothing stalls for external reasons. */
function healthyTransport(log: string[]) {
  return async (cell: any) => {
    log.push(cell.id);
    return { places: page(1, cell.id) };
  };
}

describe('resume state matrix', () => {
  it.each(STATES.map((state) => [state.name, state] as const))(
    'invariant 1 — resuming "%s" makes progress or is already terminal',
    async (_name, state) => {
      const { cell, file } = build(state);
      const before = fs.readFileSync(file, 'utf8');
      const owesWorkBefore = !completeness(loadManifest(file)).complete;

      const log: string[] = [];
      const writer = openManifest(file);
      await sweep({
        cells: [cell],
        manifest: writer,
        state: loadManifest(file),
        subdivision: SUBDIVISION,
        maxResultCount: CAP,
        transport: healthyTransport(log),
      });
      writer.close();

      if (owesWorkBefore) {
        const changed = fs.readFileSync(file, 'utf8') !== before;
        // Either it did something, or completeness must name a blocker the
        // operator can actually act on. Silence with outstanding work is the
        // dead end this exists to forbid.
        const report = completeness(loadManifest(file));
        const actionable =
          report.complete ||
          report.saturated.length > 0 ||
          ackEligibility(loadManifest(file), cell.id).eligible;
        expect(changed || actionable).toBe(true);
      }
    },
  );

  it.each(STATES.map((state) => [state.name, state] as const))(
    'invariant 2 — "%s" converges: repeated resumes reach complete or a waivable blocker',
    async (_name, state) => {
      const { cell, file } = build(state);
      for (let round = 0; round < 4; round++) {
        const writer = openManifest(file);
        await sweep({
          cells: [cell],
          manifest: writer,
          state: loadManifest(file),
          subdivision: SUBDIVISION,
          maxResultCount: CAP,
          transport: healthyTransport([]),
        });
        writer.close();
        if (completeness(loadManifest(file)).complete) return;
      }
      // Not complete after four resumes: the operator must have a lever, and
      // the report must name why.
      const report = completeness(loadManifest(file));
      const eligibility = ackEligibility(loadManifest(file), cell.id);
      expect(
        report.saturated.length > 0 || eligibility.eligible,
        `stuck at ${report.status} with no operator lever (${eligibility.reason})`,
      ).toBe(true);
    },
  );

  it.each(STATES.map((state) => [state.name, state] as const))(
    'invariant 3 — "%s" never reports complete while a cell owes work',
    async (_name, state) => {
      const { cell, file } = build(state);
      const writer = openManifest(file);
      await sweep({
        cells: [cell],
        manifest: writer,
        state: loadManifest(file),
        subdivision: SUBDIVISION,
        maxResultCount: CAP,
        transport: healthyTransport([]),
      });
      writer.close();

      const final = loadManifest(file)!;
      const report = completeness(final);
      if (!report.complete) return;
      for (const recorded of final.cells.values()) {
        if (!recorded.planned) continue;
        // Complete means: a terminal status that counts, no unfinished
        // subdivision, and no capped cell left unsubdivided.
        expect(['unsaturated', 'cleared', 'ack_terminal']).toContain(recorded.terminalStatus);
        if (recorded.capped) {
          expect(
            recorded.children.length > 0 || recorded.terminalStatus === 'ack_terminal',
            `${recorded.cellId} was capped but never subdivided`,
          ).toBe(true);
        }
        for (const childId of recorded.children) {
          expect(['unsaturated', 'cleared', 'ack_terminal', SATURATED_AT_FLOOR]).toContain(
            final.cells.get(childId)?.terminalStatus,
          );
        }
      }
    },
  );

  it.each(STATES.map((state) => [state.name, state] as const))(
    'invariant 4 — "%s" never trusts a page the latest attempt did not record',
    async (_name, state) => {
      // The other half of the recurring class: not "which branch" but "which
      // evidence". A page from an earlier attempt is not this attempt's answer,
      // and an empty page is still an answer. If the newest successful attempt
      // has no RESULT behind it, the cell must be asked again rather than
      // subdivided from whatever happens to be lying around.
      const { cell, file } = build(state);
      const before = loadManifest(file);
      const recorded = before?.cells.get(cell.id);
      if (!recorded?.lastOk || recorded.lastOkHasResult) return;

      const called: string[] = [];
      const writer = openManifest(file);
      await sweep({
        cells: [cell],
        manifest: writer,
        state: before,
        subdivision: SUBDIVISION,
        maxResultCount: CAP,
        transport: healthyTransport(called),
      });
      writer.close();
      expect(called, `${state.name}: resumed without re-asking a cell whose page was lost`).toContain(
        cell.id,
      );
    },
  );

  it('invariant 3b — a completed run hands back everything the manifest recorded', async () => {
    for (const state of STATES) {
      const { cell, file } = build(state);
      const writer = openManifest(file);
      await sweep({
        cells: [cell],
        manifest: writer,
        state: loadManifest(file),
        subdivision: SUBDIVISION,
        maxResultCount: CAP,
        transport: healthyTransport([]),
      });
      writer.close();
      const report = completeness(loadManifest(file));
      if (!report.complete) continue;

      const replayed = new Set<string>();
      const replayWriter = openManifest(file);
      await sweep({
        cells: [cell],
        manifest: replayWriter,
        state: loadManifest(file),
        subdivision: SUBDIVISION,
        maxResultCount: CAP,
        transport: async () => {
          throw new Error(`resuming a complete manifest must make no calls (${state.name})`);
        },
        onPlaces: (places: any[]) => places.forEach((place) => replayed.add(place.id)),
      });
      replayWriter.close();
      expect(replayed.size, `${state.name}: rebuilt queue is short`).toBe(
        report.summary.uniquePlaceIds,
      );
    }
  });
});
