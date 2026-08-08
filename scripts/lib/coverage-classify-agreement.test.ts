/**
 * The judges may not disagree.
 *
 * Five Santa invocations on this file found the same defect seven times in
 * seven costumes: two pieces of code deciding "is this cell finished" from the
 * raw `terminalStatus` word, and one of them lagging the other. A forged
 * `ack_terminal` finished to the engine and outstanding to the invariant. An
 * evidence-less `cleared` counted in `summary.finished` while the same cell sat
 * in `missing` — in the same object, the one RUN_DONE persists. A fabricated
 * `saturated_at_floor` waived on the word alone, reporting COMPLETE over
 * geography nobody had searched.
 *
 * `classify()` makes disagreement inexpressible by construction. This file is
 * the proof, and the guard against the construction being quietly undone.
 *
 * The properties below are asserted as CONTRADICTIONS wherever possible — "the
 * summary may not count a cell finished while reporting it outstanding" — not
 * recomputed with the same predicate the code under test uses. Recomputation is
 * how this suite would manufacture its own confidence: an earlier version of
 * the resume matrix consulted `ackEligibility` to decide what `ackEligibility`
 * should say, and a deliberately broken `ackEligibility` passed all 57 cases.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-ignore -- the operator scripts intentionally remain native ESM.
import {
  SATURATED_AT_FLOOR,
  TERMINAL_STATUSES,
  ackEligibility,
  classify,
  completeness,
  isCompleting,
  isSettledForResume,
  isTerminal,
  replay,
} from './coverage-manifest.mjs';

type Record_ = { type: string; [key: string]: unknown };

const CELL = { id: 'x', kind: 'nearby', depth: 0, sideMeters: 360 };
const PLAN = { type: 'PLAN', configHash: 'abc', cells: [CELL] };

const okAttempt = (attemptN: number, capped: boolean) => ({
  type: 'ATTEMPT',
  cellId: 'x',
  attemptN,
  ok: true,
  count: capped ? 20 : 3,
  capped,
});

const failAttempt = (attemptN: number, errorClass: string) => ({
  type: 'ATTEMPT',
  cellId: 'x',
  attemptN,
  ok: false,
  errorClass,
});

/**
 * Every attempt history that changes an answer: no evidence at all, evidence,
 * evidence that a later blocking failure invalidates, a blocking failure a
 * later success recovers, and a permanent failure (which is waivable where a
 * transient one is not).
 */
const HISTORIES: Array<{ name: string; records: Record_[]; capped: boolean }> = [
  { name: 'never attempted', records: [], capped: false },
  { name: 'one clean success', records: [okAttempt(1, false)], capped: false },
  { name: 'one capped success', records: [okAttempt(1, true)], capped: true },
  { name: 'quota failure only', records: [failAttempt(1, 'quota')], capped: false },
  {
    name: 'success then quota failure',
    records: [okAttempt(1, false), failAttempt(2, 'quota')],
    capped: false,
  },
  {
    name: 'capped success then quota failure',
    records: [okAttempt(1, true), failAttempt(2, 'quota')],
    capped: true,
  },
  {
    name: 'quota failure then recovery',
    records: [failAttempt(1, 'quota'), okAttempt(2, false)],
    capped: false,
  },
  { name: 'permanent failure only', records: [failAttempt(1, 'http4xx')], capped: false },
];

/** `bogus` stands for any word a hand-edited manifest might invent. */
const STATUSES = [null, 'unsaturated', 'cleared', 'ack_terminal', SATURATED_AT_FLOOR, 'bogus'];

