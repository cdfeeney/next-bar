import { describe, expect, it } from 'vitest';
import {
  DIRECTIVE_GO_MEASURE,
  DIRECTIVE_STOP_AND_REASSESS,
  countsAsProgress,
  detectBetClosure,
  detectFlatMetricHalt,
  detectTheaterTax,
  evidenceIsReal,
  runDetectors,
} from '../scripts/ceo-detectors.mjs';

/** The repository this state is about. A sha from anywhere else proves nothing about it. */
const REPO = 'cdfeeney/next-bar';
const scope = { repo: REPO };

/**
 * Synthetic history. Defaults describe the ordinary case — a cycle that drafted a plan, shipped
 * it, and can prove it — so each test overrides only the thing it is actually about.
 */
function cycleEntry(overrides = {}) {
  return {
    cycle: 1,
    recommendation_id: 'some-bet',
    drafted: true,
    shipped: true,
    evidence: { kind: 'pr_sha', repo: REPO, ref: 'a1b2c3d', class: 'user_facing' },
    report_path: 'ceo/reports/cycle-1.md',
    primary_metric: 'wau',
    primary_value: 10,
    directive: null,
    ...overrides,
  };
}

function history(...entries: Array<Record<string, unknown>>) {
  return entries.map((overrides, index) =>
    cycleEntry({ cycle: index + 1, ...overrides }),
  );
}

describe('evidence rule', () => {
  it('accepts a plausible PR sha in the right repo', () => {
    expect(
      evidenceIsReal({ kind: 'pr_sha', repo: REPO, ref: 'a1b2c3d', class: 'user_facing' }, scope),
    ).toBe(true);
    expect(
      evidenceIsReal(
        { kind: 'pr_sha', repo: REPO, ref: '5393a90f1e2d3c4b5a6978899aabbccddeeff001', class: 'chore' },
        scope,
      ),
    ).toBe(true);
  });

  it('accepts a real user-event id', () => {
    expect(evidenceIsReal({ kind: 'user_event', ref: 'evt_01HZX9' }, scope)).toBe(true);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a bare string', 'shipped it'],
    ['a number', 42],
    ['an array', []],
    ['an empty object', {}],
    ['a sha that is too short', { kind: 'pr_sha', repo: REPO, ref: 'a1b', class: 'user_facing' }],
    ['a sha that is not hex', { kind: 'pr_sha', repo: REPO, ref: 'zzzzzzz', class: 'user_facing' }],
    ['a sha longer than a sha', { kind: 'pr_sha', repo: REPO, ref: 'a'.repeat(41), class: 'user_facing' }],
    ['a stubby event id', { kind: 'user_event', ref: 'evt' }],
    ['a whitespace event id', { kind: 'user_event', ref: '          ' }],
    ['an invented kind', { kind: 'vibes', ref: 'it felt like it worked' }],
    ['a kind with no ref', { kind: 'pr_sha', repo: REPO, class: 'user_facing' }],
    ['prose where a ref belongs', { kind: 'user_event', ref: 12345 }],
    // The sha is real, the work is real, and neither is this project's.
    ['a sha from another repository', { kind: 'pr_sha', repo: 'cdfeeney/scratch', ref: 'a1b2c3d', class: 'user_facing' }],
    ['a sha that names no repository', { kind: 'pr_sha', ref: 'a1b2c3d', class: 'user_facing' }],
    ['a sha that says nothing about what it was', { kind: 'pr_sha', repo: REPO, ref: 'a1b2c3d' }],
    ['a sha with an invented class', { kind: 'pr_sha', repo: REPO, ref: 'a1b2c3d', class: 'important' }],
  ])('rejects %s', (_label, evidence) => {
    expect(evidenceIsReal(evidence, scope)).toBe(false);
  });

  it('rejects an otherwise-perfect sha when no repository is configured', () => {
    // Fail closed. An unscoped sha is the exact thing the repo field was added to reject.
    expect(
      evidenceIsReal({ kind: 'pr_sha', repo: REPO, ref: 'a1b2c3d', class: 'user_facing' }, {}),
    ).toBe(false);
  });

  it('counts a shipped, evidenced cycle as progress', () => {
    expect(countsAsProgress(cycleEntry(), scope)).toBe(true);
  });

  it('does not count a shipped cycle with no evidence as progress', () => {
    // The whole point: "we shipped it" is a claim, not a result.
    expect(countsAsProgress(cycleEntry({ evidence: null }), scope)).toBe(false);
  });

  it('does not count a merged chore as progress', () => {
    // A chore is real work with a real sha. It is not movement on the objective, and letting it
    // count means twenty housekeeping PRs read as twenty cycles of progress.
    const chore = cycleEntry({
      evidence: { kind: 'pr_sha', repo: REPO, ref: 'a1b2c3d', class: 'chore' },
    });

    expect(evidenceIsReal(chore.evidence, scope)).toBe(true);
    expect(countsAsProgress(chore, scope)).toBe(false);
  });

  it('does not count a drafted-but-unshipped cycle as progress', () => {
    expect(countsAsProgress(cycleEntry({ shipped: false }), scope)).toBe(false);
  });

  it('does not count an unshipped cycle even when it carries evidence', () => {
    expect(countsAsProgress(cycleEntry({ shipped: false }), scope)).toBe(false);
  });
});

