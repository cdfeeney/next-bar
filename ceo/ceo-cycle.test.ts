import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ALLOWED } from '../scripts/ceo-guard.mjs';
import {
  AUTHOR_IDENTITY,
  CYCLE_ACTIONS,
  SELF_AUDIT_LINE,
  assess,
  decide,
  draft,
  enterShip,
  log,
  measure,
  runCycle,
} from '../scripts/ceo-cycle.mjs';
import baseState from './state.json';

class ProcessExit extends Error {
  constructor(readonly code: string | number | null | undefined) {
    super('process.exit(' + String(code) + ')');
  }
}

let exitSpy: ReturnType<typeof vi.spyOn>;
let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

function expectHardAbort(action: () => void, detail?: string) {
  expect(action).toThrow(ProcessExit);
  expect(exitSpy).toHaveBeenCalledWith(1);
  expect(consoleErrorSpy).toHaveBeenCalledWith(
    expect.stringContaining('Aborting.'),
  );
  if (detail !== undefined) {
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining(detail),
    );
  }
}

/** Deep clone so no test can leak a mutation into another via the imported fixture. */
function freshState() {
  return structuredClone(baseState);
}

const MEASURED_METRICS = {
  wau: 12,
  max_neighborhood_wau: 7,
  claimed_venues: 0,
  self_maintaining_venues: 0,
  venue_active_maintainers: 0,
  // One conversation happened this week, so the discovery floor lets the cycle run. Its own tests
  // set this to zero on purpose.
  user_interviews_this_week: 1,
  revenue: 0,
  operator_hours_available: 8,
};

function measurement(overrides = {}) {
  return {
    at: '2026-07-26',
    source: 'manual_count',
    metrics: { ...MEASURED_METRICS },
    ...overrides,
  };
}

/** Restores measurement — eligible when the primary metric is unmeasurable. */
const ANALYTICS_CANDIDATE = {
  id: 'analytics-events',
  statement: 'Ship the three share funnel events so WAU becomes measurable.',
  expected_lift: { metric: 'wau', delta: 0, unit: 'users' },
  operator_hours: 2,
  restores_measurement: true,
  rationale: 'Nothing downstream is evaluable while wau is null.',
};

/** Ordinary growth work — ineligible while the primary metric is unmeasurable. */
const GROWTH_CANDIDATE = {
  id: 'share-cta-copy',
  statement: 'Rewrite the share CTA copy to name the recipient benefit.',
  expected_lift: { metric: 'wau', delta: 6, unit: 'users' },
  operator_hours: 1,
  restores_measurement: false,
  rationale: 'The click is the funnel bottleneck.',
};

const EXPENSIVE_CANDIDATE = {
  id: 'venue-tour',
  statement: 'Walk 40 venues in one neighborhood and claim them by hand.',
  expected_lift: { metric: 'claimed_venues', delta: 40, unit: 'venues' },
  operator_hours: 40,
  restores_measurement: false,
  rationale: 'Supply side.',
};

