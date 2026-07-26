import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PLAYBOOK,
  SEQUENCE,
  assertCandidateInSequence,
  assertCandidatesInSequence,
  currentStep,
  proposeCandidates,
  renderProposal,
} from '../scripts/ceo-growth.mjs';

class ProcessExit extends Error {
  constructor(readonly code: string | number | null | undefined) {
    super('process.exit(' + String(code) + ')');
  }
}

let exitSpy: ReturnType<typeof vi.spyOn>;
let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

function expectHardAbort(action: () => void) {
  expect(action).toThrow(ProcessExit);
  expect(exitSpy).toHaveBeenCalledWith(1);
  expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Aborting.'));
}

beforeEach(() => {
  exitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null): never => {
    throw new ProcessExit(code);
  });
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Metrics only — the sequence reads nothing else. */
function state(metrics: Record<string, number | null> = {}) {
  return {
    metrics: {
      wau: null,
      max_neighborhood_wau: null,
      claimed_venues: 0,
      self_maintaining_venues: 0,
      venue_active_maintainers: 0,
      user_interviews_this_week: 1,
      revenue: 0,
      operator_hours_available: 8,
      ...metrics,
    },
  };
}

describe('the sequence', () => {
  it('starts at the first claims, which is where the operator actually is today', () => {
    expect(currentStep(state())?.id).toBe('first_claims');
  });

  it('moves to restoring measurement once five venues have claimed', () => {
    expect(currentStep(state({ claimed_venues: 5 }))?.id).toBe('restore_measurement');
  });

  it('moves to self-maintenance once the metrics are readable', () => {
    expect(
      currentStep(state({ claimed_venues: 5, wau: 30, max_neighborhood_wau: 12 }))?.id,
    ).toBe('venues_self_maintain');
  });

  it('ends at neighbourhood users, the side the kill criterion tests', () => {
    expect(
      currentStep(
        state({ claimed_venues: 9, wau: 30, max_neighborhood_wau: 12, venue_active_maintainers: 6 }),
      )?.id,
    ).toBe('neighborhood_users');
  });

  it('is complete when the last boundary is crossed', () => {
    expect(
      currentStep(
        state({ claimed_venues: 9, wau: 80, max_neighborhood_wau: 60, venue_active_maintainers: 6 }),
      ),
    ).toBeNull();
  });

  it('goes BACK when an earlier step regresses', () => {
    // Five venues that stopped maintaining their listings is a step-three problem however many
    // users arrived. "Furthest along" would let a regression scroll past.
    const regressed = state({
      claimed_venues: 9,
      wau: 80,
      max_neighborhood_wau: 60,
      venue_active_maintainers: 1,
    });

    expect(currentStep(regressed)?.id).toBe('venues_self_maintain');
  });

  it('every step boundary is something a person could check without asking the orchestrator', () => {
    // Not necessarily a number — "both metrics readable" is objectively checkable too. What matters
    // is that the answer comes from the metrics and not from anyone's judgement of readiness.
    for (const step of SEQUENCE) {
      expect(typeof step.satisfied).toBe('function');
      expect(typeof step.satisfied(state())).toBe('boolean');
      expect(step.boundary.length).toBeGreaterThan(5);
      // A predicate that ignores the metrics entirely would be a mood, not a boundary.
      expect(step.satisfied({})).toBe(false);
    }
  });
});