const CHILDREN: Array<{ name: string; records: Record_[] }> = [
  { name: 'no children', records: [] },
  {
    name: 'one finished child',
    records: [
      {
        type: 'SUBDIVIDE',
        parentId: 'x',
        childIds: ['x/0'],
        childCells: [{ id: 'x/0', kind: 'nearby', depth: 1, sideMeters: 180 }],
      },
      { type: 'ATTEMPT', cellId: 'x/0', attemptN: 1, ok: true, count: 2, capped: false },
      { type: 'DONE', cellId: 'x/0', terminalStatus: 'unsaturated' },
    ],
  },
  {
    name: 'one unfinished child',
    records: [
      {
        type: 'SUBDIVIDE',
        parentId: 'x',
        childIds: ['x/0'],
        childCells: [{ id: 'x/0', kind: 'nearby', depth: 1, sideMeters: 180 }],
      },
    ],
  },
];

type Shape = {
  name: string;
  state: ReturnType<typeof replay>;
};

function buildShapes(): Shape[] {
  const shapes: Shape[] = [];
  for (const status of STATUSES) {
    for (const acked of [false, true]) {
      for (const history of HISTORIES) {
        for (const children of CHILDREN) {
          const records: Record_[] = [PLAN, ...history.records, ...children.records];
          // The RESULT is what makes a capped attempt subdividable; include it
          // so capped shapes are the ones the engine actually produces.
          if (history.capped) {
            records.push({ type: 'RESULT', cellId: 'x', placeIds: ['p1'], places: [{ id: 'p1' }] });
          }
          if (acked) records.push({ type: 'ACK_TERMINAL', cellId: 'x', reason: 'test', operator: 'op' });
          if (status !== null) records.push({ type: 'DONE', cellId: 'x', terminalStatus: status });
          shapes.push({
            name: `status=${status ?? 'none'} ack=${acked} history="${history.name}" ${children.name}`,
            state: replay({ records }),
          });
        }
      }
    }
  }
  return shapes;
}

const SHAPES = buildShapes();

describe('classify is the only judge', () => {
  it('enumerates every shape the cross-product describes', () => {
    // A silently shrinking matrix is how a guard stops guarding. 6 statuses x
    // 2 ack states x 8 histories x 3 child shapes.
    expect(SHAPES).toHaveLength(6 * 2 * 8 * 3);
  });

  it.each(SHAPES)('$name: the verdict is internally coherent', ({ state }) => {
    const verdict = classify(state.cells.get('x'));

    expect(['unfinished', 'unbacked', 'floor', 'complete']).toContain(verdict.kind);
    expect(verdict.completing).toBe(verdict.kind === 'complete');
    expect(verdict.atFloor).toBe(verdict.kind === SATURATED_AT_FLOOR ? true : verdict.kind === 'floor');
    // `terminal` is the union of the two finished kinds, and nothing else.
    expect(verdict.terminal).toBe(verdict.completing || verdict.atFloor);
    // A run may only report done what owes no further subdivision.
    if (verdict.completing) expect(verdict.terminal).toBe(true);
    // The floor is finished as WORK and short as COVERAGE — the one place the
    // two questions legitimately differ, and the reason they have two names.
    if (verdict.atFloor) expect(verdict.completing).toBe(false);
    expect(verdict.settledForResume).toBe(verdict.terminal && !verdict.blocked);
    expect(verdict.why).toBeTruthy();
  });

  it.each(SHAPES)('$name: every exported predicate is the same verdict', ({ state }) => {
    const cell = state.cells.get('x');
    const verdict = classify(cell);
    // If these ever drift from the verdict, some caller is being told a
    // different story than the invariant is.
    expect(isCompleting(cell)).toBe(verdict.completing);
    expect(isTerminal(cell)).toBe(verdict.terminal);
    expect(isSettledForResume(cell)).toBe(verdict.settledForResume);
  });

  it.each(SHAPES)('$name: the invariant buckets by kind, not by word', ({ state }) => {
    const verdict = classify(state.cells.get('x'));
    const report = completeness(state);

    // The whole disagreement family in two lines: a cell is outstanding to the
    // invariant exactly when it is not finished to the classifier.
    expect(report.missing.includes('x')).toBe(!verdict.completing && !verdict.atFloor);
    expect(report.saturated.includes('x')).toBe(verdict.atFloor);
    expect(report.failed.includes('x')).toBe(verdict.blocked && !verdict.acknowledged);
  });

  it.each(SHAPES)('$name: the summary never counts an outstanding cell finished', ({ state }) => {
    const report = completeness(state);
    const outstanding = new Set([...report.missing, ...report.failed, ...report.unclearedCap]);
    const plannedIds = [...state.cells.values()]
      .filter((cell: any) => cell.planned)
      .map((cell: any) => cell.cellId);

    // Asserted as a contradiction, not recomputed: `finished` may never exceed
    // the cells that are NOT outstanding, whatever predicate produced it. The
    // shape this catches is `finished=1` beside `missing=['x']` in one object.
    expect(report.summary.finished).toBeLessThanOrEqual(plannedIds.length - outstanding.size);
    if (report.complete) expect(outstanding.size).toBe(0);
    // `outstanding` counts distinct CELLS. A capped cell with no DONE is both
    // `missing` and `unclearedCap`; adding the two lengths reported two
    // outstanding cells against one planned cell.
    expect(report.summary.outstanding).toBe(
      new Set([...report.missing, ...report.unclearedCap]).size,
    );
  });

  it.each(SHAPES)('$name: no waiver is granted as a floor cell unless it is one', ({ state }) => {
    const verdict = classify(state.cells.get('x'));
    const eligibility = ackEligibility(state, 'x');
    // Not "a forgery can never be waived" — a permanently failed cell
    // legitimately can be. The property is that nothing may be waived AS a
    // floor cell without being one, because that reason is what tells the
    // operator the geography was covered as far as it can be.
    if (eligibility.reason === 'saturated at the floor') {
      expect(eligibility.eligible).toBe(true);
      expect(verdict.atFloor).toBe(true);
    }
    if (verdict.acknowledged) {
      expect(eligibility).toMatchObject({ eligible: false, reason: 'already acknowledged' });
    }
  });
});

