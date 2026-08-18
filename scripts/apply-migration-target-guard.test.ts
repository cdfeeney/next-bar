import { describe, expect, it } from 'vitest';

import { checkConnectionHost, checkMigrationTarget } from './apply-migration-target-guard';

const PROD = 'prodrefaaaaaaaaaaaa';
const STAGING = 'stagingrefbbbbbbbb';

describe('checkMigrationTarget', () => {
  it('refuses a non-production env when NEXT_BAR_PRODUCTION_PROJECT_REF is unset', () => {
    const refusal = checkMigrationTarget({
      env: 'staging', ref: PROD, productionRef: '', stagingRefs: [STAGING],
    });
    expect(refusal).toContain('NEXT_BAR_PRODUCTION_PROJECT_REF is not set');
    expect(refusal).toContain('staging');
  });

  // The headline fail-open: both variables unset and DATABASE_URL pointed at
  // production. The pre-fix guard returned no refusal at all here.
  it('refuses a non-production env when BOTH ref variables are unset', () => {
    const refusal = checkMigrationTarget({
      env: 'staging', ref: PROD, productionRef: '', stagingRefs: [],
    });
    expect(refusal).toContain('NEXT_BAR_PRODUCTION_PROJECT_REF is not set');
  });

  it('refuses --env production when NEXT_BAR_PRODUCTION_PROJECT_REF is unset', () => {
    expect(checkMigrationTarget({
      env: 'production', ref: PROD, productionRef: '', stagingRefs: [],
    })).toContain('NEXT_BAR_PRODUCTION_PROJECT_REF is not set');
  });

  it('refuses a non-production env when NEXT_BAR_STAGING_PROJECT_REFS is unset', () => {
    const refusal = checkMigrationTarget({
      env: 'staging', ref: 'someotherrefccccccc', productionRef: PROD, stagingRefs: [],
    });
    expect(refusal).toContain('NEXT_BAR_STAGING_PROJECT_REFS is not set');
  });

  it('refuses a configured ref that is not in the staging list', () => {
    const refusal = checkMigrationTarget({
      env: 'staging', ref: 'someotherrefccccccc', productionRef: PROD, stagingRefs: [STAGING],
    });
    expect(refusal).toContain('not in NEXT_BAR_STAGING_PROJECT_REFS');
  });

  it('refuses a non-production env pointed at the production ref', () => {
    const refusal = checkMigrationTarget({
      env: 'staging', ref: PROD, productionRef: PROD, stagingRefs: [STAGING],
    });
    expect(refusal).toContain('PRODUCTION project ref');
  });

  it('refuses --env production pointed at a ref that is not production', () => {
    expect(checkMigrationTarget({
      env: 'production', ref: STAGING, productionRef: PROD, stagingRefs: [STAGING],
    })).toContain('does not point at the production project ref');
  });

  it('refuses when the ref could not be resolved from DATABASE_URL', () => {
    expect(checkMigrationTarget({
      env: 'staging', ref: '', productionRef: PROD, stagingRefs: [STAGING],
    })).toContain('could not determine the Supabase project ref');
  });

  // Round-2 panel finding: a whitespace-only NEXT_BAR_PRODUCTION_PROJECT_REF is
  // truthy, so it passed the missing-ref check and then never equalled a real
  // ref. With the staging list naming the production ref, the guard accepted
  // production under --env staging.
  it('refuses a whitespace-only production ref instead of treating it as configured', () => {
    const refusal = checkMigrationTarget({
      env: 'staging', ref: PROD, productionRef: '   ', stagingRefs: [PROD],
    });
    expect(refusal).toContain('NEXT_BAR_PRODUCTION_PROJECT_REF is not set');
  });

  it('refuses a whitespace-only staging list instead of treating it as configured', () => {
    const refusal = checkMigrationTarget({
      env: 'staging', ref: STAGING, productionRef: PROD, stagingRefs: ['  ', ''],
    });
    expect(refusal).toContain('NEXT_BAR_STAGING_PROJECT_REFS is not set');
  });

  it('still matches the production ref when the configured value is padded', () => {
    expect(checkMigrationTarget({
      env: 'staging', ref: PROD, productionRef: ` ${PROD} `, stagingRefs: [STAGING],
    })).toContain('PRODUCTION project ref');
  });

  it('accepts the configured staging target when both variables are set', () => {
    expect(checkMigrationTarget({
      env: 'staging', ref: STAGING, productionRef: PROD, stagingRefs: [STAGING],
    })).toBeNull();
  });

  it('accepts the configured production target when both variables are set', () => {
    expect(checkMigrationTarget({
      env: 'production', ref: PROD, productionRef: PROD, stagingRefs: [STAGING],
    })).toBeNull();
  });
});

// Round-2 panel finding: the ref check answers "which project" and was reused
// from the live RLS suite, but its host half was dropped, so `?host=` could
// redirect a connection whose username still looked allowlisted.
describe('checkConnectionHost', () => {
  const HOST = 'aws-0-us-east-1.pooler.supabase.com';

  it('refuses when pg resolves a different host than the URL authority', () => {
    const refusal = checkConnectionHost('somewhere-else.internal', HOST);
    expect(refusal).toContain('does not match');
  });

  it('refuses when the authority has no host', () => {
    expect(checkConnectionHost(HOST, '')).toContain('DATABASE_URL has no host');
  });

  it('refuses when the effective host could not be resolved', () => {
    expect(checkConnectionHost('   ', HOST)).toContain('effective connection host could not be resolved');
  });

  it('accepts the connection when pg resolves the authority host', () => {
    expect(checkConnectionHost(HOST, HOST)).toBeNull();
  });
});
