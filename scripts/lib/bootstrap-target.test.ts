import { describe, expect, it } from 'vitest';

import { assertNonProductionBootstrapTarget } from './catalogBootstrap';
import { deriveLabel, parseRef, resolveTarget, TargetRefusal } from './migration-target-guard';

/**
 * THE BOOTSTRAP RUNNER'S TARGET DECISION, as the runner actually composes it.
 *
 * `apply-migrations.ts --bootstrap` used to read NEXT_BAR_DATABASE_ENVIRONMENT and trust it. On
 * 2026-08-28 that refused the honest staging bootstrap, and would have ACCEPTED a mislabelled one.
 * It now derives the label from the project REF and feeds THAT to assertNonProductionBootstrapTarget.
 *
 * THE FIRST VERSION OF THIS FILE DID NOT PIN THE COMPOSITION, and Codex was right about it: every
 * rejecting case threw inside `resolveTarget` first, so deleting the
 * `assertNonProductionBootstrapTarget` call entirely left the suite green. The two stages are now
 * exercised SEPARATELY as well as together, and the cases that belong to the second stage reach it
 * — they use inputs the first stage accepts.
 */
const PROD = 'nuhqlvneokucxomguxhi';
const STAGING = 'wqxovhiovgcijmfzxgby';
const DEV = 'devprojectref000000x';
const poolerUrl = (ref: string) => `postgresql://postgres.${ref}:pw@aws-0-ca-central-1.pooler.supabase.com:6543/postgres`;
const apiUrl = (ref: string) => `https://${ref}.supabase.co`;
const classification = { productionRef: PROD, stagingRefs: [STAGING], developmentRefs: [DEV] };

/** STAGE 1 only: what resolveTarget decides, exactly as the runner calls it. */
function stageOne(ref: string, loadedLabel?: string, shellLabel?: string): string {
  const targetLabel = deriveLabel(parseRef(poolerUrl(ref)), classification);
  return resolveTarget({
    env: targetLabel ?? 'unknown',
    shellDatabaseUrl: undefined,
    shellDeclaredEnv: shellLabel,
    databaseUrl: poolerUrl(ref),
    apiUrl: apiUrl(ref),
    actualEnv: loadedLabel,
    classification,
  }).label as string;
}

/** STAGE 2 only: the bootstrap label rule, given a label stage 1 would have produced. */
function stageTwo(label: string): void {
  assertNonProductionBootstrapTarget({ environmentLabel: label });
}

/** Both stages, as the runner composes them. */
function bootstrapDecision(ref: string, loadedLabel?: string, shellLabel?: string): void {
  stageTwo(stageOne(ref, loadedLabel, shellLabel));
}

describe('stage 1 — resolveTarget derives the label from the ref', () => {
  it('accepts a staging pair with no label at all', () => {
    expect(stageOne(STAGING)).toBe('staging');
  });

  it('derives DEVELOPMENT for a ref in NEXT_BAR_DEVELOPMENT_PROJECT_REFS', () => {
    expect(stageOne(DEV)).toBe('development');
  });

  it('REFUSES a staging pair whose loaded label still says production', () => {
    expect(() => stageOne(STAGING, 'production'))
      .toThrow(/says "production" but ref wqxovhiovgcijmfzxgby is staging/);
  });

  it('REFUSES a contradicting label exported in the SHELL', () => {
    expect(() => stageOne(STAGING, 'staging', 'production')).toThrow(/in the shell says "production"/);
  });

  it('REFUSES an unclassified project', () => {
    expect(() => stageOne('unclassifiedproject99')).toThrow(/unknown project/);
  });
});

describe('stage 2 — the bootstrap label rule, reached with a label stage 1 accepts', () => {
  // Calls assertNonProductionBootstrapTarget DIRECTLY, so these fail if that call is removed from
  // the runner's composition — which the first version of this file did not detect.
  //
  // ITS PRODUCTION-REF DENYLIST WAS DELETED, and the three tests that covered it went with it. They
  // were testing unreachable code: a production ref always derives to the label "production", which
  // the rule below refuses, so the ref comparison after it could never run. Proved by mutation —
  // swapping the caller's file-sourced denylist for process.env changed no test outcome. The
  // classification file IS the denylist now; a second list could only disagree with it.
  it('REFUSES a target whose derived label is production', () => {
    expect(() => stageTwo('production'))
      .toThrow(/only staging or development may be bootstrapped/);
  });

  it('permits DEVELOPMENT, which the bootstrap has always allowed', () => {
    expect(() => stageTwo('development')).not.toThrow();
  });

  it('permits staging', () => {
    expect(() => stageTwo('staging')).not.toThrow();
  });
});

describe('the composed decision, as apply-migrations.ts runs it', () => {
  it("ACCEPTS today's pairing once the stale label is gone: staging pair, no contradicting label", () => {
    expect(() => bootstrapDecision(STAGING)).not.toThrow();
  });

  it('REFUSES a production pair, though nothing about the command says production', () => {
    // Stage 1 ACCEPTS this (the ref derives to production and that is what it asked for); stage 2
    // is what refuses, with its own error type. Asserting TargetRefusal here would have been
    // asserting the wrong stage — and would pass only while stage 1 happened to reject first,
    // which is exactly the composition blindness this file was rewritten to remove.
    expect(() => bootstrapDecision(PROD))
      .toThrow(/only staging or development may be bootstrapped/);
  });

  it('REFUSES a production pair WEARING a staging label — the label cannot launder the ref', () => {
    // Here stage 1 refuses: the label contradicts the ref.
    expect(() => bootstrapDecision(PROD, 'staging')).toThrow(TargetRefusal);
  });
});