describe('the observed disagreement classes, one test each', () => {
  const forged = (status: string, extra: Record_[] = []) =>
    replay({ records: [PLAN, ...extra, { type: 'DONE', cellId: 'x', terminalStatus: status }] });

  it.each(TERMINAL_STATUSES)(
    'a DONE claiming %s with nothing behind it is unbacked to every judge',
    (status: string) => {
      const state = forged(status);
      const verdict = classify(state.cells.get('x'));
      expect(verdict.kind).toBe('unbacked');
      expect(verdict.completing).toBe(false);
      expect(verdict.terminal).toBe(false);
      expect(verdict.atFloor).toBe(false);
      expect(verdict.settledForResume).toBe(false);
      const report = completeness(state);
      expect(report.complete).toBe(false);
      expect(report.missing).toContain('x');
      expect(report.saturated).not.toContain('x');
      expect(report.summary.finished).toBe(0);
      // And no lever launders it: the floor waiver is the one that used to.
      expect(ackEligibility(state, 'x').reason).not.toBe('saturated at the floor');
    },
  );

  it('a forged ack_terminal is not finished to the engine while outstanding to the invariant', () => {
    // The original deadlock: the engine skipped it, completeness refused it,
    // and ackEligibility declined to waive it. No lever in any direction.
    const state = forged('ack_terminal', [okAttempt(1, false)]);
    const verdict = classify(state.cells.get('x'));
    expect(verdict.acknowledged).toBe(false);
    expect(verdict.completing).toBe(false);
    expect(completeness(state).missing).toContain('x');
  });

  it('a real ack_terminal is finished without any successful search', () => {
    // The complement, and the reason `hasEvidence` alone cannot be the rule:
    // an operator waiver is the one terminal claim a search cannot back.
    const state = replay({
      records: [
        PLAN,
        failAttempt(1, 'http4xx'),
        { type: 'ACK_TERMINAL', cellId: 'x', reason: 'google will never return this', operator: 'op' },
        { type: 'DONE', cellId: 'x', terminalStatus: 'ack_terminal' },
      ],
    });
    const verdict = classify(state.cells.get('x'));
    expect(verdict).toMatchObject({ kind: 'complete', acknowledged: true, hasEvidence: false });
    expect(completeness(state).complete).toBe(true);
  });

  it('an evidenced floor cell is terminal but never complete', () => {
    const state = replay({
      records: [
        PLAN,
        okAttempt(1, true),
        { type: 'RESULT', cellId: 'x', placeIds: ['p1'], places: [{ id: 'p1' }] },
        { type: 'DONE', cellId: 'x', terminalStatus: SATURATED_AT_FLOOR },
      ],
    });
    const verdict = classify(state.cells.get('x'));
    expect(verdict).toMatchObject({ kind: 'floor', terminal: true, completing: false });
    const report = completeness(state);
    expect(report.status).toBe('incomplete_saturated');
    expect(report.saturated).toContain('x');
    // Waivable — that is the operator's lever over known residual saturation.
    expect(ackEligibility(state, 'x')).toMatchObject({
      eligible: true,
      reason: 'saturated at the floor',
    });
  });

  it('a terminal status does not survive a blocking failure recorded after it', () => {
    const state = replay({
      records: [
        PLAN,
        okAttempt(1, false),
        { type: 'DONE', cellId: 'x', terminalStatus: 'unsaturated' },
        failAttempt(2, 'quota'),
      ],
    });
    const verdict = classify(state.cells.get('x'));
    // Completing and blocked at once: `kind` and `blocked` are orthogonal, and
    // conflating them is what stranded the cell with no retry and no waiver.
    expect(verdict).toMatchObject({ completing: true, blocked: true, settledForResume: false });
    expect(completeness(state).status).toBe('incomplete_failed');
  });
});

