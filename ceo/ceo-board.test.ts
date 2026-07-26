import { describe, expect, it } from 'vitest';
import { VERDICTS, auditKill } from '../scripts/ceo-board.mjs';

/**
 * The board's whole job is to be the thing that says KILL when the operator is attached.
 *
 * The criterion it enforces is the operator's own, from
 * decisions/2026-07-25-next-bar-monetization.md:
 *
 *   "kill if BOTH (a) fewer than 50 weekly-active users inside ONE chosen NYC neighborhood
 *    AND (b) fewer than 15 self-maintaining claimed venues. If exactly one passes, do not kill —
 *    re-scope to the side that worked."
 *
 * Two things in that sentence are load-bearing and were previously mis-implemented: the
 * conjunction (BOTH, not either) and WHICH user number is tested (one neighborhood, not the
 * global total).
 */
function state(overrides: Record<string, unknown> = {}) {
  const { metrics: metricOverrides, ...rest } = overrides;
  const metrics = {
    wau: 120,
    max_neighborhood_wau: 60,
    claimed_venues: 20,
    self_maintaining_venues: 20,
    venue_active_maintainers: 20,
    user_interviews_this_week: 1,
    revenue: 0,
    operator_hours_available: 8,
    ...((metricOverrides as Record<string, unknown>) ?? {}),
  };

  return {
    cycle: 1,
    repo: 'cdfeeney/next-bar',
    objective: 'wau_one_neighborhood + self_maintaining_venues',
    bottleneck: 'users',
    metrics,
    active_bets: [],
    kill_criterion: {
      deadline: '2026-12-31',
      wau_threshold: 50,
      venue_threshold: 15,
      tripped: false,
    },
    modules: {
      growth: 'active',
      tech: 'active',
      venue_sales: 'dormant',
      hiring: 'dormant',
      finance: 'dormant',
      exit: 'dormant',
    },
    history: [],
    approval_queue: [],
    ...rest,
  };
}

const AFTER = '2027-01-01';
const BEFORE = '2026-07-26';

describe('kill audit — at the deadline', () => {
  it('KILLs only when BOTH sides fail', () => {
    const result = auditKill(
      state({ metrics: { max_neighborhood_wau: 10, self_maintaining_venues: 2 } }),
      { at: AFTER },
    );

    expect(result.verdict).toBe(VERDICTS.KILL);
    expect(result.sides.users.failed).toBe(true);
    expect(result.sides.venues.failed).toBe(true);
  });

  it('RESCOPEs when the users side fails and the venue side holds', () => {
    // The old assess() ORed the two sides, so this said TRIPPED — reading the operator's
    // "if exactly one passes, do not kill" backwards, in the direction that kills a working half.
    const result = auditKill(
      state({ metrics: { max_neighborhood_wau: 10, self_maintaining_venues: 20 } }),
      { at: AFTER },
    );

    expect(result.verdict).toBe(VERDICTS.RESCOPE);
    expect(result.detail).toMatch(/venues/i);
  });

  it('RESCOPEs when the venue side fails and the users side holds', () => {
    const result = auditKill(
      state({ metrics: { max_neighborhood_wau: 80, self_maintaining_venues: 1 } }),
      { at: AFTER },
    );

    expect(result.verdict).toBe(VERDICTS.RESCOPE);
    expect(result.detail).toMatch(/users/i);
  });

  it('CONTINUEs when both sides clear their thresholds', () => {
    const result = auditKill(state(), { at: AFTER });
    expect(result.verdict).toBe(VERDICTS.CONTINUE);
  });

  it('counts an unmeasured user side as FAILED at the deadline, not as pending', () => {
    // Arriving at the deadline unable to measure is not a pending result; never building
    // analytics must not be indistinguishable from passing.
    const result = auditKill(
      state({ metrics: { wau: null, max_neighborhood_wau: null, self_maintaining_venues: 2 } }),
      { at: AFTER },
    );

    expect(result.verdict).toBe(VERDICTS.KILL);
    expect(result.sides.users.measurable).toBe(false);
    expect(result.sides.users.failed).toBe(true);
  });

  it('tests the NEIGHBOURHOOD number, not the global total', () => {
    // Global wau of 120 clears 50; the chosen neighbourhood does not. The criterion is about one
    // neighbourhood, and testing the global total is a lenient misreading that would let a
    // thinly-spread 18-neighbourhood app pass a criterion it fails.
    const result = auditKill(
      state({ metrics: { wau: 120, max_neighborhood_wau: 10, self_maintaining_venues: 2 } }),
      { at: AFTER },
    );

    expect(result.verdict).toBe(VERDICTS.KILL);
    expect(result.sides.users.value).toBe(10);
  });

  it('treats the deadline day itself as due', () => {
    const result = auditKill(
      state({ metrics: { max_neighborhood_wau: 1, self_maintaining_venues: 1 } }),
      { at: '2026-12-31' },
    );

    expect(result.verdict).toBe(VERDICTS.KILL);
  });
});

