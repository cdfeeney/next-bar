import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DORMANT_MODULES,
  MODULES,
  activationTriggerMet,
  assertModuleRunnable,
  detectDormantReadiness,
} from '../scripts/ceo-modules.mjs';
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
  expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Aborting.'));
  if (detail !== undefined) {
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining(detail));
  }
}

function freshState() {
  return structuredClone(baseState);
}

beforeEach(() => {
  exitSpy = vi.spyOn(process, 'exit').mockImplementation(
    (code?: string | number | null): never => {
      throw new ProcessExit(code);
    },
  );
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('every dormant module refuses to run and names its trigger', () => {
  // One test per module, per the spec. These are the four halves of the CEO spec that were
  // "specified but inert" — declared in state.json and backed by nothing.
  const triggers = MODULES as Record<string, { trigger: string }>;

  it.each(DORMANT_MODULES)('%s refuses and names what would wake it', (moduleName) => {
    expectHardAbort(
      () => assertModuleRunnable(freshState(), moduleName),
      triggers[moduleName].trigger,
    );
  });

  it.each(DORMANT_MODULES)('%s says which module refused', (moduleName) => {
    expectHardAbort(() => assertModuleRunnable(freshState(), moduleName), moduleName);
  });

  it('lists exactly the four modules the spec calls dormant', () => {
    expect([...DORMANT_MODULES].sort()).toEqual(['exit', 'finance', 'hiring', 'venue_sales']);
  });
});

describe('active modules run', () => {
  it.each(['growth', 'tech'])('%s does not refuse', (moduleName) => {
    expect(() => assertModuleRunnable(freshState(), moduleName)).not.toThrow();
  });

  it('refuses a module that is not declared at all', () => {
    expectHardAbort(() => assertModuleRunnable(freshState(), 'crypto_treasury'), 'unknown module');
  });

  it('refuses when the state declares no modules', () => {
    // Fail closed: an absent module map is not an all-clear.
    expectHardAbort(() => assertModuleRunnable({ cycle: 0 }, 'growth'), 'growth');
  });

  // Review F3. The refusal used to read only the caller's state.modules, making it exactly as
  // honest as whoever supplied the state — the seam an agent probing for scope would go for.
  it('refuses a dormant module even when the supplied state claims it is active', () => {
    const doctored = freshState();
    doctored.modules.venue_sales = 'active';

    expectHardAbort(() => assertModuleRunnable(doctored, 'venue_sales'), 'dormant');
  });

  it.each(DORMANT_MODULES)('%s cannot be unlocked by a doctored state', (moduleName) => {
    const doctored = freshState();
    (doctored.modules as Record<string, string>)[moduleName] = 'active';

    expectHardAbort(() => assertModuleRunnable(doctored, moduleName));
  });

  it('still refuses a dormant module even once its trigger is met', () => {
    // `modules` is guard-protected — the orchestrator may not flip its own scope. A met trigger
    // is a message to the operator, never a self-grant.
    const state = freshState();
    state.metrics.revenue = 500;

    expect(activationTriggerMet(state, 'finance')).toBe(true);
    expectHardAbort(() => assertModuleRunnable(state, 'finance'));
  });
});

describe('activation triggers', () => {
  it('venue_sales wakes when venues start claiming pages on their own', () => {
    const state = freshState();
    expect(activationTriggerMet(state, 'venue_sales')).toBe(false);

    state.metrics.claimed_venues = 5;
    expect(activationTriggerMet(state, 'venue_sales')).toBe(true);
  });

  it('hiring wakes when the operator has no hours left to give', () => {
    const state = freshState();
    expect(activationTriggerMet(state, 'hiring')).toBe(false);

    state.metrics.operator_hours_available = 0;
    expect(activationTriggerMet(state, 'hiring')).toBe(true);
  });

  // Review F2. `=== 0` went quiet exactly as an over-committed operator got worse.
  it('hiring stays awake when the operator is over-committed past zero', () => {
    const state = freshState();
    state.metrics.operator_hours_available = -6;

    expect(activationTriggerMet(state, 'hiring')).toBe(true);
  });

  it('finance wakes when there is money to manage', () => {
    const state = freshState();
    expect(activationTriggerMet(state, 'finance')).toBe(false);

    state.metrics.revenue = 0.01;
    expect(activationTriggerMet(state, 'finance')).toBe(true);
  });

  it('exit wakes when the operator trips the kill criterion by hand', () => {
    const state = freshState();
    expect(activationTriggerMet(state, 'exit')).toBe(false);

    state.kill_criterion.tripped = true;
    expect(activationTriggerMet(state, 'exit')).toBe(true);
  });

  // Review F1, and worse than the reviewer put it: `state.kill_criterion.tripped` is written by
  // NOTHING. assess() computes the trip fresh every cycle but cannot persist it — kill_criterion
  // is agent-protected and the measurement path admits only metrics/cycle. Reading only the stored
  // flag pinned this trigger to false forever, on the one module where being late costs most.
  it('exit wakes on the freshly computed trip, not just the stored flag', () => {
    const state = freshState();
    expect(state.kill_criterion.tripped).toBe(false);

    expect(
      activationTriggerMet(state, 'exit', { assessment: { kill: { tripped: true } } }),
    ).toBe(true);
  });

  it('exit stays asleep when the computed assessment says not tripped', () => {
    expect(
      activationTriggerMet(freshState(), 'exit', { assessment: { kill: { tripped: false } } }),
    ).toBe(false);
  });

  it('reports false rather than throwing on a state with no metrics', () => {
    expect(activationTriggerMet({ cycle: 0 }, 'finance')).toBe(false);
  });

  it('reports false for an unknown module', () => {
    expect(activationTriggerMet(freshState(), 'crypto_treasury')).toBe(false);
  });
});

describe('detectDormantReadiness', () => {
  it('is quiet while nothing has woken', () => {
    const result = detectDormantReadiness(freshState());

    expect(result.id).toBe('dormant_module_ready');
    expect(result.flagged).toBe(false);
    expect(result.ready).toEqual([]);
  });

  it('names a dormant module whose trigger has been met', () => {
    const state = freshState();
    state.metrics.revenue = 250;

    const result = detectDormantReadiness(state);

    expect(result.flagged).toBe(true);
    expect(result.ready).toEqual(['finance']);
    expect(result.detail).toContain('finance');
  });

  it('names every ready module, not just the first', () => {
    const state = freshState();
    state.metrics.revenue = 250;
    state.metrics.claimed_venues = 9;

    expect(detectDormantReadiness(state).ready.sort()).toEqual(['finance', 'venue_sales']);
  });

  it('ignores modules the operator has already activated', () => {
    const state = freshState();
    state.metrics.revenue = 250;
    state.modules.finance = 'active';

    expect(detectDormantReadiness(state).flagged).toBe(false);
  });

  it('tolerates a state with no modules at all', () => {
    expect(() => detectDormantReadiness({ cycle: 0 })).not.toThrow();
    expect(detectDormantReadiness({ cycle: 0 }).flagged).toBe(false);
  });
});
