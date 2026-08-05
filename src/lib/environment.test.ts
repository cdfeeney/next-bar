import { describe, expect, it } from 'vitest';
import {
  DEPLOY_ENVIRONMENTS,
  normalizeEnvironment,
  resolveEnvironment,
  type DeployEnvironment,
} from './environment';

/**
 * Deployment environment identity (goal g-a5ec7d32).
 *
 * Two rules carry the safety weight:
 *   1. VERCEL_TARGET_ENV is PRIMARY. Vercel sets VERCEL_ENV='preview' for
 *      custom environments too, so trusting it first would read a protected
 *      `staging` target as ordinary preview — the exact confusion that lets
 *      preview-grade credential rules be applied to a privileged target.
 *   2. An unrecognized value FAILS CLOSED ('unknown'). The old checker let an
 *      unknown string fall through every branch, silently skipping the
 *      deployed-environment requirements.
 */

describe('normalizeEnvironment', () => {
  it('accepts the four recognized identities', () => {
    expect(normalizeEnvironment('production')).toBe('production');
    expect(normalizeEnvironment('preview')).toBe('preview');
    expect(normalizeEnvironment('staging')).toBe('staging');
    expect(normalizeEnvironment('local')).toBe('local');
  });

  it("normalizes Vercel's 'development' to local", () => {
    expect(normalizeEnvironment('development')).toBe('local');
  });

  it('is case- and whitespace-insensitive', () => {
    expect(normalizeEnvironment('  STAGING ')).toBe('staging');
    expect(normalizeEnvironment('Production')).toBe('production');
  });

  it('FAILS CLOSED on anything unrecognized — never silently local', () => {
    for (const value of ['prod', 'stage', 'qa', 'preprod', 'test', 'PRODUCTION_2']) {
      expect(normalizeEnvironment(value)).toBe('unknown');
    }
  });

  it('treats empty/absent as local (a genuinely unset env is local dev)', () => {
    expect(normalizeEnvironment(undefined)).toBe('local');
    expect(normalizeEnvironment('')).toBe('local');
    expect(normalizeEnvironment('   ')).toBe('local');
  });

  it('exports exactly the recognized deploy identities', () => {
    expect([...DEPLOY_ENVIRONMENTS].sort()).toEqual([
      'local',
      'preview',
      'production',
      'staging',
    ]);
  });
});

describe('resolveEnvironment precedence', () => {
  it('VERCEL_TARGET_ENV wins over VERCEL_ENV', () => {
    // The load-bearing case: a custom `staging` target still reports
    // VERCEL_ENV='preview'. Primary must win or a privileged target is
    // mistaken for ordinary preview.
    expect(
      resolveEnvironment({ VERCEL_TARGET_ENV: 'staging', VERCEL_ENV: 'preview' }),
    ).toBe('staging');
  });

  it('falls back to VERCEL_ENV when the primary is absent or blank', () => {
    expect(resolveEnvironment({ VERCEL_ENV: 'production' })).toBe('production');
    expect(
      resolveEnvironment({ VERCEL_TARGET_ENV: '   ', VERCEL_ENV: 'preview' }),
    ).toBe('preview');
  });

  it('falls back to local when neither is set', () => {
    expect(resolveEnvironment({})).toBe('local');
  });

  it('an unknown PRIMARY fails closed and does NOT fall through to VERCEL_ENV', () => {
    // Falling through would let a typo'd target silently inherit a laxer
    // identity — the unknown must surface, not be papered over.
    expect(
      resolveEnvironment({ VERCEL_TARGET_ENV: 'stg', VERCEL_ENV: 'preview' }),
    ).toBe('unknown');
  });

  it('an unknown fallback value also fails closed', () => {
    expect(resolveEnvironment({ VERCEL_ENV: 'qa' })).toBe('unknown');
  });

  it('is a pure function of the passed env (no process.env reads)', () => {
    const before = process.env.VERCEL_TARGET_ENV;
    process.env.VERCEL_TARGET_ENV = 'production';
    try {
      expect(resolveEnvironment({ VERCEL_ENV: 'preview' })).toBe('preview');
    } finally {
      if (before === undefined) delete process.env.VERCEL_TARGET_ENV;
      else process.env.VERCEL_TARGET_ENV = before;
    }
  });
});

describe('type surface', () => {
  it('DeployEnvironment covers the normalizer output union', () => {
    const values: Array<DeployEnvironment | 'unknown'> = [
      'local',
      'preview',
      'staging',
      'production',
      'unknown',
    ];
    expect(values).toHaveLength(5);
  });
});