describe('kill audit — before the deadline', () => {
  it('CONTINUEs while both sides are measurable and the clock has not run out', () => {
    expect(auditKill(state(), { at: BEFORE }).verdict).toBe(VERDICTS.CONTINUE);
  });

  it('refuses to say CONTINUE while the user side is unmeasured', () => {
    // A green light nobody earned is the failure mode. UNMEASURABLE is a distinct verdict with a
    // distinct remedy: go measure, do not carry on.
    const result = auditKill(
      state({ metrics: { wau: null, max_neighborhood_wau: null } }),
      { at: BEFORE },
    );

    expect(result.verdict).toBe(VERDICTS.UNMEASURABLE);
    expect(result.remedy).toMatch(/measure/i);
  });

  it('does not kill early, however bad the numbers are', () => {
    const result = auditKill(
      state({ metrics: { max_neighborhood_wau: 0, self_maintaining_venues: 0 } }),
      { at: BEFORE },
    );

    expect(result.verdict).toBe(VERDICTS.CONTINUE);
    expect(result.due).toBe(false);
  });
});

describe('kill audit — hostile numbers', () => {
  // Raised in review as a way to slip past the criterion: NaN compares false against every
  // threshold, so a naive `value < threshold` would read NaN as "passing". numberOrNull uses
  // Number.isFinite, so NaN lands in the unmeasured bucket and FAILS, which is what an unreadable
  // number should do at the deadline.
  it.each([
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['a numeric string', '10'],
    ['undefined', undefined],
  ])('treats %s as unmeasured, not as passing', (_label, value) => {
    const result = auditKill(
      state({ metrics: { max_neighborhood_wau: value, self_maintaining_venues: 2 } }),
      { at: AFTER },
    );

    expect(result.sides.users.measurable).toBe(false);
    expect(result.sides.users.failed).toBe(true);
    expect(result.verdict).toBe(VERDICTS.KILL);
  });

  it('does not kill on an unreadable venue count alone', () => {
    // Defensive only — state.schema requires self_maintaining_venues to be a non-negative integer,
    // so measure() aborts before an unreadable one could reach the board. If it ever does, the
    // conservative answer is RESCOPE: an unread number is not evidence the venue side failed.
    const result = auditKill(
      state({ metrics: { max_neighborhood_wau: 80, self_maintaining_venues: null } }),
      { at: AFTER },
    );

    expect(result.verdict).toBe(VERDICTS.RESCOPE);
  });
});

describe('kill audit — inputs', () => {
  it('fails closed when the audit date is missing', () => {
    expect(() => auditKill(state(), { at: null })).toThrow(/date/i);
  });

  it('fails closed when the audit date is not a plain YYYY-MM-DD', () => {
    expect(() => auditKill(state(), { at: '31/12/2026' })).toThrow(/date/i);
  });

  it('reports the thresholds it applied, so a report cannot paraphrase them', () => {
    const result = auditKill(state(), { at: AFTER });

    expect(result.sides.users.threshold).toBe(50);
    expect(result.sides.venues.threshold).toBe(15);
    expect(result.deadline).toBe('2026-12-31');
  });
});

describe('dates that are only shaped like dates', () => {
  // Review finding: shape-only validation let 2026-99-99 into a lexicographic comparison, where it
  // sorts after every real date. One typo either fires the board years early or postpones it
  // forever, and nothing says which.
  it.each(['2026-99-99', '2026-13-01', '2026-02-30', '0000-00-00'])(
    'refuses the impossible audit date %s',
    (bad) => {
      expect(() => auditKill(state(), { at: bad })).toThrow(/calendar date/i);
    },
  );

  it('refuses an impossible deadline in the criterion itself', () => {
    const broken = state({ kill_criterion: { deadline: '2026-99-99', wau_threshold: 50, venue_threshold: 15, tripped: false } });
    expect(() => auditKill(broken, { at: '2026-07-26' })).toThrow(/deadline/i);
  });

  it('still accepts a leap day that exists', () => {
    expect(() => auditKill(state(), { at: '2028-02-29' })).not.toThrow();
  });
});
