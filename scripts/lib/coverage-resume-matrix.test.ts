import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// @ts-ignore -- the operator scripts intentionally remain native ESM.
import { SweepInterrupted, runSweep } from './coverage-sweep-engine.mjs';
// @ts-ignore
import {
  BLOCKING_ERROR_CLASSES,
  SATURATED_AT_FLOOR,
  ackEligibility,
  completeness,
  configHash,
  loadManifest,
  openManifest,
} from './coverage-manifest.mjs';
// @ts-ignore
import { planCells, subdivideCell } from './coverage-subdivide.mjs';

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

/**
 * The children a real SUBDIVIDE records: full geometry, not just ids. Fixtures
 * used to hand-roll `{ id, depth, sideMeters }`, which is only survivable while
 * no child ever has to subdivide — `subdivideCell` destructures `cell.bbox` and
 * throws on a child seeded without one. Any fixture with a CAPPED child needs
 * the real thing, so all of them use it.
 */
const realKids = () => subdivideCell(baseCell(), SUBDIVISION) as any[];

/** The reachable shapes a cell can be in when a run is resumed. */
const STATES: Array<{ name: string; settled?: boolean; write: (w: any, id: string) => void }> = [
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
      const kids = realKids();
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
      const kids = realKids();
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
    settled: true,
    write: (w, id) => {
      w.attempt({ cellId: id, attemptN: 1, ok: false, errorClass: 'http4xx' });
      w.ackTerminal(id, 'permanent rejection', 'operator');
      w.done(id, 'ack_terminal');
    },
  },
  {
    name: 'saturated at the floor',
    settled: true,
    write: (w, id) => {
      w.attempt({ cellId: id, attemptN: 1, ok: true, count: CAP, capped: true });
      w.result(id, page(CAP, 'i'));
      w.done(id, SATURATED_AT_FLOOR);
    },
  },
  {
    // The state the acknowledged short-circuit actually exists for. The
    // uncapped acknowledged cell above cannot detect its removal: without the
    // short-circuit it falls through to the generic completing-status path and
    // behaves identically. Only a CAPPED acknowledged cell takes cap recovery
    // instead, spending four child calls on work the operator waived.
    name: 'acknowledged while capped',
    settled: true,
    write: (w, id) => {
      w.attempt({ cellId: id, attemptN: 1, ok: true, count: CAP, capped: true });
      w.result(id, page(CAP, 'j'));
      w.ackTerminal(id, 'permanent rejection at this geometry', 'operator');
      w.done(id, 'ack_terminal');
    },
  },
  {
    // 'cleared' is the terminal status of every subdivided parent and it was
    // seeded by NO fixture, so the one completeness clause that accepts it was
    // never exercised from disk. Here the children are all finished but the
    // parent's own DONE was lost — the state a kill after the last child
    // produces, and the one where the engine must write 'cleared' itself.
    name: 'subdivided, all children done, parent DONE lost',
    write: (w, id) => {
      const kids = realKids();
      w.attempt({ cellId: id, attemptN: 1, ok: true, count: CAP, capped: true });
      w.result(id, page(CAP, 'k'));
      w.subdivide(id, kids.map((k) => k.id), kids);
      for (const kid of kids) {
        w.attempt({ cellId: kid.id, attemptN: 1, ok: true, count: 1, capped: false });
        w.result(kid.id, [{ id: `k-${kid.id}` }]);
        w.done(kid.id, 'unsaturated');
      }
    },
  },
  {
    // The same subtree one record later: the parent recorded 'cleared'. The
    // clean terminal shape of a subdivision, and previously unrepresented.
    name: 'subdivided and cleared',
    settled: true,
    write: (w, id) => {
      const kids = realKids();
      w.attempt({ cellId: id, attemptN: 1, ok: true, count: CAP, capped: true });
      w.result(id, page(CAP, 'l'));
      w.subdivide(id, kids.map((k) => k.id), kids);
      for (const kid of kids) {
        w.attempt({ cellId: kid.id, attemptN: 1, ok: true, count: 1, capped: false });
        w.result(kid.id, [{ id: `l-${kid.id}` }]);
        w.done(kid.id, 'unsaturated');
      }
      w.done(id, 'cleared');
    },
  },
  {
    // Reachable: the --ack-cell path writes ACK_TERMINAL and DONE as two
    // separately fsynced records (nearby-sweep.mjs), so a kill between them
    // leaves a waiver that never committed. The cell must therefore still owe
    // work — a half-written waiver is not a waiver.
    name: 'waiver written, DONE lost',
    write: (w, id) => {
      w.attempt({ cellId: id, attemptN: 1, ok: false, errorClass: 'http4xx' });
      w.ackTerminal(id, 'permanent rejection', 'operator');
    },
  },
  {
    // The inverse, and the one the `acked` check in the engine's waiver guard
    // exists for: a DONE claiming the word with no ACK_TERMINAL behind it.
    // Capped, because only a capped cell can tell the two guards apart — an
    // uncapped one reaches the same replay-and-return either way, which is why
    // dropping the check survived the previous matrix. A forged status must not
    // buy a cell out of the subdivision it owes.
    name: 'DONE claims ack_terminal while capped, no ACK record',
    write: (w, id) => {
      w.attempt({ cellId: id, attemptN: 1, ok: true, count: CAP, capped: true });
      w.result(id, page(CAP, 'm'));
      w.done(id, 'ack_terminal');
    },
  },
  {
    // The state the PREVIOUS engine wrote and this one must not launder. Its
    // children are all finished, so the settle branch wants to fire — but the
    // parent also carries a transient failure recorded after them, which the
    // old code produced by re-querying exactly this shape. Writing 'cleared'
    // over it made the cell unreachable from both directions: completeness kept
    // saying incomplete_failed, no resume ever retried it, and ackEligibility
    // refuses to waive a transient class. Resume must retry instead.
    name: 'subdivided and finished, but a transient failure came after',
    write: (w, id) => {
      const kids = realKids();
      w.attempt({ cellId: id, attemptN: 1, ok: true, count: CAP, capped: true });
      w.result(id, page(CAP, 'p'));
      w.subdivide(id, kids.map((k) => k.id), kids);
      for (const kid of kids) {
        w.attempt({ cellId: kid.id, attemptN: 1, ok: true, count: 1, capped: false });
        w.result(kid.id, [{ id: `p-${kid.id}` }]);
        w.done(kid.id, 'unsaturated');
      }
      w.attempt({ cellId: id, attemptN: 2, ok: false, errorClass: 'quota' });
    },
  },
  {
    // The forged waiver one level DOWN. The root-level version above escapes
    // through cap recovery, so it cannot tell whether the child-finished
    // predicate checks `acked` — this one can: if the predicate trusts the
    // status alone, the parent is cleared over a child that was never really
    // waived, and that child stays outstanding with no lever forever.
    name: 'child DONE claims ack_terminal, no ACK record',
    write: (w, id) => {
      const kids = realKids();
      w.attempt({ cellId: id, attemptN: 1, ok: true, count: CAP, capped: true });
      w.result(id, page(CAP, 'q'));
      w.subdivide(id, kids.map((k) => k.id), kids);
      for (const kid of kids.slice(0, 3)) {
        w.attempt({ cellId: kid.id, attemptN: 1, ok: true, count: 1, capped: false });
        w.result(kid.id, [{ id: `q-${kid.id}` }]);
        w.done(kid.id, 'unsaturated');
      }
      const forged = kids[3];
      w.attempt({ cellId: forged.id, attemptN: 1, ok: true, count: CAP, capped: true });
      w.result(forged.id, page(CAP, 'r'));
      w.done(forged.id, 'ack_terminal');
    },
  },
  {
    // A transient failure recorded against a CHILD after that child already
    // finished. The parent's own records look clean, so the settle branch was
    // happy to clear it, and the child — completing status, blocking failure —
    // was skipped by the engine's fast path and rejected by completeness at the
    // same time, with ackEligibility refusing to waive a transient class.
    name: 'subdivided and finished, but a child failed transiently after',
    write: (w, id) => {
      const kids = realKids();
      w.attempt({ cellId: id, attemptN: 1, ok: true, count: CAP, capped: true });
      w.result(id, page(CAP, 'u'));
      w.subdivide(id, kids.map((k) => k.id), kids);
      for (const kid of kids) {
        w.attempt({ cellId: kid.id, attemptN: 1, ok: true, count: 1, capped: false });
        w.result(kid.id, [{ id: `u-${kid.id}` }]);
        w.done(kid.id, 'unsaturated');
      }
      w.attempt({ cellId: kids[0].id, attemptN: 2, ok: false, errorClass: 'quota' });
    },
  },
  {
    // A DONE with no ATTEMPT behind it at all. completeness has always demanded
    // evidence for 'unsaturated'; the engine's status check did not, so this
    // was finished to one judge and outstanding to the other — and unwaivable,
    // because ackEligibility refuses a cell that was never attempted.
    name: 'DONE claims unsaturated, never attempted',
    write: (w, id) => w.done(id, 'unsaturated'),
  },
  {
    // A completing DONE whose only ATTEMPT FAILED. Distinct from the
    // never-attempted fixture: that one has zero attempts, so a check written
    // as `attempts.length > 0` would still reject it and look correct. This one
    // has an attempt and still no evidence, which is what forces the check to
    // be `lastOk` rather than a count.
    name: 'DONE claims unsaturated after a permanent failure',
    write: (w, id) => {
      w.attempt({ cellId: id, attemptN: 1, ok: false, errorClass: 'http4xx' });
      w.done(id, 'unsaturated');
    },
  },
  {
    // A legitimately cleared parent one of whose children sits at the floor.
    // The floor child is finished for SUBDIVISION purposes but never counts
    // toward a complete run, and the engine's child predicate omitted that —
    // so this manifest re-walked its subtree and appended a duplicate DONE on
    // every resume, forever.
    name: 'cleared parent with a child at the floor',
    settled: true,
    write: (w, id) => {
      const kids = realKids();
      w.attempt({ cellId: id, attemptN: 1, ok: true, count: CAP, capped: true });
      w.result(id, page(CAP, 'v'));
      w.subdivide(id, kids.map((k) => k.id), kids);
      for (const kid of kids.slice(0, 3)) {
        w.attempt({ cellId: kid.id, attemptN: 1, ok: true, count: 1, capped: false });
        w.result(kid.id, [{ id: `v-${kid.id}` }]);
        w.done(kid.id, 'unsaturated');
      }
      w.attempt({ cellId: kids[3].id, attemptN: 1, ok: true, count: CAP, capped: true });
      w.result(kids[3].id, page(CAP, 'w'));
      w.done(kids[3].id, SATURATED_AT_FLOOR);
      w.done(id, 'cleared');
    },
  },
  {
    // An UNCAPPED root that finished with evidence and then took a transient
    // failure. The capped variant routes through cap recovery, so only this one
    // exercises the completing-status fast path's blocking check — the exact
    // historical deadlock (skipped by the engine, incomplete_failed to the
    // invariant, unwaivable because the class is transient).
    name: 'cleared with evidence, then a transient failure',
    write: (w, id) => {
      w.attempt({ cellId: id, attemptN: 1, ok: true, count: 2, capped: false });
      w.result(id, page(2, 'n'));
      w.done(id, 'unsaturated');
      w.attempt({ cellId: id, attemptN: 2, ok: false, errorClass: 'quota' });
    },
  },
  {
    // Capped with its page on record, then a transient failure. Cap recovery
    // would otherwise subdivide and write 'cleared' straight over the unrecovered
    // failure, persisting a manifest that says cleared while the invariant says
    // incomplete_failed.
    name: 'capped with page, then a transient failure',
    write: (w, id) => {
      w.attempt({ cellId: id, attemptN: 1, ok: true, count: CAP, capped: true });
      w.result(id, page(CAP, 'o'));
      w.attempt({ cellId: id, attemptN: 2, ok: false, errorClass: 'quota' });
    },
  },
  {
    // A floor DONE with nothing behind it. Every other status now demands an ok
    // ATTEMPT as evidence; the floor was accepted on the bare word, and because
    // a floor cell is waivable that made it the one status a fabricated DONE
    // could ride all the way to a COMPLETE run over unsearched geography.
    name: 'DONE claims saturated_at_floor, never attempted',
    write: (w, id) => w.done(id, SATURATED_AT_FLOOR),
  },
  {
    // A place recorded by BOTH a capped parent and one of its children — which
    // is the normal case, since a child re-searches ground the parent already
    // covered. Every other fixture keeps parent and child ids disjoint, so
    // nothing pinned the emission COUNT across nodes. A live run emits such a
    // place twice, once per node, and queryHits feeds the score gate: collapse
    // it and a resumed run drops candidates an uninterrupted one keeps.
    name: 'subdivided and cleared, parent and child share a place',
    settled: true,
    write: (w, id) => {
      const kids = realKids();
      w.attempt({ cellId: id, attemptN: 1, ok: true, count: CAP, capped: true });
      w.result(id, [...page(CAP - 1, 't'), { id: 'shared-place' }]);
      w.subdivide(id, kids.map((k) => k.id), kids);
      for (const [index, kid] of kids.entries()) {
        w.attempt({ cellId: kid.id, attemptN: 1, ok: true, count: 1, capped: false });
        w.result(kid.id, index === 0 ? [{ id: 'shared-place' }] : [{ id: `t-${kid.id}` }]);
        w.done(kid.id, 'unsaturated');
      }
      w.done(id, 'cleared');
    },
  },
];

