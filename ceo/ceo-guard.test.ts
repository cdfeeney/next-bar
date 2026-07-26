import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ALLOWED,
  CAPABILITIES,
  CeoGuardAbort,
  PROTECTED_BRANCHES,
  UNATTENDED_WITHDRAWN,
  assertActionAllowed,
  assertMeasurementUpdate,
  assertStateMutationAllowed,
} from '../scripts/ceo-guard.mjs';
import state from './state.json';

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
  expect(consoleErrorSpy).toHaveBeenCalledWith(
    expect.stringContaining('Aborting.'),
  );
}

function unattended() {
  vi.stubEnv('LOOP_UNATTENDED', '1');
}

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

describe('allowlist: the phrasing-bypass class is closed', () => {
  // Security review CRITICAL 1. Every one of these evaded the previous denylist under
  // LOOP_UNATTENDED=1. Under an allowlist they abort because they are simply not listed —
  // no synonym table required, and a NEW invented verb fails the same way.
  const BYPASS_ATTEMPTS = [
    'notify', 'publish', 'tweet', 'slack_message', 'webhook', 'mailto', 'push_notification',
    'direct_message', 'sending_email', 'posting_update',
    'sql_exec', 'alter_table', 'create_table', 'rename_column', 'migrating_schema_now',
    'release', 'promote', 'rollout', 'ship_to_prod', 'go_live', 'deploying_hotfix',
    'rm_rf', 'deleting_rows', 'drop_table',
    'terraform_apply', 'aws_create_bucket', 'provision_ec2_instance',
    'force_push', 'git_push_origin_main', 'merge_to_main', 'restore_backup', 'seed_database',
  ];

  for (const action of BYPASS_ATTEMPTS) {
    it(`aborts "${action}" even with a legitimate capability`, () => {
      unattended();
      expectHardAbort(() =>
        assertActionAllowed({ capability: CAPABILITIES.MUTATE_BRANCH, action }),
      );
    });
  }

  it('aborts an unlisted action even when ATTENDED', () => {
    expectHardAbort(() =>
      assertActionAllowed({ capability: CAPABILITIES.MUTATE_PROD, action: 'release' }),
    );
  });
});

describe('capability gating', () => {
  it('aborts CONTACT_EXTERNAL unconditionally (no LOOP_UNATTENDED needed)', () => {
    expectHardAbort(() =>
      assertActionAllowed({ capability: CAPABILITIES.CONTACT_EXTERNAL, action: 'write_draft' }),
    );
  });

  it('aborts SPEND unconditionally', () => {
    expectHardAbort(() =>
      assertActionAllowed({ capability: CAPABILITIES.SPEND, action: 'write_draft' }),
    );
  });

  it('aborts an unknown capability tag (fail closed)', () => {
    expectHardAbort(() =>
      assertActionAllowed({ capability: 'NEW_UNREVIEWED_CAPABILITY', action: 'read_repo' }),
    );
  });

  it('aborts a missing capability tag', () => {
    expectHardAbort(() => assertActionAllowed({ action: 'read_repo' }));
  });

  it('aborts an action valid for a DIFFERENT capability (no cross-grant)', () => {
    // `deploy` is real, but only under MUTATE_PROD. Carrying it on RESEARCH must not work.
    expectHardAbort(() =>
      assertActionAllowed({ capability: CAPABILITIES.RESEARCH, action: 'deploy' }),
    );
  });

  it('permits a listed action under its own capability', () => {
    expect(() =>
      assertActionAllowed({ capability: CAPABILITIES.RESEARCH, action: 'read_repo' }),
    ).not.toThrow();
    expect(exitSpy).not.toHaveBeenCalled();
  });
});

describe('unattended withdrawal', () => {
  for (const action of UNATTENDED_WITHDRAWN) {
    it(`withdraws ${action} under LOOP_UNATTENDED=1`, () => {
      unattended();
      expectHardAbort(() =>
        assertActionAllowed({
          capability: CAPABILITIES.MUTATE_PROD,
          action,
          branch: 'feat/x',
        }),
      );
    });

    it(`permits ${action} when attended`, () => {
      expect(() =>
        assertActionAllowed({
          capability: CAPABILITIES.MUTATE_PROD,
          action,
          branch: 'feat/x',
        }),
      ).not.toThrow();
    });
  }
});

