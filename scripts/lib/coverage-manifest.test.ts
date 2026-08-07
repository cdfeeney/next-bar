import { describe, expect, it } from 'vitest';
// @ts-ignore -- the operator scripts intentionally remain native ESM.
import {
  SATURATED_AT_FLOOR,
  completeness,
  completionReport,
  configHash,
  outstandingCells,
  parseManifest,
  replay,
} from './coverage-manifest.mjs';

type Record_ = { type: string; [key: string]: unknown };

function build(records: Record_[]) {
  return replay({ records });
}

const planCells = [
  { id: 'n:0:0', kind: 'nearby', depth: 0, sideMeters: 360 },
  { id: 'n:0:1', kind: 'nearby', depth: 0, sideMeters: 360 },
];

const PLAN = { type: 'PLAN', configHash: 'abc', cells: planCells };

function ok(cellId: string, count: number, capped: boolean, attemptN = 1) {
  return { type: 'ATTEMPT', cellId, attemptN, ok: true, count, capped };
}

describe('manifest config hash', () => {
  it('ignores key order but not the effective type list', () => {
    expect(configHash({ step: 360, includedTypes: ['bar', 'pub'] })).toBe(
      configHash({ includedTypes: ['bar', 'pub'], step: 360 }),
    );
    expect(configHash({ step: 360, includedTypes: ['bar', 'pub'] })).not.toBe(
      configHash({ step: 360, includedTypes: ['bar'] }),
    );
  });
});

describe('manifest parsing survives a killed process', () => {
  it('discards a torn trailing line and keeps every durable record', () => {
    const durable = `${JSON.stringify(PLAN)}\n${JSON.stringify(ok('n:0:0', 3, false))}\n`;
    const { records, tornTail } = parseManifest(`${durable}{"type":"ATTEMPT","cellId":"n:0`);
    expect(records).toHaveLength(2);
    expect(tornTail).toBe(true);
  });
});