describe('proposals', () => {
  it('proposes only the current step, and prices every candidate in operator hours', () => {
    const proposal = proposeCandidates(state());

    expect(proposal.step).toBe('first_claims');
    expect(proposal.candidates.length).toBeGreaterThan(0);
    for (const candidate of proposal.candidates) {
      expect(candidate.step).toBe('first_claims');
      expect(candidate.operator_hours).toBeGreaterThan(0);
      expect(candidate.expected_lift.metric).toBeTruthy();
      expect(candidate.rationale.length).toBeGreaterThan(20);
    }
  });

  it('is deterministic — same state in, same proposal out', () => {
    expect(renderProposal(state())).toEqual(renderProposal(state()));
  });

  it('proposes the analytics work only once claims are done', () => {
    // The operator's decision doc puts in-person claims ahead of instrumentation. This is the line
    // where that ordering becomes machine-enforced rather than aspirational.
    const early = proposeCandidates(state()).candidates.map((c) => c.id);
    const later = proposeCandidates(state({ claimed_venues: 5 })).candidates.map((c) => c.id);

    expect(early).not.toContain('share-funnel-analytics');
    expect(later).toContain('share-funnel-analytics');
  });

  it('says so plainly when the sequence is complete rather than inventing work', () => {
    const done = proposeCandidates(
      state({ claimed_venues: 9, wau: 80, max_neighborhood_wau: 60, venue_active_maintainers: 6 }),
    );

    expect(done.candidates).toEqual([]);
    expect(done.detail).toMatch(/write a new one/i);
  });

  it('carries the separate-doors warning into the file it writes', () => {
    const proposal = renderProposal(state());
    expect(proposal._comment).toMatch(/does NOT report the numbers/i);
    expect(proposal._comment).toMatch(/jumps the sequence/i);
  });

  it('every playbook entry is shaped like a candidate the cycle can rank', () => {
    for (const [stepId, candidates] of Object.entries(PLAYBOOK)) {
      expect(SEQUENCE.map((s) => s.id)).toContain(stepId);
      for (const candidate of candidates) {
        expect(candidate.id).toMatch(/^[a-z0-9-]+$/);
        expect(typeof candidate.restores_measurement).toBe('boolean');
        expect(Number.isFinite(candidate.expected_lift.delta)).toBe(true);
      }
    }
  });
});

describe('work that jumps the queue is refused', () => {
  const jumper = {
    id: 'recipient-vote-before-signup',
    step: 'neighborhood_users',
    statement: 'Let a signed-out recipient vote.',
    expected_lift: { metric: 'max_neighborhood_wau', delta: 9, unit: 'users' },
    operator_hours: 6,
    restores_measurement: false,
    rationale: 'The vote is the onboarding.',
  };

  it('refuses a later step while an earlier one is unsatisfied', () => {
    // The failure mode is not a shortage of ideas. It is doing step four on a Saturday because it
    // is more interesting than step two — and step four is genuinely useful work, which is exactly
    // what makes it so easy to justify.
    expectHardAbort(() => assertCandidateInSequence(jumper, state()));
  });

  it('names the boundary that has to be crossed first', () => {
    expectHardAbort(() => assertCandidateInSequence(jumper, state()));
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('5 claimed venues'));
  });

  it('allows the current step', () => {
    expect(() =>
      assertCandidateInSequence({ ...jumper, step: 'first_claims' }, state()),
    ).not.toThrow();
  });

  it('allows an EARLIER step — a regression is exactly when you should go back', () => {
    const advanced = state({ claimed_venues: 5, wau: 30, max_neighborhood_wau: 12 });
    expect(() =>
      assertCandidateInSequence({ ...jumper, step: 'first_claims' }, advanced),
    ).not.toThrow();
  });

  it('refuses a candidate that names no step at all', () => {
    const { step, ...stepless } = jumper;
    expectHardAbort(() => assertCandidateInSequence(stepless, state()));
  });

  it('refuses an invented step', () => {
    expectHardAbort(() => assertCandidateInSequence({ ...jumper, step: 'growth_hacking' }, state()));
  });

  it('gates a whole proposal, not just the first entry', () => {
    expectHardAbort(() =>
      assertCandidatesInSequence(
        [{ ...jumper, step: 'first_claims' }, jumper],
        state(),
      ),
    );
  });

  it('refuses an empty proposal', () => {
    expectHardAbort(() => assertCandidatesInSequence([], state()));
  });

  it('accepts everything it proposes itself', () => {
    // The generator must not be able to author work its own rail would refuse.
    const stages: Array<Record<string, number | null>> = [
      {},
      { claimed_venues: 5 },
      { claimed_venues: 5, wau: 30, max_neighborhood_wau: 12 },
      { claimed_venues: 9, wau: 30, max_neighborhood_wau: 12, venue_active_maintainers: 6 },
    ];
    for (const metrics of stages) {
      const s = state(metrics);
      expect(() => assertCandidatesInSequence(proposeCandidates(s).candidates, s)).not.toThrow();
    }
  });
});