describe('theater tax', () => {
  it('flags two consecutive cycles that drafted and did not ship', () => {
    const result = detectTheaterTax(
      history({ shipped: false }, { shipped: false }),
      scope,
    );

    expect(result.flagged).toBe(true);
    expect(result.detail).toMatch(/drafted/i);
  });

  it('does not flag a single unshipped cycle', () => {
    const result = detectTheaterTax(history({ shipped: true }, { shipped: false }), scope);

    expect(result.flagged).toBe(false);
  });

  it('does not flag when the most recent cycle shipped', () => {
    // The streak has to be current. A cycle that shipped clears the tax.
    const result = detectTheaterTax(
      history({ shipped: false }, { shipped: false }, { shipped: true }),
      scope,
    );

    expect(result.flagged).toBe(false);
  });

  it('does not flag an empty history', () => {
    expect(detectTheaterTax([], scope).flagged).toBe(false);
  });

  it('treats a shipped cycle with no real evidence as not shipped', () => {
    // Otherwise the tax is dodged by writing shipped: true and nothing else.
    const result = detectTheaterTax(
      history({ shipped: true, evidence: null }, { shipped: true, evidence: null }),
      scope,
    );

    expect(result.flagged).toBe(true);
  });

  // Review finding C2. Requiring `drafted === true` meant the cheapest evasion was to do LESS:
  // a cycle that produced no plan at all broke the barren streak and cleared the tax.
  it('flags cycles that produced nothing at all, not just plans that went unshipped', () => {
    const result = detectTheaterTax(
      history(
        { drafted: false, shipped: false, evidence: null, report_path: null },
        { drafted: false, shipped: false, evidence: null, report_path: null },
      ),
      scope,
    );

    expect(result.flagged).toBe(true);
  });

  it('flags a mix of an unshipped plan and a cycle that did nothing', () => {
    const result = detectTheaterTax(
      history(
        { drafted: true, shipped: false, evidence: null },
        { drafted: false, shipped: false, evidence: null },
      ),
      scope,
    );

    expect(result.flagged).toBe(true);
  });
});