describe('completeness invariant', () => {
  it('reports complete only when every planned cell reached a terminal state', () => {
    const state = build([
      PLAN,
      ok('n:0:0', 3, false),
      { type: 'DONE', cellId: 'n:0:0', terminalStatus: 'unsaturated' },
      ok('n:0:1', 7, false),
      { type: 'DONE', cellId: 'n:0:1', terminalStatus: 'unsaturated' },
    ]);
    const report = completeness(state);
    expect(report.complete).toBe(true);
    expect(report.status).toBe('complete');
  });

  it('refuses to complete while a planned cell was never finished', () => {
    const state = build([PLAN, ok('n:0:0', 3, false), { type: 'DONE', cellId: 'n:0:0', terminalStatus: 'unsaturated' }]);
    const report = completeness(state);
    expect(report.complete).toBe(false);
    expect(report.status).toBe('incomplete_missing_work');
    expect(report.missing).toContain('n:0:1');
  });

  it('refuses to complete while a saturated cell was never subdivided', () => {
    const state = build([
      PLAN,
      ok('n:0:0', 20, true),
      { type: 'DONE', cellId: 'n:0:0', terminalStatus: 'unsaturated' },
      ok('n:0:1', 2, false),
      { type: 'DONE', cellId: 'n:0:1', terminalStatus: 'unsaturated' },
    ]);
    const report = completeness(state);
    expect(report.complete).toBe(false);
    expect(report.unclearedCap).toContain('n:0:0');
  });

  it('completes a saturated cell once its subdivision children all finish', () => {
    const children = [0, 1, 2, 3].map((index) => ({
      id: `n:0:0/${index}`,
      depth: 1,
      sideMeters: 180,
    }));
    const state = build([
      PLAN,
      ok('n:0:0', 20, true),
      { type: 'SUBDIVIDE', parentId: 'n:0:0', childIds: children.map((c) => c.id), childCells: children },
      ...children.flatMap((child) => [
        ok(child.id, 4, false),
        { type: 'DONE', cellId: child.id, terminalStatus: 'unsaturated' },
      ]),
      { type: 'DONE', cellId: 'n:0:0', terminalStatus: 'cleared' },
      ok('n:0:1', 1, false),
      { type: 'DONE', cellId: 'n:0:1', terminalStatus: 'unsaturated' },
    ]);
    const report = completeness(state);
    expect(report.complete).toBe(true);
    expect(report.summary.subdivided).toBe(1);
  });

  it('refuses to complete while a cell is still saturated at the floor', () => {
    const state = build([
      PLAN,
      ok('n:0:0', 20, true),
      { type: 'DONE', cellId: 'n:0:0', terminalStatus: SATURATED_AT_FLOOR },
      ok('n:0:1', 1, false),
      { type: 'DONE', cellId: 'n:0:1', terminalStatus: 'unsaturated' },
    ]);
    const report = completeness(state);
    expect(report.complete).toBe(false);
    expect(report.status).toBe('incomplete_saturated');
    expect(report.saturated).toEqual(['n:0:0']);
  });

  it.each([['quota'], ['http5xx'], ['network'], ['budget_exhausted']])(
    'refuses to complete while a %s failure is unrecovered',
    (errorClass) => {
      const state = build([
        PLAN,
        { type: 'ATTEMPT', cellId: 'n:0:0', attemptN: 1, ok: false, errorClass },
        ok('n:0:1', 1, false),
        { type: 'DONE', cellId: 'n:0:1', terminalStatus: 'unsaturated' },
      ]);
      const report = completeness(state);
      expect(report.complete).toBe(false);
      expect(report.failed).toContain('n:0:0');
    },
  );

  it('clears a failure that a later attempt recovered', () => {
    const state = build([
      PLAN,
      { type: 'ATTEMPT', cellId: 'n:0:0', attemptN: 1, ok: false, errorClass: 'http5xx' },
      ok('n:0:0', 3, false, 2),
      { type: 'DONE', cellId: 'n:0:0', terminalStatus: 'unsaturated' },
      ok('n:0:1', 1, false),
      { type: 'DONE', cellId: 'n:0:1', terminalStatus: 'unsaturated' },
    ]);
    expect(completeness(state).complete).toBe(true);
  });

  it('accepts an explicitly acknowledged terminal failure', () => {
    const state = build([
      PLAN,
      { type: 'ATTEMPT', cellId: 'n:0:0', attemptN: 1, ok: false, errorClass: 'quota' },
      { type: 'ACK_TERMINAL', cellId: 'n:0:0', reason: 'quota exhausted; operator accepted' },
      { type: 'DONE', cellId: 'n:0:0', terminalStatus: 'ack_terminal' },
      ok('n:0:1', 1, false),
      { type: 'DONE', cellId: 'n:0:1', terminalStatus: 'unsaturated' },
    ]);
    expect(completeness(state).complete).toBe(true);
  });

  it('attributes residual saturation to the floor cell, not to its ancestors', () => {
    // Regression: a child at the floor used to leave every ancestor
    // "outstanding", so the run reported generic missing work at depth 0 and
    // hid the one cell where recall is actually short.
    const children = [0, 1, 2, 3].map((index) => ({ id: `n:0:0/${index}`, depth: 1, sideMeters: 180 }));
    const state = build([
      PLAN,
      ok('n:0:0', 20, true),
      { type: 'SUBDIVIDE', parentId: 'n:0:0', childIds: children.map((c) => c.id), childCells: children },
      ok('n:0:0/0', 2, false),
      { type: 'DONE', cellId: 'n:0:0/0', terminalStatus: 'unsaturated' },
      ok('n:0:0/1', 2, false),
      { type: 'DONE', cellId: 'n:0:0/1', terminalStatus: 'unsaturated' },
      ok('n:0:0/2', 20, true),
      { type: 'DONE', cellId: 'n:0:0/2', terminalStatus: SATURATED_AT_FLOOR },
      ok('n:0:0/3', 2, false),
      { type: 'DONE', cellId: 'n:0:0/3', terminalStatus: 'unsaturated' },
      { type: 'DONE', cellId: 'n:0:0', terminalStatus: 'cleared' },
      ok('n:0:1', 1, false),
      { type: 'DONE', cellId: 'n:0:1', terminalStatus: 'unsaturated' },
    ]);
    const report = completeness(state);
    expect(report.complete).toBe(false);
    expect(report.status).toBe('incomplete_saturated');
    expect(report.saturated).toEqual(['n:0:0/2']);
    expect(report.missing).toEqual([]);
    expect(report.unclearedCap).toEqual([]);
  });

  it('names a quota block as a failure rather than as generic missing work', () => {
    // Regression: a quota-blocked cell is BOTH unfinished and failed. Reporting
    // it as "missing work" discarded the only actionable part of the diagnosis.
    const state = build([
      PLAN,
      { type: 'ATTEMPT', cellId: 'n:0:0', attemptN: 1, ok: false, errorClass: 'quota' },
      ok('n:0:1', 1, false),
      { type: 'DONE', cellId: 'n:0:1', terminalStatus: 'unsaturated' },
    ]);
    const report = completeness(state);
    expect(report.status).toBe('incomplete_failed');
    expect(report.failed).toEqual(['n:0:0']);
  });

  it('names a DONE-bearing manifest whose invariant fails as inconsistent, not complete', () => {
    const state = build([
      PLAN,
      ok('n:0:0', 3, false),
      { type: 'DONE', cellId: 'n:0:0', terminalStatus: 'unsaturated' },
      { type: 'RUN_DONE', status: 'complete' },
    ]);
    const report = completionReport(state);
    expect(report.complete).toBe(false);
    expect(report.status).toBe('manifest_inconsistent');
  });
});

describe('a new run may not append onto an existing plan', () => {
  it('refuses, because replay honours the first PLAN and would hide the new one', async () => {
    // Regression: appending PLAN B to a completed PLAN A left every B cell
    // planned:false, so B's quota failure was invisible and the run inherited
    // A's "complete".
    const fs = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');
    // @ts-ignore
    const { openManifest, openNewManifest } = await import('./coverage-manifest.mjs');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'manifest-plan-'));
    const file = path.join(dir, 'run.jsonl');

    const first = openNewManifest(file);
    first.plan({ configHash: 'aaa', cells: [{ id: 'n:0:0', depth: 0 }] });
    first.close();

    expect(() => openNewManifest(file)).toThrow(/already contains a run plan/);
    // --resume still opens it, which is the supported way to continue.
    const resumed = openManifest(file);
    expect(resumed).toBeTruthy();
    resumed.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('resume work list', () => {
  it('returns exactly the cells that never finished', () => {
    const state = build([
      { type: 'PLAN', configHash: 'abc', cells: [...planCells, { id: 'n:0:2', depth: 0 }] },
      ok('n:0:0', 3, false),
      { type: 'DONE', cellId: 'n:0:0', terminalStatus: 'unsaturated' },
      { type: 'ATTEMPT', cellId: 'n:0:1', attemptN: 1, ok: false, errorClass: 'network' },
    ]);
    expect(outstandingCells(state).map((cell: { cellId: string }) => cell.cellId)).toEqual([
      'n:0:1',
      'n:0:2',
    ]);
  });
});
