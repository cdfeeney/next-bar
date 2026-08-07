import { describe, expect, it } from 'vitest';
// @ts-ignore -- the operator scripts intentionally remain native ESM.
import {
  SATURATED_AT_FLOOR,
  ackEligibility,
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

  it('keeps saturation sticky when a later attempt comes back under the cap', () => {
    // Regression: replay overwrote `capped` on every ok attempt, so a second,
    // smaller answer erased the first one's evidence and let a cell KNOWN to
    // have been censored be certified with no subdivision at all.
    const state = build([
      PLAN,
      ok('n:0:0', 20, true, 1),
      ok('n:0:0', 14, false, 2),
      { type: 'DONE', cellId: 'n:0:0', terminalStatus: 'unsaturated' },
      ok('n:0:1', 1, false),
      { type: 'DONE', cellId: 'n:0:1', terminalStatus: 'unsaturated' },
    ]);
    expect(state.cells.get('n:0:0').capped).toBe(true);
    const report = completeness(state);
    expect(report.complete).toBe(false);
    expect(report.unclearedCap).toContain('n:0:0');
  });

  it('reports a faked ack_terminal over a quota block as a FAILURE, not vague missing work', () => {
    // The waiver was removed from clause (1) but left in the blocking-failure
    // clause, so the operator-facing status hid the real reason.
    const state = build([
      PLAN,
      { type: 'ATTEMPT', cellId: 'n:0:0', attemptN: 1, ok: false, errorClass: 'quota' },
      { type: 'DONE', cellId: 'n:0:0', terminalStatus: 'ack_terminal' },
      ok('n:0:1', 1, false),
      { type: 'DONE', cellId: 'n:0:1', terminalStatus: 'unsaturated' },
    ]);
    const report = completeness(state);
    expect(report.complete).toBe(false);
    expect(report.failed).toContain('n:0:0');
    expect(report.status).toBe('incomplete_failed');
  });

  it('rejects an ack_terminal status with no acknowledgement behind it', () => {
    // The word alone must not waive a quota block: without a real ACK_TERMINAL
    // record, a bare DONE claiming ack_terminal would forgive every missing
    // cell and every blocking failure.
    const state = build([
      PLAN,
      { type: 'ATTEMPT', cellId: 'n:0:0', attemptN: 1, ok: false, errorClass: 'quota' },
      { type: 'DONE', cellId: 'n:0:0', terminalStatus: 'ack_terminal' },
      ok('n:0:1', 1, false),
      { type: 'DONE', cellId: 'n:0:1', terminalStatus: 'unsaturated' },
    ]);
    const report = completeness(state);
    expect(report.complete).toBe(false);
    expect(report.missing).toContain('n:0:0');
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

  it('treats a completing DONE with no successful attempt as unfinished', () => {
    // A DONE record is a claim, not evidence. A truncated or hand-edited
    // manifest could otherwise assert completeness for work never performed.
    const state = build([
      PLAN,
      { type: 'DONE', cellId: 'n:0:0', terminalStatus: 'unsaturated' },
      ok('n:0:1', 1, false),
      { type: 'DONE', cellId: 'n:0:1', terminalStatus: 'unsaturated' },
    ]);
    const report = completeness(state);
    expect(report.complete).toBe(false);
    expect(report.missing).toContain('n:0:0');
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

    // A file whose only record was torn by a kill has no PLAN to find. Opening
    // it would append onto the partial line and leave the manifest permanently
    // unparsable — after the run had already spent its calls.
    const torn = path.join(dir, 'torn.jsonl');
    fs.writeFileSync(torn, '{"type":"PLAN","configHash":"tor');
    expect(() => openNewManifest(torn)).toThrow(/truncated record/);

    // --resume still opens it, which is the supported way to continue.
    const resumed = openManifest(file);
    expect(resumed).toBeTruthy();
    resumed.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('operator acknowledgement', () => {
  it('lets a permanently failing cell be waived, but only with a real record', async () => {
    // Without a reachable ack path a cell Google always rejects blocks the run
    // forever. The waiver needs BOTH records: the acknowledgement and the DONE.
    const fs = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');
    // @ts-ignore
    const { openManifest, openNewManifest, loadManifest } = await import('./coverage-manifest.mjs');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'manifest-ack-'));
    const file = path.join(dir, 'run.jsonl');

    const writer = openNewManifest(file);
    writer.plan({ configHash: 'a', cells: [{ id: 'n:0:0', depth: 0 }] });
    writer.attempt({ cellId: 'n:0:0', attemptN: 1, ok: false, errorClass: 'http4xx' });
    writer.close();
    expect(completeness(loadManifest(file)!).complete).toBe(false);

    // DONE alone is not enough — the word without the acknowledgement.
    const half = openManifest(file);
    half.done('n:0:0', 'ack_terminal');
    half.close();
    expect(completeness(loadManifest(file)!).complete).toBe(false);

    const acked = openManifest(file);
    acked.ackTerminal('n:0:0', 'Google returns a permanent 400 here', 'operator');
    acked.done('n:0:0', 'ack_terminal');
    acked.close();
    const report = completeness(loadManifest(file)!);
    expect(report.complete).toBe(true);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('acknowledgement eligibility', () => {
  const plan = { type: 'PLAN', configHash: 'a', cells: [{ id: 'x', depth: 0 }] };

  it('refuses a cell that was never attempted', () => {
    // A never-attempted cell is "missing", so existence alone is no evidence.
    // Waiving it would report COMPLETE over a geography nobody searched.
    const result = ackEligibility(build([plan]), 'x');
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/never been attempted/);
  });

  it('refuses a cell whose latest attempt succeeded', () => {
    const state = build([plan, ok('x', 3, false), { type: 'DONE', cellId: 'x', terminalStatus: 'unsaturated' }]);
    expect(ackEligibility(state, 'x')).toMatchObject({ eligible: false });
  });

  it('refuses a parent whose subdivision is unfinished', () => {
    // Waiving the parent would strand the children: nothing revisits them.
    const children = [0, 1].map((index) => ({ id: `x/${index}`, depth: 1 }));
    const state = build([
      plan,
      ok('x', 20, true),
      { type: 'SUBDIVIDE', parentId: 'x', childIds: children.map((c) => c.id), childCells: children },
      ok('x/0', 1, false),
      { type: 'DONE', cellId: 'x/0', terminalStatus: 'unsaturated' },
    ]);
    const result = ackEligibility(state, 'x');
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/subdivision is unfinished/);
  });

  it('allows a cell whose latest attempt failed permanently', () => {
    const state = build([
      plan,
      { type: 'ATTEMPT', cellId: 'x', attemptN: 1, ok: false, errorClass: 'http4xx' },
    ]);
    expect(ackEligibility(state, 'x')).toMatchObject({ eligible: true });
  });

  it.each([['quota'], ['http5xx'], ['network'], ['budget_exhausted']])(
    'refuses a cell whose last failure was transient (%s)',
    (errorClass) => {
      // These are exactly what resume is for, and the runbook says so. Waiving
      // one permanently discards geography a retry would have covered.
      // budget_exhausted is written BEFORE any call, so allowing it would also
      // defeat the never-attempted guard.
      const state = build([
        plan,
        { type: 'ATTEMPT', cellId: 'x', attemptN: 1, ok: false, errorClass },
      ]);
      const result = ackEligibility(state, 'x');
      expect(result.eligible).toBe(false);
      expect(result.reason).toMatch(/transient/);
    },
  );

  it('allows a cell stuck at the saturation floor', () => {
    const state = build([plan, ok('x', 20, true), { type: 'DONE', cellId: 'x', terminalStatus: SATURATED_AT_FLOOR }]);
    expect(ackEligibility(state, 'x')).toMatchObject({ eligible: true });
  });

  it('refuses to acknowledge the same cell twice', () => {
    const state = build([
      plan,
      { type: 'ATTEMPT', cellId: 'x', attemptN: 1, ok: false, errorClass: 'http4xx' },
      { type: 'ACK_TERMINAL', cellId: 'x', reason: 'permanent 400' },
      { type: 'DONE', cellId: 'x', terminalStatus: 'ack_terminal' },
    ]);
    expect(ackEligibility(state, 'x')).toMatchObject({ eligible: false, reason: 'already acknowledged' });
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
