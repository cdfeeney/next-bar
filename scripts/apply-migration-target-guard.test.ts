import { describe, expect, it } from 'vitest';

import { checkMigrationTarget } from './apply-migration-target-guard';

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