describe('flat-metric halt', () => {
  it('emits STOP_AND_REASSESS after two flat cycles', () => {
    const result = detectFlatMetricHalt(
      history(
        { primary_value: 10 },
        { primary_value: 10 },
        { primary_value: 10 },
        { primary_value: 10 },
      ),
    );

    expect(result.halt).toBe(true);
    expect(result.directive).toBe(DIRECTIVE_STOP_AND_REASSESS);
  });

  it('emits STOP_AND_REASSESS after two declining cycles', () => {
    const result = detectFlatMetricHalt(
      history(
        { primary_value: 40 },
        { primary_value: 30 },
        { primary_value: 20 },
        { primary_value: 10 },
      ),
    );

    expect(result.halt).toBe(true);
  });

  it('does not halt when the metric is climbing', () => {
    const result = detectFlatMetricHalt(
      history(
        { primary_value: 10 },
        { primary_value: 14 },
        { primary_value: 19 },
        { primary_value: 25 },
      ),
    );

    expect(result.halt).toBe(false);
    expect(result.directive).toBeNull();
  });

  it('does not halt when one of the three moved', () => {
    const result = detectFlatMetricHalt(
      history(
        { primary_value: 10 },
        { primary_value: 10 },
        { primary_value: 18 },
        { primary_value: 18 },
      ),
    );

    expect(result.halt).toBe(false);
  });

  it('does not halt before there is enough history to judge', () => {
    const result = detectFlatMetricHalt(
      history({ primary_value: 10 }, { primary_value: 10 }),
    );

    expect(result.halt).toBe(false);
    expect(result.detail).toMatch(/not enough history/i);
  });

  it('halts on an unmeasurable window, and says the remedy is to measure', () => {
    const result = detectFlatMetricHalt(
      history(
        { primary_value: null },
        { primary_value: null },
        { primary_value: null },
        { primary_value: null },
      ),
    );

    expect(result.halt).toBe(true);
    expect(result.unmeasured).toBe(true);
    expect(result.directive).toBe(DIRECTIVE_GO_MEASURE);
    expect(result.detail).toMatch(/instrumentation/i);
  });

  it('emits STOP_AND_REASSESS when the window holds even one real reading that did not move', () => {
    // One readable cycle is enough to make this a judgement about the plans rather than about
    // the instrumentation, and the two have opposite remedies.
    const result = detectFlatMetricHalt(
      history({ primary_value: 10 }, { primary_value: 10 }, { primary_value: null }),
    );

    expect(result.halt).toBe(true);
    expect(result.unmeasured).toBe(false);
    expect(result.directive).toBe(DIRECTIVE_STOP_AND_REASSESS);
  });

  // Review finding H2. A delta must span exactly one cycle. Without the check, skipping a cycle
  // in the log turns a two-cycle drift into one apparent gain, so PACING THE LOGGING becomes a way
  // to manufacture improvement out of a stall.
  it('does not read a gap in the cycle numbers as improvement', () => {
    const gapped = [
      { cycle: 1, primary_value: 12 },
      { cycle: 2, primary_value: 12 },
      { cycle: 3, primary_value: 12 },
      { cycle: 5, primary_value: 20 }, // cycle 4 never logged
    ].map((overrides) => cycleEntry(overrides));

    const result = detectFlatMetricHalt(gapped);

    expect(result.deltas).toEqual([0, null]);
    expect(result.halt).toBe(true);
  });

  it('still reads consecutive cycles as real movement', () => {
    const consecutive = [
      { cycle: 1, primary_value: 12 },
      { cycle: 2, primary_value: 12 },
      { cycle: 3, primary_value: 12 },
      { cycle: 4, primary_value: 20 },
    ].map((overrides) => cycleEntry(overrides));

    const result = detectFlatMetricHalt(consecutive);

    expect(result.deltas).toEqual([0, 8]);
    expect(result.halt).toBe(false);
  });

  it('halts when improvement cannot be demonstrated because measurement lapsed', () => {
    const result = detectFlatMetricHalt(
      history(
        { primary_value: 10 },
        { primary_value: null },
        { primary_value: null },
        { primary_value: 40 },
      ),
    );

    expect(result.halt).toBe(true);
  });
});

describe('bet closure', () => {
  const bet = (overrides = {}) => ({
    id: 'bet-share-cta',
    claim: 'Rewriting the CTA lifts WAU by 6.',
    review_cycle: 3,
    verdict: null,
    ...overrides,
  });

  it('blocks when a bet has passed its review cycle unjudged', () => {
    const result = detectBetClosure([bet()], 4);

    expect(result.blocking).toBe(true);
    expect(result.overdue).toEqual(['bet-share-cta']);
  });

  it('does not block before the review cycle arrives', () => {
    expect(detectBetClosure([bet()], 2).blocking).toBe(false);
  });

  it('does not block on the review cycle itself — that is when it gets judged', () => {
    expect(detectBetClosure([bet()], 3).blocking).toBe(false);
  });

  it.each(['hit', 'miss'])('does not block once the verdict is %s', (verdict) => {
    expect(detectBetClosure([bet({ verdict })], 9).blocking).toBe(false);
  });

  it.each([
    ['pending', 'pending'],
    ['partial', 'partial'],
    ['an empty string', ''],
    ['a null', null],
  ])('blocks on a non-verdict: %s', (_label, verdict) => {
    expect(detectBetClosure([bet({ verdict })], 9).blocking).toBe(true);
  });

  it('does not block on an empty bet list', () => {
    expect(detectBetClosure([], 9).blocking).toBe(false);
  });

  it('names every overdue bet, not just the first', () => {
    const result = detectBetClosure(
      [bet(), bet({ id: 'bet-venue-tour', review_cycle: 2 })],
      5,
    );

    expect(result.overdue).toEqual(['bet-share-cta', 'bet-venue-tour']);
  });
});