describe('protected branches (review CRITICAL 3)', () => {
  for (const branch of PROTECTED_BRANCHES) {
    it(`aborts commit_to_branch targeting "${branch}"`, () => {
      expectHardAbort(() =>
        assertActionAllowed({
          capability: CAPABILITIES.MUTATE_BRANCH,
          action: 'commit_to_branch',
          branch,
        }),
      );
    });
  }

  it('aborts refs/heads/main (normalised, not smuggled past)', () => {
    expectHardAbort(() =>
      assertActionAllowed({
        capability: CAPABILITIES.MUTATE_BRANCH,
        action: 'commit_to_branch',
        branch: 'refs/heads/main',
      }),
    );
  });

  it('aborts MAIN in any casing', () => {
    expectHardAbort(() =>
      assertActionAllowed({
        capability: CAPABILITIES.MUTATE_BRANCH,
        action: 'commit_to_branch',
        branch: 'MAIN',
      }),
    );
  });

  it('aborts a branch-scoped action with a MISSING branch (was fail-open)', () => {
    expectHardAbort(() =>
      assertActionAllowed({
        capability: CAPABILITIES.MUTATE_BRANCH,
        action: 'commit_to_branch',
      }),
    );
  });

  it('aborts a branch-scoped action with a blank branch', () => {
    expectHardAbort(() =>
      assertActionAllowed({
        capability: CAPABILITIES.MUTATE_BRANCH,
        action: 'commit_to_branch',
        branch: '   ',
      }),
    );
  });

  it('permits a feature branch', () => {
    expect(() =>
      assertActionAllowed({
        capability: CAPABILITIES.MUTATE_BRANCH,
        action: 'commit_to_branch',
        branch: 'feat/share-loop',
      }),
    ).not.toThrow();
  });
});

describe('abort survives a stubbed process.exit (review CRITICAL 2)', () => {
  it('throws CeoGuardAbort when process.exit is a no-op', () => {
    // A long-running agent harness may neuter process.exit so one bad step does not kill the
    // host. The old guard then FELL THROUGH and the caller performed the forbidden action.
    exitSpy.mockImplementation((): never => undefined as never);
    expect(() =>
      assertActionAllowed({ capability: CAPABILITIES.SPEND, action: 'write_draft' }),
    ).toThrow(CeoGuardAbort);
  });
});

describe('agent state write path', () => {
  it('aborts a changed kill_criterion deadline', () => {
    const next = structuredClone(state);
    next.kill_criterion.deadline = '2027-01-01';
    expectHardAbort(() => assertStateMutationAllowed(state, next));
  });

  it('aborts a changed wau_threshold', () => {
    const next = structuredClone(state);
    next.kill_criterion.wau_threshold += 1;
    expectHardAbort(() => assertStateMutationAllowed(state, next));
  });

  it('aborts a changed objective', () => {
    const next = structuredClone(state) as any;
    next.objective = 'a_different_objective';
    expectHardAbort(() => assertStateMutationAllowed(state, next));
  });

  it('aborts self-activating a dormant module (review HIGH 4)', () => {
    const next = structuredClone(state) as any;
    next.modules.exit = 'active';
    expectHardAbort(() => assertStateMutationAllowed(state, next));
  });

  it('aborts inflating metrics.wau — the kill-switch side door', () => {
    // Nothing here touches kill_criterion, yet it would make the criterion untrippable.
    const next = structuredClone(state) as any;
    next.metrics.wau = 9999;
    expectHardAbort(() => assertStateMutationAllowed(state, next));
  });

  it('aborts a degenerate {} state instead of passing by absence (review HIGH 5)', () => {
    expect(() => assertStateMutationAllowed({} as any, {} as any)).toThrow();
    expect(() => assertStateMutationAllowed(undefined as any, undefined as any)).toThrow();
  });

  it('allows a history/cycle-only update', () => {
    const next = structuredClone(state) as any;
    next.history.push({ cycle: 1, note: 'drafted the share loop' });
    next.cycle = 1;
    expect(() => assertStateMutationAllowed(state, next)).not.toThrow();
    expect(exitSpy).not.toHaveBeenCalled();
  });
});

describe('measurement write path', () => {
  it('allows a metrics-only update', () => {
    const next = structuredClone(state) as any;
    next.metrics.wau = 12;
    next.cycle = 1;
    expect(() => assertMeasurementUpdate(state, next)).not.toThrow();
  });

  it('aborts agent-authored edits smuggled through the measurement door', () => {
    const next = structuredClone(state) as any;
    next.metrics.wau = 12;
    next.modules.hiring = 'active';
    expectHardAbort(() => assertMeasurementUpdate(state, next));
  });

  it('aborts a kill_criterion change on the measurement path too', () => {
    const next = structuredClone(state) as any;
    next.kill_criterion.tripped = true;
    expectHardAbort(() => assertMeasurementUpdate(state, next));
  });
});

describe('allowlist shape', () => {
  it('grants no action at all to the never-granted capabilities', () => {
    expect(ALLOWED.CONTACT_EXTERNAL).toHaveLength(0);
    expect(ALLOWED.SPEND).toHaveLength(0);
  });
});