beforeEach(() => {
  vi.stubEnv('LOOP_UNATTENDED', undefined);
  exitSpy = vi.spyOn(process, 'exit').mockImplementation(
    (code?: string | number | null): never => {
      throw new ProcessExit(code);
    },
  );
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('every cycle action is on the guard allowlist', () => {
  // The runner may not invent an action label. If a future stage needs a new one, it has to be
  // added to ceo-guard's ALLOWED deliberately — this test is what makes that cost visible.
  it.each(Object.entries(CYCLE_ACTIONS))(
    '%s is declared and permitted',
    (_stage, descriptor) => {
      const { capability, action } = descriptor as {
        capability: keyof typeof ALLOWED;
        action: string;
      };
      expect(ALLOWED[capability]).toContain(action);
    },
  );
});

describe('measure', () => {
  it('writes metrics through the measurement path and bumps the cycle', () => {
    const next = measure(freshState(), measurement());

    expect(next.metrics).toEqual(MEASURED_METRICS);
    expect(next.cycle).toBe(baseState.cycle + 1);
  });

  it('leaves every non-measurement field byte-identical', () => {
    const previous: Record<string, unknown> = freshState();
    const next: Record<string, unknown> = measure(previous, measurement());

    for (const key of Object.keys(previous)) {
      if (key === 'metrics' || key === 'cycle') continue;
      expect(next[key]).toEqual(previous[key]);
    }
  });

  it('aborts when the measurement smuggles an operator-owned edit', () => {
    // The whole point of the separate write path: metrics may not arrive carrying a new objective.
    expectHardAbort(
      () =>
        measure(freshState(), measurement({ objective: 'become profitable' })),
      'measurement',
    );
  });

  it('aborts on a metrics payload the state schema rejects', () => {
    expectHardAbort(() =>
      measure(
        freshState(),
        measurement({ metrics: { ...MEASURED_METRICS, wau: -4 } }),
      ),
    );
  });
});

// Review finding F1 (CRITICAL). Separating the measurement path from the agent path buys nothing
// if the agent can author the measurement: assertMeasurementUpdate polices which FIELDS change,
// never where the NUMBERS came from. An agent handing itself wau: 999999 silences the kill
// criterion without ever touching the field the guard watches.
describe('measurement provenance', () => {
  it('refuses a source that is not on the trusted list', () => {
    expectHardAbort(
      () => measure(freshState(), measurement({ source: 'agent_estimate' })),
      'not a trusted source',
    );
  });

  it('refuses a plausible-sounding invented source', () => {
    expectHardAbort(
      () => measure(freshState(), measurement({ source: 'analytics' })),
      'not a trusted source',
    );
  });

  it('accepts the two declared trusted sources', () => {
    for (const source of ['manual_count', 'analytics_rollup']) {
      expect(() => measure(freshState(), measurement({ source }))).not.toThrow();
    }
  });
});

describe('assess', () => {
  it('reports the primary metric as unmeasurable while wau is null', () => {
    const assessment = assess(freshState(), measurement({ metrics: null }));

    expect(assessment.measurable).toBe(false);
    expect(assessment.primary_metric).toBe('wau');
  });

  it('reports measurable once wau has a value', () => {
    const measured = measure(freshState(), measurement());
    const assessment = assess(measured, measurement());

    expect(assessment.measurable).toBe(true);
    expect(assessment.primary_value).toBe(12);
  });

  it('marks the kill criterion unevaluable while the metric is null', () => {
    const assessment = assess(freshState(), measurement());

    expect(assessment.kill.evaluable).toBe(false);
    expect(assessment.kill.deadline).toBe('2026-12-31');
  });

  it('does not trip the kill criterion before its deadline', () => {
    const measured = measure(freshState(), measurement());
    const assessment = assess(measured, measurement());

    expect(assessment.kill.evaluable).toBe(true);
    expect(assessment.kill.tripped).toBe(false);
  });

  // Review finding F3. The old guard read `measurable && past_deadline && below_threshold`, so a
  // null metric pinned `tripped` to false permanently — never building analytics was
  // indistinguishable from passing. Arriving at the deadline unable to measure IS the failure.
  it('trips at the deadline when the metric was never made measurable', () => {
    const assessment = assess(freshState(), measurement({ at: '2027-01-01' }));

    expect(assessment.measurable).toBe(false);
    expect(assessment.kill.evaluable).toBe(false);
    expect(assessment.kill.tripped).toBe(true);
  });

  it('trips at the deadline when a measured metric is under threshold', () => {
    const measured = measure(freshState(), measurement());
    const assessment = assess(measured, measurement({ at: '2027-01-01' }));

    expect(assessment.primary_value).toBe(12);
    expect(assessment.kill.tripped).toBe(true);
  });

  it('does not trip at the deadline once BOTH thresholds are met', () => {
    const measured = measure(
      freshState(),
      measurement({
        metrics: {
          ...MEASURED_METRICS,
          wau: 80,
          max_neighborhood_wau: 80,
          self_maintaining_venues: 20,
        },
      }),
    );
    const assessment = assess(measured, measurement({ at: '2027-01-01' }));

    expect(assessment.kill.tripped).toBe(false);
    expect(assessment.kill.verdict).toBe('CONTINUE');
  });

  // The operator wrote "if exactly one passes, do not kill — re-scope to the side that worked".
  // The previous inline version ORed the sides and reported TRIPPED here, condemning a working
  // half on the strength of a failing one.
  it('re-scopes rather than kills when exactly one side of the criterion passes', () => {
    const measured = measure(
      freshState(),
      measurement({
        metrics: { ...MEASURED_METRICS, max_neighborhood_wau: 5, self_maintaining_venues: 20 },
      }),
    );
    const assessment = assess(measured, measurement({ at: '2027-01-01' }));

    expect(assessment.kill.verdict).toBe('RESCOPE');
    expect(assessment.kill.tripped).toBe(false);
    expect(assessment.kill.rescope).toBe(true);
  });

  // The criterion is about ONE neighbourhood. A global total is the wrong number and is always
  // the more flattering one, because it sums every neighbourhood the app is spread too thin across.
  it('judges the neighbourhood number, not the global total', () => {
    const measured = measure(
      freshState(),
      measurement({
        metrics: {
          ...MEASURED_METRICS,
          wau: 400,
          max_neighborhood_wau: 5,
          self_maintaining_venues: 1,
        },
      }),
    );
    const assessment = assess(measured, measurement({ at: '2027-01-01' }));

    expect(assessment.kill.verdict).toBe('KILL');
  });
});

describe('the board has teeth in the runner', () => {
  // Found by running it (independent review). The board returned KILL, the report printed
  // "Board verdict: KILL", and the cycle recommended rewriting the share CTA underneath it. A
  // verdict a plan is allowed to sit below is not a verdict.
  const pastDeadline = (metrics: Record<string, unknown>) =>
    measurement({ at: '2027-01-01', metrics: { ...MEASURED_METRICS, ...metrics } });

  it('issues no recommendation under a KILL verdict', () => {
    const m = pastDeadline({ max_neighborhood_wau: 3, self_maintaining_venues: 1 });
    const measured = measure(freshState(), m);
    const decision = decide(measured, assess(measured, m), [GROWTH_CANDIDATE, ANALYTICS_CANDIDATE]);

    expect(decision.halt).toBe(true);
    expect(decision.directive).toBe('BOARD_KILL');
    expect(decision.recommendation).toBeNull();
  });

  it('issues no recommendation under a RESCOPE verdict either', () => {
    const m = pastDeadline({ max_neighborhood_wau: 3, self_maintaining_venues: 20 });
    const measured = measure(freshState(), m);
    const decision = decide(measured, assess(measured, m), [GROWTH_CANDIDATE]);

    expect(decision.directive).toBe('BOARD_RESCOPE');
    expect(decision.recommendation).toBeNull();
  });

  it('writes a halt report with no Recommendation section and the board reasoning in it', () => {
    const m = pastDeadline({ max_neighborhood_wau: 3, self_maintaining_venues: 1 });
    const measured = measure(freshState(), m);
    const assessment = assess(measured, m);
    const report = draft(measured, assessment, decide(measured, assessment, [GROWTH_CANDIDATE]), m);

    expect(report).toContain('BOARD_KILL');
    expect(report).not.toContain('## Recommendation');
    expect(report).toMatch(/BOTH sides failed/);
    expect(report).toMatch(/pre-registered/);
  });

  it('cannot be shipped', () => {
    expectHardAbort(
      () =>
        enterShip(
          {
            cycle: 5,
            recommendation_id: null,
            directive: 'BOARD_KILL',
            drafted: true,
            shipped: false,
            evidence: null,
            review: { verdict: 'pass', reviewer: 'deepseek', at: '2027-01-01' },
          },
          { branch: 'feat/whatever' },
        ),
      'BOARD_KILL',
    );
  });

  it('still plans normally while the board says CONTINUE', () => {
    const m = pastDeadline({ max_neighborhood_wau: 80, self_maintaining_venues: 20 });
    const measured = measure(freshState(), m);
    const decision = decide(measured, assess(measured, m), [GROWTH_CANDIDATE]);

    expect(decision.halt).toBe(false);
    expect(decision.recommendation?.id).toBe('share-cta-copy');
  });
});

describe('the discovery floor', () => {
  it('refuses to run a cycle in a week with no customer conversations', () => {
    // The rail against the comfortable substitution: an articulate strategy partner instead of a
    // conversation with an actual bar-goer or bar owner.
    expectHardAbort(
      () =>
        runCycle({
          state: freshState(),
          measurement: measurement({
            metrics: { ...MEASURED_METRICS, user_interviews_this_week: 0 },
          }),
          candidates: [ANALYTICS_CANDIDATE],
          reportsDir: path.join(mkdtempSync(path.join(tmpdir(), 'ceo-floor-')), 'reports'),
        }),
      'DISCOVERY FLOOR',
    );
  });

  it('runs once at least one conversation happened', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ceo-floor-'));
    expect(() =>
      runCycle({
        state: freshState(),
        measurement: measurement({
          metrics: { ...MEASURED_METRICS, user_interviews_this_week: 1 },
        }),
        candidates: [ANALYTICS_CANDIDATE],
        reportsDir: path.join(dir, 'reports'),
      }),
    ).not.toThrow();
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('decide', () => {
  it('returns exactly one recommendation', () => {
    const measured = measure(freshState(), measurement());
    const assessment = assess(measured, measurement());
    const decision = decide(measured, assessment, [
      GROWTH_CANDIDATE,
      ANALYTICS_CANDIDATE,
    ]);

    expect(decision.recommendation.id).toBe(GROWTH_CANDIDATE.id);
    expect(decision.recommendation.expected_lift.delta).toBe(6);
    expect(decision.recommendation.operator_hours).toBe(1);
  });

  it('admits only measurement-restoring work while the metric is unmeasurable', () => {
    // Recommending growth work you cannot measure is precisely the theater the CEO spec exists
    // to prevent — so it is a hard eligibility rule, not a scoring nudge.
    const state = freshState();
    const assessment = assess(state, measurement());
    const decision = decide(state, assessment, [
      GROWTH_CANDIDATE,
      ANALYTICS_CANDIDATE,
    ]);

    expect(decision.recommendation.id).toBe(ANALYTICS_CANDIDATE.id);
  });

  it('aborts when nothing restores measurement and the metric is null', () => {
    const state = freshState();
    const assessment = assess(state, measurement());

    expectHardAbort(
      () => decide(state, assessment, [GROWTH_CANDIDATE]),
      'no eligible candidate',
    );
  });

  it('aborts when every candidate exceeds the operator hours available', () => {
    const measured = measure(freshState(), measurement());
    const assessment = assess(measured, measurement());

    expectHardAbort(
      () => decide(measured, assessment, [EXPENSIVE_CANDIDATE]),
      'no eligible candidate',
    );
  });

  it('aborts on an empty candidate set', () => {
    const measured = measure(freshState(), measurement());
    const assessment = assess(measured, measurement());

    expectHardAbort(() => decide(measured, assessment, []));
  });

  // Review finding F2. score() returned Infinity for ANY zero-hour candidate, so free work won on
  // cost alone — including work promising a negative lift, which beat every real improvement that
  // cost an hour. Free is only infinitely efficient if it moves the metric the right way.
  it('does not let a free candidate with negative lift beat real work', () => {
    const measured = measure(freshState(), measurement());
    const assessment = assess(measured, measurement());
    const freeButHarmful = {
      id: 'aaa-remove-the-share-button',
      statement: 'Remove the share button.',
      expected_lift: { metric: 'wau', delta: -50, unit: 'users' },
      operator_hours: 0,
      restores_measurement: false,
      rationale: 'Costs nothing.',
    };

    const decision = decide(measured, assessment, [freeButHarmful, GROWTH_CANDIDATE]);

    expect(decision.recommendation.id).toBe(GROWTH_CANDIDATE.id);
  });

  it('does not let a free candidate with zero lift beat real work', () => {
    const measured = measure(freshState(), measurement());
    const assessment = assess(measured, measurement());
    const freeNoOp = {
      id: 'aaa-rename-a-variable',
      statement: 'Rename a variable.',
      expected_lift: { metric: 'wau', delta: 0, unit: 'users' },
      operator_hours: 0,
      restores_measurement: false,
      rationale: 'Costs nothing.',
    };

    expect(decide(measured, assessment, [freeNoOp, GROWTH_CANDIDATE]).recommendation.id).toBe(
      GROWTH_CANDIDATE.id,
    );
  });

  it('still prefers free work that genuinely helps', () => {
    const measured = measure(freshState(), measurement());
    const assessment = assess(measured, measurement());
    const freeAndGood = {
      id: 'zzz-flip-a-config-flag',
      statement: 'Enable the bundle-and-save badge already built.',
      expected_lift: { metric: 'wau', delta: 3, unit: 'users' },
      operator_hours: 0,
      restores_measurement: false,
      rationale: 'Already built, just off.',
    };

    expect(decide(measured, assessment, [GROWTH_CANDIDATE, freeAndGood]).recommendation.id).toBe(
      freeAndGood.id,
    );
  });

  it('breaks score ties by id without depending on the runtime locale', () => {
    // Finding F6: localeCompare varies by locale, so two machines could pick different work.
    const measured = measure(freshState(), measurement());
    const assessment = assess(measured, measurement());
    const tied = ['b-option', 'A-option', 'a-option'].map((id) => ({
      ...GROWTH_CANDIDATE,
      id,
    }));

    // Codepoint order puts uppercase 'A' first; a locale-aware compare would not.
    expect(decide(measured, assessment, tied).recommendation.id).toBe('A-option');
  });

  it('aborts on a candidate missing its expected lift or hour cost', () => {
    const measured = measure(freshState(), measurement());
    const assessment = assess(measured, measurement());
    const { expected_lift: _lift, ...noLift } = GROWTH_CANDIDATE;

    expectHardAbort(() => decide(measured, assessment, [noLift]));
  });
});

describe('draft', () => {
  function report() {
    const measured = measure(freshState(), measurement());
    const assessment = assess(measured, measurement());
    const decision = decide(measured, assessment, [GROWTH_CANDIDATE]);
    return draft(measured, assessment, decision, measurement());
  }

  it('carries the mandatory self-audit line verbatim', () => {
    expect(report()).toContain(SELF_AUDIT_LINE);
  });

  it('stays under the 400-word ceiling', () => {
    const words = report().split(/\s+/).filter((word) => word.length > 0);
    expect(words.length).toBeLessThanOrEqual(400);
  });

  it('carries exactly one recommendation', () => {
    const headings = report().match(/^## Recommendation\b/gm) ?? [];
    expect(headings).toHaveLength(1);
  });

  it('names the expected lift and the operator-hour cost', () => {
    const rendered = report();
    expect(rendered).toContain('+6 users');
    expect(rendered).toContain('1 operator hour');
  });

  it('answers the self-audit honestly on the first cycle', () => {
    // No prior cycle means no prior recommendation to have moved anything. Say that, do not
    // manufacture a retrospective.
    expect(report()).toContain('No prior cycle');
  });
});

describe('log', () => {
  let reportDir: string;
  let realReport: string;

  beforeEach(() => {
    reportDir = mkdtempSync(path.join(tmpdir(), 'ceo-log-'));
    realReport = path.join(reportDir, 'cycle-1.md');
    writeFileSync(realReport, '# CEO cycle 1\n', 'utf8');
  });

  afterEach(() => {
    rmSync(reportDir, { recursive: true, force: true });
  });

  function decisionFor(state: ReturnType<typeof freshState>) {
    const assessment = assess(state, measurement());
    return decide(state, assessment, [GROWTH_CANDIDATE]);
  }

  it('appends a history entry marked drafted, not shipped', () => {
    const measured = measure(freshState(), measurement());
    const next = log(measured, decisionFor(measured), { report_path: realReport });

    expect(next.history).toHaveLength(1);
    expect(next.history[0]).toMatchObject({
      cycle: 1,
      recommendation_id: GROWTH_CANDIDATE.id,
      drafted: true,
      shipped: false,
      evidence: null,
    });
  });

  it('never lets the agent path rewrite metrics', () => {
    const measured = measure(freshState(), measurement());

    expectHardAbort(() =>
      log(measured, decisionFor(measured), {
        report_path: realReport,
        // A caller trying to slip a metric through the agent door.
        metrics: { ...MEASURED_METRICS, wau: 999 },
      }),
    );
  });

  // Review finding F5. `drafted: true` used to be hardcoded, so history could claim a report that
  // was never written — and `history` is not a guard-protected field, so nothing else caught it.
  it('does not claim drafted for a report path that does not exist', () => {
    const measured = measure(freshState(), measurement());
    const next = log(measured, decisionFor(measured), {
      report_path: path.join(reportDir, 'cycle-999-never-written.md'),
    });

    expect(next.history[0].drafted).toBe(false);
  });

  it('does not claim drafted when no report path is given at all', () => {
    const measured = measure(freshState(), measurement());
    const next = log(measured, decisionFor(measured), {});

    expect(next.history[0].drafted).toBe(false);
  });
});

describe('enterShip refuses without a REVIEW pass', () => {
  function record(review?: unknown) {
    return {
      cycle: 1,
      recommendation_id: GROWTH_CANDIDATE.id,
      drafted: true,
      shipped: false,
      evidence: null,
      report_path: 'ceo/reports/cycle-1.md',
      ...(review === undefined ? {} : { review }),
    };
  }

  it('aborts when the record carries no review at all', () => {
    expectHardAbort(
      () => enterShip(record(), { branch: 'feat/share-loop-week1' }),
      'REVIEW',
    );
  });

  it('aborts when the review verdict is a fail', () => {
    expectHardAbort(
      () =>
        enterShip(record({ verdict: 'fail', reviewer: 'deepseek', at: '2026-07-26' }), {
          branch: 'feat/share-loop-week1',
        }),
      'REVIEW',
    );
  });

  it('aborts when the review pass names no reviewer', () => {
    // An unattributed pass is the model approving itself.
    expectHardAbort(
      () =>
        enterShip(record({ verdict: 'pass', at: '2026-07-26' }), {
          branch: 'feat/share-loop-week1',
        }),
      'REVIEW',
    );
  });

  // Review finding F4. The check was `typeof reviewer === 'string' && length > 0`, so
  // `reviewer: 'me'` cleared the SHIP gate — an unattributed self-approval wearing a name tag.
  it('aborts when the reviewer is not an independent identity', () => {
    expectHardAbort(
      () =>
        enterShip(record({ verdict: 'pass', reviewer: 'me', at: '2026-07-26' }), {
          branch: 'feat/share-loop-week1',
        }),
      'not an independent reviewer',
    );
  });

  it('aborts when the author reviews its own recommendation', () => {
    expectHardAbort(
      () =>
        enterShip(record({ verdict: 'pass', reviewer: AUTHOR_IDENTITY, at: '2026-07-26' }), {
          branch: 'feat/share-loop-week1',
        }),
      'cannot review its own',
    );
  });

  it('still refuses a protected branch after a clean review', () => {
    expectHardAbort(
      () =>
        enterShip(record({ verdict: 'pass', reviewer: 'deepseek', at: '2026-07-26' }), {
          branch: 'main',
        }),
      'protected branch',
    );
  });

  it('marks the record shipped on a clean review and an allowed branch', () => {
    const shipped = enterShip(
      record({ verdict: 'pass', reviewer: 'deepseek', at: '2026-07-26' }),
      { branch: 'feat/share-loop-week1' },
    );

    expect(shipped.shipped).toBe(true);
  });
});

// N2 wiring. The detectors are tested in isolation in ceo-detectors.test.ts; these assert that
// decide() actually OBEYS them, which is the part that can silently rot.
describe('detectors are wired into decide', () => {
  function flatEntry(cycle: number, value: number | null) {
    return {
      cycle,
      recommendation_id: 'share-cta-copy',
      directive: null,
      drafted: true,
      shipped: true,
      evidence: { kind: 'pr_sha', ref: 'a1b2c3d' },
      report_path: `ceo/reports/cycle-${cycle}.md`,
      primary_metric: 'wau',
      primary_value: value,
    };
  }

  function stalledState() {
    const measured = measure(freshState(), measurement());
    return {
      ...measured,
      history: [1, 2, 3, 4].map((cycle) => flatEntry(cycle, 12)),
    };
  }

  it('halts instead of recommending when the metric has been flat for three cycles', () => {
    const state = stalledState();
    const decision = decide(state, assess(state, measurement()), [
      GROWTH_CANDIDATE,
      ANALYTICS_CANDIDATE,
    ]);

    expect(decision.halt).toBe(true);
    expect(decision.directive).toBe('STOP_AND_REASSESS');
    // Perfectly good candidates were on the table. It still does not pick one.
    expect(decision.recommendation).toBeNull();
  });

  it('halts on a bet that passed its review cycle unjudged', () => {
    const measured = measure(freshState(), measurement());
    const state = {
      ...measured,
      active_bets: [
        { id: 'bet-share-cta', claim: 'CTA copy lifts WAU by 6', review_cycle: 0, verdict: null },
      ],
    };
    const decision = decide(state, assess(state, measurement()), [GROWTH_CANDIDATE]);

    expect(decision.halt).toBe(true);
    expect(decision.recommendation).toBeNull();
  });

  it('does not halt on a healthy record', () => {
    const measured = measure(freshState(), measurement());
    const state = {
      ...measured,
      history: [10, 20, 30, 40].map((value, index) => flatEntry(index + 1, value)),
    };
    const decision = decide(state, assess(state, measurement()), [GROWTH_CANDIDATE]);

    expect(decision.halt).toBe(false);
    expect(decision.recommendation.id).toBe(GROWTH_CANDIDATE.id);
  });

  it('renders a halt report with no recommendation section at all', () => {
    const state = stalledState();
    const assessment = assess(state, measurement());
    const decision = decide(state, assessment, [GROWTH_CANDIDATE]);
    const report = draft(state, assessment, decision, measurement());

    expect(report).toContain('STOP_AND_REASSESS');
    expect(report).toContain(SELF_AUDIT_LINE);
    // Emitting a halt and a plan in the same breath is the halt in name only.
    expect(report).not.toContain('## Recommendation');
    expect(report.split(/\s+/).filter((word) => word.length > 0).length).toBeLessThanOrEqual(400);
  });

  // Review finding C1. draft() already refuses to render a recommendation for a halted cycle, but
  // a halted RECORD could still be reviewed and shipped — shipping whatever the loop was holding.
  it('refuses to ship a halted cycle even with a clean review', () => {
    expectHardAbort(
      () =>
        enterShip(
          {
            cycle: 5,
            recommendation_id: null,
            directive: 'STOP_AND_REASSESS',
            drafted: true,
            shipped: false,
            evidence: null,
            review: { verdict: 'pass', reviewer: 'deepseek', at: '2026-07-26' },
          },
          { branch: 'feat/share-loop-week1' },
        ),
      'STOP_AND_REASSESS',
    );
  });

  // The same rail, for the halt that was added later. An identity check against the FIRST
  // directive would have let the second one ship — the standard way a widened system stops
  // covering the case it was widened for.
  it('refuses to ship a GO_MEASURE cycle too', () => {
    expectHardAbort(
      () =>
        enterShip(
          {
            cycle: 5,
            recommendation_id: null,
            directive: 'GO_MEASURE',
            drafted: true,
            shipped: false,
            evidence: null,
            review: { verdict: 'pass', reviewer: 'deepseek', at: '2026-07-26' },
          },
          { branch: 'feat/share-loop-week1' },
        ),
      'GO_MEASURE',
    );
  });

  // The reviewer assumed the halt report drops the flagged section. It does not — assert it, so
  // that stays true.
  it('keeps other findings visible in a halt report', () => {
    const measured = measure(freshState(), measurement());
    const state = {
      ...measured,
      history: [1, 2, 3, 4].map((cycle) => ({
        cycle,
        recommendation_id: 'share-cta-copy',
        directive: null,
        drafted: true,
        shipped: false,
        evidence: null,
        report_path: `ceo/reports/cycle-${cycle}.md`,
        primary_metric: 'wau',
        primary_value: 12,
      })),
    };
    const assessment = assess(state, measurement());
    const decision = decide(state, assessment, [GROWTH_CANDIDATE]);
    const report = draft(state, assessment, decision, measurement());

    expect(decision.halt).toBe(true);
    expect(report).toContain('STOP_AND_REASSESS');
    // Both the halt and the co-occurring theater tax are reported, not just the halt.
    expect(report).toContain('THEATER TAX');
  });

  it('logs a halted cycle with no recommendation id and the directive recorded', () => {
    const state = stalledState();
    const assessment = assess(state, measurement());
    const decision = decide(state, assessment, [GROWTH_CANDIDATE]);
    const next = log(state, decision, {});

    const entry = next.history[next.history.length - 1];
    expect(entry.recommendation_id).toBeNull();
    expect(entry.directive).toBe('STOP_AND_REASSESS');
  });

  it('reads the theater tax into the report without halting', () => {
    // The cycle numbers have to line up with the state's own cycle now that the flat detector sees
    // the FRESH reading too: history 8, 8 then a fresh 12 is real movement, so the only thing
    // wrong here is that nothing shipped — which is a flag, not a halt.
    const measured = measure(freshState(), measurement());
    const state = {
      ...measured,
      cycle: 3,
      history: [1, 2].map((cycle) => ({
        ...flatEntry(cycle, 8),
        shipped: false,
        evidence: null,
      })),
    };
    const assessment = assess(state, measurement());
    const decision = decide(state, assessment, [GROWTH_CANDIDATE]);
    const report = draft(state, assessment, decision, measurement());

    expect(decision.halt).toBe(false);
    expect(report).toContain('## Flagged');
    expect(report).toContain('THEATER TAX');
    // Still recommends — two barren cycles is a smell, not a verdict.
    expect(report).toContain('## Recommendation');
  });
});

describe('runCycle, offline against the fixture', () => {
  let outDir: string;

  beforeEach(() => {
    outDir = mkdtempSync(path.join(tmpdir(), 'ceo-cycle-'));
  });

  afterEach(() => {
    rmSync(outDir, { recursive: true, force: true });
  });

  it('measures, assesses, decides, drafts and logs in one pass', () => {
    const result = runCycle({
      state: freshState(),
      measurement: measurement(),
      candidates: [GROWTH_CANDIDATE, ANALYTICS_CANDIDATE],
      reportsDir: outDir,
    });

    expect(result.state.cycle).toBe(1);
    expect(result.state.history).toHaveLength(1);
    expect(result.record.shipped).toBe(false);
    expect(readFileSync(result.reportPath, 'utf8')).toContain(SELF_AUDIT_LINE);
    expect(path.basename(result.reportPath)).toBe('cycle-1.md');
  });

  it('produces a state that still validates', () => {
    const result = runCycle({
      state: freshState(),
      measurement: measurement(),
      candidates: [GROWTH_CANDIDATE],
      reportsDir: outDir,
    });

    // A second cycle over the first cycle's output must not throw.
    expect(() =>
      runCycle({
        state: result.state,
        measurement: measurement({ at: '2026-08-02' }),
        candidates: [GROWTH_CANDIDATE],
        reportsDir: outDir,
      }),
    ).not.toThrow();
  });

  it('is deterministic — no ambient clock, same input same report', () => {
    const first = runCycle({
      state: freshState(),
      measurement: measurement(),
      candidates: [GROWTH_CANDIDATE],
      reportsDir: outDir,
    });
    const second = runCycle({
      state: freshState(),
      measurement: measurement(),
      candidates: [GROWTH_CANDIDATE],
      reportsDir: outDir,
    });

    expect(first.report).toBe(second.report);
  });

  it('never ships on its own — shipping stays a separate reviewed step', () => {
    const result = runCycle({
      state: freshState(),
      measurement: measurement(),
      candidates: [ANALYTICS_CANDIDATE],
      reportsDir: outDir,
    });

    expect(result.state.history[0].shipped).toBe(false);
    expectHardAbort(
      () => enterShip(result.record, { branch: 'feat/share-loop-week1' }),
      'REVIEW',
    );
  });
});