describe('runDetectors', () => {
  const state = (overrides = {}) => ({
    cycle: 5,
    repo: REPO,
    history: [],
    active_bets: [],
    ...overrides,
  });

  it('is quiet on a healthy record', () => {
    const result = runDetectors(
      state({
        history: history(
          { primary_value: 10 },
          { primary_value: 20 },
          { primary_value: 30 },
          { primary_value: 40 },
        ),
      }),
    );

    expect(result.halt).toBe(false);
    expect(result.directive).toBeNull();
    expect(result.preamble).toEqual([]);
  });

  it('halts on a flat metric', () => {
    const result = runDetectors(
      state({
        history: history(
          { primary_value: 10 },
          { primary_value: 10 },
          { primary_value: 10 },
          { primary_value: 10 },
        ),
      }),
    );

    expect(result.halt).toBe(true);
    expect(result.directive).toBe(DIRECTIVE_STOP_AND_REASSESS);
  });

  it('carries GO_MEASURE up when the only halt is an unmeasured window', () => {
    const result = runDetectors(
      state({
        history: history(
          { primary_value: null },
          { primary_value: null },
          { primary_value: null },
        ),
      }),
    );

    expect(result.halt).toBe(true);
    expect(result.directive).toBe(DIRECTIVE_GO_MEASURE);
  });

  it('prefers STOP_AND_REASSESS when an unclosed bet halts alongside an unmeasured window', () => {
    // Two problems, and the harder one wins: an unjudged bet is not fixed by instrumentation.
    const result = runDetectors(
      state({
        active_bets: [{ id: 'bet-a', claim: 'c', review_cycle: 2, verdict: null }],
        history: history(
          { primary_value: null },
          { primary_value: null },
          { primary_value: null },
        ),
      }),
    );

    expect(result.directive).toBe(DIRECTIVE_STOP_AND_REASSESS);
  });

  it('halts on an unclosed overdue bet', () => {
    const result = runDetectors(
      state({ active_bets: [{ id: 'bet-a', claim: 'c', review_cycle: 2, verdict: null }] }),
    );

    expect(result.halt).toBe(true);
  });

  it('carries the theater tax into the preamble without halting', () => {
    const result = runDetectors(
      state({ history: history({ shipped: false }, { shipped: false }) }),
    );

    expect(result.halt).toBe(false);
    expect(result.preamble).toHaveLength(1);
    expect(result.preamble[0]).toMatch(/drafted/i);
  });

  it('reports every finding it ran, flagged or not', () => {
    const result = runDetectors(state());

    expect(result.findings.map((finding) => finding.id).sort()).toEqual([
      'bet_closure',
      'dormant_module_ready',
      'flat_metric_halt',
      'theater_tax',
    ]);
  });

  it('carries a woken dormant module into the preamble without halting', () => {
    const result = runDetectors(
      state({
        modules: { growth: 'active', tech: 'active', venue_sales: 'dormant', hiring: 'dormant', finance: 'dormant', exit: 'dormant' },
        metrics: { revenue: 250 },
      }),
    );

    expect(result.halt).toBe(false);
    expect(result.preamble.join(' ')).toContain('finance');
  });

  it('tolerates a state with no history or bets at all', () => {
    expect(() => runDetectors({ cycle: 0 })).not.toThrow();
    expect(runDetectors({ cycle: 0 }).halt).toBe(false);
  });
});