/** Cells the engine must treat as finished: waived, or short of the floor. */
const SETTLED_STATES = STATES.filter((state) => state.settled);

/** Every place the manifest records for a cell AND its descendants. */
function recordedSubtree(state: any, cellId: string, seen = new Set<string>()): string[] {
  if (seen.has(cellId)) return [];
  seen.add(cellId);
  const cell = state?.cells?.get(cellId);
  if (!cell) return [];
  return [
    ...(cell.places ?? []).map((place: any) => place.id),
    ...(cell.children ?? []).flatMap((childId: string) => recordedSubtree(state, childId, seen)),
  ];
}

let buildSeq = 0;
function build(state: (typeof STATES)[number]) {
  const cell = baseCell();
  // A UNIQUE file per CALL, not per state name. `openManifest` opens with 'a'
  // and `dir` is per-test rather than per-build, so deriving the path from the
  // name alone made every build() inside one test append to one file. Invariant
  // 5 builds three times: its "fresh manifest per stopper" was actually three
  // PLAN records deep, and the interrupt pass resumed the SUBDIVIDE the budget
  // pass had just written instead of the capped-unsubdivided state it names.
  const file = path.join(dir, `${state.name.replace(/\W+/g, '-')}-${++buildSeq}.jsonl`);
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
        // The manifest must CHANGE, or the cell must already carry a terminal
        // record of its own — a status that was on disk before this resume ran.
        //
        // This deliberately does NOT consult ackEligibility. Doing so made the
        // invariant circular: a broken ackEligibility that returned `eligible`
        // for everything satisfied the escape hatch and the whole matrix passed
        // (mutation-tested: 0 of 57 cases failed). An invariant must not be
        // excused by the function it is meant to constrain.
        const recorded = loadManifest(file)!.cells.get(cell.id);
        const alreadyTerminal =
          recorded.terminalStatus === SATURATED_AT_FLOOR ||
          ['unsaturated', 'cleared', 'ack_terminal'].includes(recorded.terminalStatus);
        expect(
          changed || alreadyTerminal,
          `${state.name}: resume did nothing and the cell has no terminal record`,
        ).toBe(true);
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
      // Not complete after four resumes. The blocker must be one of the two
      // the design admits — residual saturation, or a permanent failure the
      // operator can waive — established from the RECORDS, not by asking
      // ackEligibility (which this matrix must constrain, not defer to).
      const final = loadManifest(file)!;
      const report = completeness(final);
      const recorded = final.cells.get(cell.id);
      const lastAttempt = recorded.attempts[recorded.attempts.length - 1];
      const permanentlyFailed =
        lastAttempt && !lastAttempt.ok && !BLOCKING_ERROR_CLASSES.includes(lastAttempt.errorClass);
      expect(
        report.saturated.length > 0 || permanentlyFailed,
        `${state.name}: stuck at ${report.status} with no admissible blocker`,
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

  it.each(STATES.map((state) => [state.name, state] as const))(
    'invariant 5 — "%s" keeps its recorded places when the budget stops the resume',
    async (_name, state) => {
      // The budget-exhausted and interrupted exits were structurally
      // unreachable in this matrix: healthyTransport never fails and maxCalls
      // defaulted to Infinity, so the two exits where past bugs actually lived
      // were never entered. Both are exercised here.
      // Expected comes from the whole SUBTREE, not the root: a child's already
      // recorded page is exactly what a mid-subtree interruption threatens, and
      // deriving it from the root alone skipped those states entirely.
      const seedFile = build(state).file;
      const expected = new Set(recordedSubtree(loadManifest(seedFile), baseCell().id));
      if (expected.size === 0) return;

      for (const stopper of ['budget', 'interrupt'] as const) {
        // A FRESH manifest per stopper. Running both against one file made the
        // second inherit the first's records, so it no longer tested the state
        // this case is named for.
        const { cell, file } = build(state);
        const emitted = new Set<string>();
        const order: string[] = [];
        const writer = openManifest(file);
        await sweep({
          cells: [cell],
          manifest: writer,
          state: loadManifest(file),
          subdivision: SUBDIVISION,
          maxResultCount: CAP,
          maxCalls: stopper === 'budget' ? 0 : Infinity,
          transport: async () => {
            if (stopper === 'interrupt') throw new SweepInterrupted();
            return { places: [] };
          },
          onPlaces: (places: any[], from: any) =>
            places.forEach((place) => {
              emitted.add(place.id);
              // Keyed by NODE, not by place. A place held by both a parent and
              // a child is emitted twice by a live run, on purpose (invariant
              // 15) — the defect is replaying the same node twice.
              order.push(`${from?.id ?? '?'}|${place.id}`);
            }),
        });
        writer.close();
        for (const id of expected) {
          expect(emitted.has(id), `${state.name}/${stopper}: dropped recorded place ${id}`).toBe(
            true,
          );
        }
        // Exactly once per node, not merely at least once. The abort exits now
        // replay the cells this run never reached, so the risk flips from
        // losing a place to replaying a node twice — and queryHits feeds the
        // score gate in both directions.
        const duplicated = [...new Set(order.filter((key, at) => order.indexOf(key) !== at))];
        expect(duplicated, `${state.name}/${stopper}: replayed a node twice`).toEqual([]);
      }
    },
  );

  it('invariant 6 selects its states semantically, not by name', () => {
    // A regex over display names silently drops coverage on a rename. The
    // marker is a property of the fixture, and this asserts the selection still
    // finds them — a filter that matches nothing is a green no-op.
    expect(SETTLED_STATES.length).toBeGreaterThanOrEqual(3);
  });

  it.each(SETTLED_STATES.map((state) => [state.name, state] as const))(
    'invariant 6 — "%s" is never re-queried; it is already settled',
    async (_name, state) => {
      // Nothing else constrains these branches: a floor cell never reaches
      // `complete` so the honesty invariants skip it, and an acknowledged cell
      // is terminal so the progress invariants are satisfied by its existing
      // record. Spending money re-asking a settled cell is the failure, so
      // assert on the calls directly.
      const { cell, file } = build(state);
      const called: string[] = [];
      const writer = openManifest(file);
      await sweep({
        cells: [cell],
        manifest: writer,
        state: loadManifest(file),
        subdivision: SUBDIVISION,
        maxResultCount: CAP,
        transport: healthyTransport(called),
      });
      writer.close();
      expect(called, `${state.name}: re-queried a cell that was already settled`).toEqual([]);
    },
  );

  it.each(STATES.map((state) => [state.name, state] as const))(
    'invariant 7 — the seeded state "%s" is judged honestly before anything runs',
    async (_name, state) => {
      // Every other invariant resumes first, which lets the healthy engine
      // repair the manifest before completeness is ever consulted. A
      // completeness() that ignored unclearedCap therefore passed every case.
      // Judge the manifest as seeded, with no resume in between.
      const { cell, file } = build(state);
      const seeded = loadManifest(file)!;
      const recorded = seeded.cells.get(cell.id);
      if (!completeness(seeded).complete) return;
      expect(
        !recorded.capped || recorded.children.length > 0 || Boolean(recorded.acked),
        `${state.name}: reported complete while capped and never subdivided`,
      ).toBe(true);
      expect(['unsaturated', 'cleared', 'ack_terminal']).toContain(recorded.terminalStatus);
    },
  );

  it.each(STATES.filter((state) => !state.settled).map((state) => [state.name, state] as const))(
    'invariant 8 — one healthy resume fully settles "%s", with no redundant call',
    async (_name, state) => {
      // Catches a subdivision that finishes its children but never records its
      // own terminal status: the run self-heals a resume later, at the cost of
      // a wasted paid call and a duplicate SUBDIVIDE. "Converges eventually" is
      // not the bar; converging in one pass without re-billing is.
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

      const after = loadManifest(file)!;
      // Against a transport that always answers and never caps, every
      // non-settled state must finish in ONE pass. "Converges eventually" is
      // not the bar: a subdivision that completes its children but never
      // records its own terminal status self-heals on the next resume, and
      // pays for the parent a second time to do it.
      expect(
        completeness(after).status,
        `${state.name}: one healthy resume did not settle it`,
      ).toBe('complete');
      expect(
        after.cells.get(cell.id).terminalStatus,
        `${state.name}: complete but the parent recorded no terminal status`,
      ).not.toBeNull();
      const second: string[] = [];
      const again = openManifest(file);
      await sweep({
        cells: [cell],
        manifest: again,
        state: loadManifest(file),
        subdivision: SUBDIVISION,
        maxResultCount: CAP,
        transport: healthyTransport(second),
      });
      again.close();
      expect(second, `${state.name}: a completed manifest was re-queried`).toEqual([]);
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

  // --------------------------------------------------------------------------
  // The invariants below close mutations that survived all 107 earlier cases.
  // Every one of them was confirmed to survive by applying the edit named in
  // the comment and watching the whole matrix stay green.
  // --------------------------------------------------------------------------

  it.each(STATES.map((state) => [state.name, state] as const))(
    'invariant 9 — "%s" spends no call once the budget is gone',
    async (_name, state) => {
      // Survived: `ctx.callsUsed >= ctx.maxCalls` -> `>`. The matrix asserted
      // that a budget stop KEEPS its data (invariant 5) but never that the
      // budget is actually honoured, so an off-by-one bought one paid call per
      // outstanding cell — the exact opposite of what AC7 calls a hard budget.
      const { cell, file } = build(state);
      const called: string[] = [];
      const writer = openManifest(file);
      const report = await sweep({
        cells: [cell],
        manifest: writer,
        state: loadManifest(file),
        subdivision: SUBDIVISION,
        maxResultCount: CAP,
        maxCalls: 0,
        transport: async (queried: any) => {
          called.push(queried.id);
          return { places: [] };
        },
      });
      writer.close();
      expect(called, `${state.name}: called the API with a spent budget`).toEqual([]);
      expect(report.callsUsed, `${state.name}: reported spending a call it had no budget for`).toBe(
        0,
      );
    },
  );

  it.each(STATES.map((state) => [state.name, state] as const))(
    'invariant 10 — "%s" reports interruption honestly',
    async (_name, state) => {
      // Survived: `ctx.interrupted = true` -> `false`. Every case discarded
      // runSweep's return value, so nothing constrained the report the caller
      // uses to decide whether the run may be treated as a normal stop.
      const healthy = build(state);
      const healthyWriter = openManifest(healthy.file);
      const clean = await sweep({
        cells: [healthy.cell],
        manifest: healthyWriter,
        state: loadManifest(healthy.file),
        subdivision: SUBDIVISION,
        maxResultCount: CAP,
        transport: healthyTransport([]),
      });
      healthyWriter.close();
      expect(clean.interrupted, `${state.name}: a healthy run claimed it was interrupted`).toBe(
        false,
      );

      const stopped = build(state);
      const called: string[] = [];
      const stoppedWriter = openManifest(stopped.file);
      const halted = await sweep({
        cells: [stopped.cell],
        manifest: stoppedWriter,
        state: loadManifest(stopped.file),
        subdivision: SUBDIVISION,
        maxResultCount: CAP,
        transport: async (queried: any) => {
          called.push(queried.id);
          throw new SweepInterrupted();
        },
      });
      stoppedWriter.close();
      // Only states that actually reach the transport can be interrupted; the
      // settled ones legitimately never call it.
      if (called.length > 0) {
        expect(
          halted.interrupted,
          `${state.name}: an interrupted run reported interrupted:false`,
        ).toBe(true);
      }
    },
  );

  it('invariant 11 — a re-queried cell emits each place once, not once per source', async () => {
    // Survived: `new Set(freshPlaces.map(p => p.id))` -> `new Set()`. Every
    // fixture's recorded ids were disjoint from the healthy transport's, so the
    // subtraction in replayRecordedOnce was never actually exercised. Overlap
    // it here: queryHits counts callbacks and feeds the score gate, so a double
    // emission inflates a candidate's score on resume.
    const state = STATES.find(
      (candidate) => candidate.name === 'capped then a later ok attempt whose page was lost',
    );
    expect(state, 'fixture missing — a rename must not silently drop this case').toBeDefined();

    const { cell, file } = build(state!);
    const emitted: string[] = [];
    const writer = openManifest(file);
    await sweep({
      cells: [cell],
      manifest: writer,
      state: loadManifest(file),
      subdivision: SUBDIVISION,
      maxResultCount: CAP,
      // Returns ids the manifest ALREADY recorded for this cell.
      transport: async (queried: any) =>
        queried.id === cell.id ? { places: page(5, 'e') } : { places: page(1, queried.id) },
      onPlaces: (places: any[]) => places.forEach((place) => emitted.push(place.id)),
    });
    writer.close();

    const duplicated = [...new Set(emitted.filter((id, index) => emitted.indexOf(id) !== index))];
    expect(duplicated, 'a recorded place was emitted twice for one cell').toEqual([]);
    expect(emitted.filter((id) => id.startsWith('e-')).length, 'the recorded page was lost').toBe(
      CAP,
    );
  });

  it('invariant 12 — the later DONE wins, so a waiver can supersede a floor status', () => {
    // Survived: last-DONE-wins -> first-DONE-wins in replay(). No fixture wrote
    // two DONEs, yet that is exactly the shape the documented recovery lever
    // produces: ackEligibility admits a saturated_at_floor cell, and the ack
    // path then appends ACK_TERMINAL + DONE over the existing floor DONE. Under
    // first-wins the waiver silently does nothing and the run can never finish.
    const cell = baseCell();
    const file = path.join(dir, 'two-done.jsonl');
    const writer = openManifest(file);
    writer.plan({ configHash: configHash({ t: 'two-done' }), cells: [cell] });
    writer.attempt({ cellId: cell.id, attemptN: 1, ok: true, count: CAP, capped: true });
    writer.result(cell.id, page(CAP, 'n'));
    writer.done(cell.id, SATURATED_AT_FLOOR);
    writer.ackTerminal(cell.id, 'accepted residual saturation', 'operator');
    writer.done(cell.id, 'ack_terminal');
    writer.close();

    const recorded = loadManifest(file)!.cells.get(cell.id);
    expect(recorded.terminalStatus, 'the waiver did not supersede the floor DONE').toBe(
      'ack_terminal',
    );
    expect(
      completeness(loadManifest(file)).complete,
      'an acknowledged floor cell still blocked completion',
    ).toBe(true);
  });

  it('invariant 13 — a capped cell whose page is on record subdivides without re-billing it', async () => {
    // Survived: dropping the `known.lastOkHasResult` branch so a capped cell is
    // always re-queried. Sticky saturation still forces the subdivision, so the
    // run converges and every case stayed green — while every capped resume
    // silently paid for its parent a second time. Invariant 8 only counts calls
    // on the SECOND pass, which is why it could not see this.
    const state = STATES.find((candidate) => candidate.name === 'capped with page, no subdivide');
    expect(state, 'fixture missing — a rename must not silently drop this case').toBeDefined();

    const { cell, file } = build(state!);
    const called: string[] = [];
    const writer = openManifest(file);
    await sweep({
      cells: [cell],
      manifest: writer,
      state: loadManifest(file),
      subdivision: SUBDIVISION,
      maxResultCount: CAP,
      transport: healthyTransport(called),
    });
    writer.close();
    expect(called, 'the parent was re-queried although its capped page was on record').not.toContain(
      cell.id,
    );
    expect(called.length, 'the subdivision never ran').toBeGreaterThan(0);
  });

  it.each(STATES.map((state) => [state.name, state] as const))(
    'invariant 14 — "%s" records cleared, not unsaturated, when its children did the work',
    async (_name, state) => {
      // Survived: the literal 'cleared' in the settle branch and in
      // resumeChildren could both become 'unsaturated' with the whole suite
      // green — completeness accepts either, and no case pinned the word. The
      // manifest would then say a censored, subdivided cell came back short,
      // which is the opposite of what happened.
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

      const after = loadManifest(file)!;
      const recorded = after.cells.get(cell.id);
      if (!completeness(after).complete) return;
      if (recorded.children.length === 0) return;
      expect(
        recorded.terminalStatus,
        `${state.name}: a subdivided parent recorded '${recorded.terminalStatus}'`,
      ).toBe('cleared');
    },
  );

  it('invariant 15 — a place held by both a parent and a child is emitted once per node', async () => {
    // Survived: making replaySubtree suppress place ids already seen elsewhere
    // in the subtree. Every other fixture keeps parent and child ids disjoint,
    // so nothing observed the count. A live run emits such a place twice — once
    // per node — and queryHits feeds the score gate, so collapsing it makes a
    // resumed run drop candidates an uninterrupted run keeps. This is the exact
    // regression commit 10036d6 was written to undo.
    const state = STATES.find(
      (candidate) => candidate.name === 'subdivided and cleared, parent and child share a place',
    );
    expect(state, 'fixture missing — a rename must not silently drop this case').toBeDefined();

    const { cell, file } = build(state!);
    const emitted: string[] = [];
    const writer = openManifest(file);
    await sweep({
      cells: [cell],
      manifest: writer,
      state: loadManifest(file),
      subdivision: SUBDIVISION,
      maxResultCount: CAP,
      transport: async () => {
        throw new Error('a settled subtree must make no calls');
      },
      onPlaces: (places: any[]) => places.forEach((place) => emitted.push(place.id)),
    });
    writer.close();
    expect(
      emitted.filter((id) => id === 'shared-place').length,
      'resume collapsed a place that a live run emits once per node',
    ).toBe(2);
  });

  it.each(SETTLED_STATES.map((state) => [state.name, state] as const))(
    'invariant 16 — resuming settled "%s" appends nothing at all',
    async (_name, state) => {
      // Not spending a CALL is not the same as writing no RECORD, and only the
      // first was ever asserted. A settled cell that re-walks its subtree and
      // re-appends its DONE grows the manifest without bound across resumes —
      // which is exactly what an omitted floor case did before this round.
      const { cell, file } = build(state);
      const before = fs.readFileSync(file, 'utf8');
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
      expect(
        fs.readFileSync(file, 'utf8'),
        `${state.name}: resuming a settled manifest appended records`,
      ).toBe(before);
    },
  );

  it('invariant 17 — a waiver is refused while a child is not genuinely settled', () => {
    // ackEligibility is the third judge of "is this finished", and nothing in
    // this matrix constrained it — deliberately, because the invariants must
    // not defer to it. That left it free to drift: testing raw status
    // membership, it read a forged ack_terminal child as finished, killed its
    // own "acknowledge those children instead" refusal, and let the operator
    // waive a parent whose child was still outstanding.
    const cell = baseCell();
    const kids = realKids();
    const file = path.join(dir, 'ack-forged-child.jsonl');
    const writer = openManifest(file);
    writer.plan({ configHash: configHash({ t: 'ack-forged-child' }), cells: [cell] });
    writer.attempt({ cellId: cell.id, attemptN: 1, ok: true, count: CAP, capped: true });
    writer.result(cell.id, page(CAP, 'y'));
    writer.subdivide(cell.id, kids.map((k) => k.id), kids);
    for (const kid of kids.slice(0, 3)) {
      writer.attempt({ cellId: kid.id, attemptN: 1, ok: true, count: 1, capped: false });
      writer.result(kid.id, [{ id: `y-${kid.id}` }]);
      writer.done(kid.id, 'unsaturated');
    }
    writer.done(kids[3].id, 'ack_terminal'); // forged: no ACK_TERMINAL record
    // A permanent failure on the parent, so nothing else would refuse it.
    writer.attempt({ cellId: cell.id, attemptN: 2, ok: false, errorClass: 'http4xx' });
    writer.close();

    const verdict = ackEligibility(loadManifest(file), cell.id);
    expect(
      verdict.eligible,
      'a parent was waivable while one of its children was still outstanding',
    ).toBe(false);
    expect(verdict.reason).toContain('subdivision is unfinished');
  });

  it('invariant 18 — an abort keeps the recorded places of cells it never reached', async () => {
    // Every other case seeds ONE root, so `cells` has no successors and the
    // top-level abort path is structurally unobservable. Two roots make it
    // observable: the first aborts, and the second — already complete on disk,
    // never visited this run — must still reach the rebuilt queue.
    const first = baseCell();
    const second = { ...planCells(BBOX, 360, { prefix: 'n:1' })[0], kind: 'nearby' };
    const file = path.join(dir, 'two-roots.jsonl');
    const writer = openManifest(file);
    writer.plan({ configHash: configHash({ t: 'two-roots' }), cells: [first, second] });
    writer.attempt({ cellId: second.id, attemptN: 1, ok: true, count: 2, capped: false });
    writer.result(second.id, page(2, 'z'));
    writer.done(second.id, 'unsaturated');
    writer.close();

    for (const stopper of ['budget', 'interrupt'] as const) {
      const run = path.join(dir, `two-roots-${stopper}.jsonl`);
      fs.copyFileSync(file, run);
      const emitted: string[] = [];
      const runWriter = openManifest(run);
      await sweep({
        cells: [first, second],
        manifest: runWriter,
        state: loadManifest(run),
        subdivision: SUBDIVISION,
        maxResultCount: CAP,
        maxCalls: stopper === 'budget' ? 0 : Infinity,
        transport: async () => {
          if (stopper === 'interrupt') throw new SweepInterrupted();
          return { places: [] };
        },
        onPlaces: (places: any[]) => places.forEach((place) => emitted.push(place.id)),
      });
      runWriter.close();
      for (const place of page(2, 'z')) {
        expect(
          emitted.includes(place.id),
          `${stopper}: dropped ${place.id}, recorded for a planned cell the abort never reached`,
        ).toBe(true);
      }
      expect(
        [...new Set(emitted.filter((id, at) => emitted.indexOf(id) !== at))],
        `${stopper}: replayed a node twice`,
      ).toEqual([]);
    }
  });

  it.each(STATES.map((state) => [state.name, state] as const))(
    'invariant 19 — the summary never counts "%s" as finished while reporting it outstanding',
    async (_name, state) => {
      // `summary.finished` was the last judge still reading the bare status
      // word, so an evidence-less DONE was counted finished while the same cell
      // sat in `missing` — in the same object, which is what RUN_DONE persists
      // for the operator. Asserted as a contradiction rather than by recomputing
      // with the same predicate, so the check cannot be satisfied by the bug.
      const { cell, file } = build(state);
      const seeded = completeness(loadManifest(file)!);
      expect(
        seeded.summary.finished + seeded.missing.length,
        `${state.name}: a cell was counted finished AND reported missing`,
      ).toBeLessThanOrEqual(seeded.summary.plannedCells);
      // `outstanding` is missing + unclearedCap, so a capped-but-uncleared cell
      // is caught here and not by the line above — it has a completing status
      // word and is still owed work.
      expect(
        seeded.summary.finished + seeded.summary.outstanding,
        `${state.name}: a cell was counted finished AND outstanding`,
      ).toBeLessThanOrEqual(seeded.summary.plannedCells);

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
      const after = completeness(loadManifest(file)!);
      expect(
        after.summary.finished + after.missing.length,
        `${state.name}: after resume, a cell was counted finished AND reported missing`,
      ).toBeLessThanOrEqual(after.summary.plannedCells);
    },
  );

  it.each([
    ['children finished, parent never attempted', true, 'none'],
    ['children outstanding, parent never attempted', false, 'none'],
    ['children finished, parent attempted and FAILED', true, 'failed'],
    ['children outstanding, parent attempted and FAILED', false, 'failed'],
  ] as const)(
    'invariant 20 — a SUBDIVIDE with %s converges instead of growing forever',
    async (_label, seedChildrenFinished, parentAttempt) => {
      // The `failed` variants are what force the evidence check to read
      // `lastOk` rather than a COUNT of attempts: those parents HAVE an attempt
      // and still have no evidence, so `attempts.length > 0` would wave them
      // through exactly as the bare status word used to.
      // Two paths write a resumed 'cleared', and both must demand evidence.
      // Seeding the children FINISHED exercises the settle branch; seeding them
      // outstanding routes through resumeChildren instead, which is why one
      // fixture could not pin both.
      const cell = baseCell();
      const kids = realKids();
      const file = path.join(dir, `forged-subdivide-${seedChildrenFinished}-${parentAttempt}.jsonl`);
      const writer = openManifest(file);
      writer.plan({
        configHash: configHash({ t: `forged-${seedChildrenFinished}-${parentAttempt}` }),
        cells: [cell],
      });
      if (parentAttempt === 'failed') {
        writer.attempt({ cellId: cell.id, attemptN: 1, ok: false, errorClass: 'http4xx' });
      }
      writer.subdivide(cell.id, kids.map((k) => k.id), kids);
      if (seedChildrenFinished) {
        for (const kid of kids) {
          writer.attempt({ cellId: kid.id, attemptN: 1, ok: true, count: 1, capped: false });
          writer.result(kid.id, [{ id: `fs-${kid.id}` }]);
          writer.done(kid.id, 'unsaturated');
        }
      }
      writer.close();

      const doneRecords = () =>
        fs.readFileSync(file, 'utf8').split('\n').filter((line) => line.includes('"type":"DONE"'))
          .length;

      const counts: number[] = [doneRecords()];
      for (let round = 0; round < 3; round++) {
        const roundWriter = openManifest(file);
        await sweep({
          cells: [cell],
          manifest: roundWriter,
          state: loadManifest(file),
          subdivision: SUBDIVISION,
          maxResultCount: CAP,
          transport: healthyTransport([]),
        });
        roundWriter.close();
        counts.push(doneRecords());
        // Checked EVERY round, not only at the end. Two writers produce a
        // resumed 'cleared' — the settle branch and resumeChildren — and
        // whichever one is asked first, the OTHER repairs the manifest on the
        // following resume. An end-state assertion is therefore satisfied by
        // the surviving guard and cannot see the missing one. The lie has to be
        // caught in the round that tells it.
        const mid = loadManifest(file)!.cells.get(cell.id);
        expect(
          mid.terminalStatus === 'cleared' && !mid.lastOk,
          `round ${round + 1}: recorded 'cleared' for a cell with no successful attempt`,
        ).toBe(false);
      }
      const final = loadManifest(file)!;
      expect(
        counts[counts.length - 1],
        `DONE records kept growing: ${counts.join(' -> ')}`,
      ).toBe(counts[counts.length - 2]);
      expect(completeness(final).complete, 'never converged').toBe(true);
      // The parent's terminal record must rest on a real attempt of its own.
      expect(
        Boolean(final.cells.get(cell.id).lastOk),
        'the parent was given a terminal status with no successful attempt',
      ).toBe(true);
    },
  );

  it('invariant 22 — a fabricated floor status is neither terminal nor waivable', () => {
    // The floor was the last status accepted on its bare word, and a floor cell
    // is waivable — so one --ack-cell turned a fabricated DONE into an
    // acknowledged terminal and the run reported COMPLETE over geography nobody
    // had searched. Reproduced before the fix; both halves are pinned here.
    const state = STATES.find(
      (candidate) => candidate.name === 'DONE claims saturated_at_floor, never attempted',
    );
    expect(state, 'fixture missing — a rename must not silently drop this case').toBeDefined();

    const { cell, file } = build(state!);
    const seeded = loadManifest(file)!;
    const verdict = ackEligibility(seeded, cell.id);
    expect(verdict.eligible, 'a never-searched cell was waivable on a bare floor status').toBe(
      false,
    );
    expect(verdict.reason).toContain('never been attempted');
    expect(completeness(seeded).complete, 'a fabricated floor status reported complete').toBe(false);
  });

  it.each([
    ['subdivideFrom (capped page on record)', 'capped with page, no subdivide'],
    ['resumeChildren (subdivision already recorded)', 'subdivided, children unfinished'],
  ] as const)(
    'invariant 21 — %s: a parent whose child permanently fails does not record cleared',
    async (_label, fixtureName) => {
    // The terminal-outcome lists accept only real statuses; `null` means the
    // child is unfinished. Nothing pinned that, because healthyTransport never
    // fails, so adding `null` to those lists survived every case while letting
    // a parent claim 'cleared' over a child that never finished.
      // The parent's terminal decision is made from processCell's RETURN values,
      // where `null` means the child is unfinished. That list was spelled out at
      // three call sites and only ONE had a fixture driving a failing child
      // through it, so the other copies were free to drift.
      const state = STATES.find((candidate) => candidate.name === fixtureName);
      expect(state, 'fixture missing — a rename must not silently drop this case').toBeDefined();

      const { cell, file } = build(state!);
      let firstChild: string | null = null;
      const writer = openManifest(file);
      await sweep({
        cells: [cell],
        manifest: writer,
        state: loadManifest(file),
        subdivision: SUBDIVISION,
        maxResultCount: CAP,
        transport: async (queried: any) => {
          // One child fails permanently; the rest answer normally.
          if (queried.id !== cell.id && firstChild === null) firstChild = queried.id;
          if (queried.id === firstChild) {
            const error: any = new Error('permanent rejection');
            error.status = 400;
            throw error;
          }
          return { places: page(1, queried.id) };
        },
      });
      writer.close();

      const after = loadManifest(file)!;
      expect(
        after.cells.get(cell.id).terminalStatus,
        'the parent claimed cleared while one child never finished',
      ).not.toBe('cleared');
      expect(completeness(after).complete, 'reported complete with an unfinished child').toBe(
        false,
      );
    },
  );

  it('the matrix registers every state it claims, and invariant 5 is not a no-op', () => {
    // The count is NOT the signal — a previous edit deleted three invariants
    // while the total went up. Pin the shape instead: unique names, both
    // partitions populated, and enough states carrying recorded places that
    // invariant 5 cannot quietly degrade into an all-skip green.
    expect(new Set(STATES.map((state) => state.name)).size, 'duplicate state name').toBe(
      STATES.length,
    );
    expect(STATES.length, 'a state was dropped').toBe(29);
    expect(SETTLED_STATES.length, 'the settled partition shrank').toBe(6);
    expect(STATES.filter((state) => !state.settled).length, 'the live partition shrank').toBe(23);

    const withRecords = STATES.filter((state) => {
      const { cell, file } = build(state);
      return recordedSubtree(loadManifest(file), cell.id).length > 0;
    });
    expect(
      withRecords.length,
      'invariant 5 asserts on too few states to constrain anything',
    ).toBeGreaterThanOrEqual(9);
  });
});