describe('the construction cannot be quietly undone', () => {
  /** Strip comments so a rule quoted in prose is not mistaken for code. */
  function codeOnly(source: string) {
    return source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .filter((line) => !line.trim().startsWith('//'))
      .map((line) => line.replace(/\s\/\/.*$/, ''))
      .join('\n');
  }

  const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
  const engine = fs.readFileSync(path.join(here, 'coverage-sweep-engine.mjs'), 'utf8');

  it('the comment stripper keeps code and drops prose', () => {
    // Without this the guard below could pass by stripping everything.
    const stripped = codeOnly(engine);
    expect(stripped).toContain('async function processCell');
    expect(stripped).not.toContain('Five Santa');
    expect(codeOnly('// terminalStatus === "cleared"\nconst a = 1;')).not.toContain('terminalStatus');
  });

  it('the engine decides from the verdict, never from a status word', () => {
    const stripped = codeOnly(engine);
    // Reading `terminalStatus` directly is exactly how the engine became a
    // second judge. `classify` is now the only place that may.
    expect(stripped).not.toMatch(/\.terminalStatus\s*===/);
    expect(stripped).not.toMatch(/COMPLETING_STATUSES\s*\.\s*includes/);
    // `.acked` and `.lastOk` are the raw fields behind `acknowledged` and
    // `hasEvidence`; reading them here is the same mistake one field down.
    //
    // The line this guard draws is between JUDGEMENT and DATA. `terminalStatus`,
    // `acked` and `lastOk` are the inputs to "is this cell finished", which is
    // the question two judges kept answering differently — those must come from
    // the verdict. `capped`, `children`, `places` and `lastOkHasResult` are
    // plain recorded facts with one reader each ("did this attempt's page reach
    // the disk" is not a verdict about finishedness), so the word boundary here
    // is deliberate: it excludes `lastOkHasResult` and catches `lastOk`.
    expect(stripped).not.toMatch(/known\??\.\s*acked\b/);
    expect(stripped).not.toMatch(/known\??\.\s*lastOk\b/);
  });
});
