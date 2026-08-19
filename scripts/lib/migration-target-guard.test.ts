import { describe, expect, it } from 'vitest';

import { resolveTarget, TargetRefusal, type TargetInput } from './migration-target-guard';

/**
 * A target that passes every check: label and URL both came from the named
 * secrets file, and the label matches what the operator asked for. Each test
 * breaks exactly one thing so a failure names its own cause.
 */
function target(overrides: Partial<TargetInput> = {}): TargetInput {
  return {
    env: 'staging',
    secretsFile: '.env.staging.local',
    secretsParsed: {
      DATABASE_URL: 'postgres://u:p@staging.example/db',
      NEXT_BAR_DATABASE_ENVIRONMENT: 'staging',
    },
    shellDatabaseUrl: undefined,
    databaseUrl: 'postgres://u:p@staging.example/db',
    actualEnv: 'staging',
    ...overrides,
  };
}

describe('resolveTarget', () => {
  it('accepts a secrets file that supplies both the label and the URL', () => {
    expect(() => resolveTarget(target())).not.toThrow();
  });

  it('accepts no secrets file when DATABASE_URL was not already exported', () => {
    expect(() => resolveTarget(target({
      secretsFile: null,
      secretsParsed: undefined,
    }))).not.toThrow();
  });

  it('refuses a secrets file that names no environment', () => {
    expect(() => resolveTarget(target({
      secretsParsed: { DATABASE_URL: 'postgres://u:p@prod.example/db' },
    }))).toThrow(/sets no NEXT_BAR_DATABASE_ENVIRONMENT/);
  });

  // The label-only secrets file. `.env.local` supplies the URL through dotenv's
  // override:false fill-in, so `--env production --execute` prints production
  // and writes whatever .env.local points at.
  it('refuses a secrets file that names the environment but not the URL', () => {
    expect(() => resolveTarget(target({
      env: 'production',
      secretsFile: '.env.production.local',
      secretsParsed: { NEXT_BAR_DATABASE_ENVIRONMENT: 'production' },
      databaseUrl: 'postgres://u:p@staging.example/db',
      actualEnv: 'production',
    }))).toThrow(/sets no DATABASE_URL/);
  });

  // The shell-exported URL. With no secrets file, dotenv's override:false
  // preserves it, so a production connection pairs with .env.local's staging
  // label and `--env staging --execute` passes every remaining check.
  it('refuses a shell-exported DATABASE_URL when no secrets file was given', () => {
    expect(() => resolveTarget(target({
      secretsFile: null,
      secretsParsed: undefined,
      shellDatabaseUrl: 'postgres://u:p@prod.example/db',
      databaseUrl: 'postgres://u:p@prod.example/db',
    }))).toThrow(/already set in the environment/);
  });

  // A secrets file loads with override:true, so it replaces the exported value
  // and the pairing is intact. Refusing here would break the documented way to
  // reach a non-default target from a shell that happens to export the var.
  it('allows a shell-exported DATABASE_URL when a complete secrets file overrides it', () => {
    expect(() => resolveTarget(target({
      shellDatabaseUrl: 'postgres://u:p@prod.example/db',
    }))).not.toThrow();
  });

  it('refuses when DATABASE_URL resolved to nothing', () => {
    expect(() => resolveTarget(target({
      secretsFile: null,
      secretsParsed: undefined,
      databaseUrl: undefined,
    }))).toThrow(/DATABASE_URL is not set/);
  });

  it('refuses when the environment label is missing', () => {
    expect(() => resolveTarget(target({
      secretsFile: null,
      secretsParsed: undefined,
      actualEnv: undefined,
    }))).toThrow(/cannot be identified/);
  });

  it('refuses when the named env disagrees with the loaded label', () => {
    expect(() => resolveTarget(target({ env: 'production' })))
      .toThrow(/but the loaded environment is/);
  });

  it('throws TargetRefusal rather than exiting the process', () => {
    expect(() => resolveTarget(target({ env: 'production' })))
      .toThrow(TargetRefusal);
  });
});
