import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

/**
 * The unit tests above cover the guard's pure functions. Nothing covered the
 * WIRING, which is where the original fail-open actually lived — an inline
 * `?? ''` comparison at the call site — and which is the only place the guard
 * is enforced (round-3 panel, Claude). A reordering that moved the refusal
 * after `client.connect()`, or dropped it entirely, would ship green.
 *
 * So this runs the real CLI. Every fixture points DATABASE_URL at port 1 of a
 * pooler hostname that does not resolve: a refusal must arrive with no
 * connection attempt at all, and the one accepted case must get PAST the guard
 * and die afterwards.
 */
const REF_A = 'stagingrefbbbbbbbbbb';
const REF_B = 'prodrefaaaaaaaaaaaaa';
const POOLER = 'aws-0-us-east-1.pooler.supabase.com';
const MIGRATION = '0059_night_outs_respond_revision.sql';

const dir = mkdtempSync(join(tmpdir(), 'apply-set-guard-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function secretsFile(name: string, lines: Record<string, string>): string {
  const file = join(dir, `${name}.env`);
  writeFileSync(file, Object.entries(lines).map(([k, v]) => `${k}=${v}`).join('\n'));
  return file;
}

/** Runs the real script and returns what an operator would see. */
function runApplySet(file: string): { status: number; output: string } {
  try {
    const stdout = execFileSync(
      process.execPath,
      ['node_modules/tsx/dist/cli.mjs', 'scripts/apply-migration-set.ts',
        '--secrets-file', file, '--env', 'staging', MIGRATION],
      { cwd: process.cwd(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    return { status: 0, output: stdout };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return {
      status: failure.status ?? -1,
      output: `${failure.stdout ?? ''}${failure.stderr ?? ''}`,
    };
  }
}

const url = (ref: string, host = POOLER) => `postgresql://postgres.${ref}:pw@${host}:1/postgres`;

describe('apply-migration-set CLI target guard', () => {
  it('refuses, without connecting, when the staging list is unset', () => {
    const result = runApplySet(secretsFile('no-staging-list', {
      NEXT_BAR_DATABASE_ENVIRONMENT: 'staging',
      NEXT_BAR_PRODUCTION_PROJECT_REF: REF_B,
      NEXT_BAR_STAGING_PROJECT_REFS: '',
      DATABASE_URL: url(REF_A),
    }));
    expect(result.status).toBe(1);
    expect(result.output).toContain('NEXT_BAR_STAGING_PROJECT_REFS is not set');
    expect(result.output).not.toContain('ECONNREFUSED');
  }, 120_000);

  it('refuses, without connecting, when DATABASE_URL points at the production ref', () => {
    const result = runApplySet(secretsFile('points-at-production', {
      NEXT_BAR_DATABASE_ENVIRONMENT: 'staging',
      NEXT_BAR_PRODUCTION_PROJECT_REF: REF_B,
      NEXT_BAR_STAGING_PROJECT_REFS: `${REF_A},${REF_B}`,
      DATABASE_URL: url(REF_B),
    }));
    expect(result.status).toBe(1);
    expect(result.output).toContain('PRODUCTION project ref');
    expect(result.output).not.toContain('ECONNREFUSED');
  }, 120_000);

  it('refuses, without connecting, when the endpoint is not a Supabase pooler', () => {
    const result = runApplySet(secretsFile('not-a-pooler', {
      NEXT_BAR_DATABASE_ENVIRONMENT: 'staging',
      NEXT_BAR_PRODUCTION_PROJECT_REF: REF_B,
      NEXT_BAR_STAGING_PROJECT_REFS: REF_A,
      DATABASE_URL: url(REF_A, 'someone-elses-server.example.com'),
    }));
    expect(result.status).toBe(1);
    expect(result.output).toContain('not a Supabase pooler host');
    expect(result.output).not.toContain('ECONNREFUSED');
  }, 120_000);

  it('refuses, without connecting, when the connection carries startup options', () => {
    const result = runApplySet(secretsFile('startup-options', {
      NEXT_BAR_DATABASE_ENVIRONMENT: 'staging',
      NEXT_BAR_PRODUCTION_PROJECT_REF: REF_B,
      NEXT_BAR_STAGING_PROJECT_REFS: REF_A,
      DATABASE_URL: `${url(REF_A)}?options=reference%3D${REF_B}`,
    }));
    expect(result.status).toBe(1);
    expect(result.output).toContain('startup options');
    expect(result.output).not.toContain('ECONNREFUSED');
  }, 120_000);

  it('refuses, without connecting, when the connection string disables TLS', () => {
    const result = runApplySet(secretsFile('tls-disabled', {
      NEXT_BAR_DATABASE_ENVIRONMENT: 'staging',
      NEXT_BAR_PRODUCTION_PROJECT_REF: REF_B,
      NEXT_BAR_STAGING_PROJECT_REFS: REF_A,
      DATABASE_URL: `${url(REF_A)}?sslmode=disable`,
    }));
    expect(result.status).toBe(1);
    expect(result.output).toContain('disables TLS');
    expect(result.output).not.toContain('ECONNREFUSED');
  }, 120_000);

  // Encrypted is not authenticated: pg hands back a TRUTHY ssl config for these,
  // so a check that only tested truthiness let them through.
  for (const [name, query] of [
    ['sslmode=no-verify', 'sslmode=no-verify'],
    ['ssl=no-verify', 'ssl=no-verify'],
  ] as const) {
    it(`refuses, without connecting, when ${name} turns off certificate verification`, () => {
      const result = runApplySet(secretsFile(`unverified-${name.replace(/[^a-z]/g, '')}`, {
        NEXT_BAR_DATABASE_ENVIRONMENT: 'staging',
        NEXT_BAR_PRODUCTION_PROJECT_REF: REF_B,
        NEXT_BAR_STAGING_PROJECT_REFS: REF_A,
        DATABASE_URL: `${url(REF_A)}?${query}`,
      }));
      expect(result.status).toBe(1);
      expect(result.output).toContain('peer certificate verification');
      expect(result.output).not.toContain('ECONNREFUSED');
    }, 120_000);
  }

  // The other half of the same proof: a verified target must get PAST the guard,
  // so a guard that refused everything could not pass this file either. The host
  // is a pooler name that does not resolve, so the run dies in DNS instead of
  // opening a socket to anyone real.
  it('accepts the configured staging target and fails only afterwards', () => {
    const result = runApplySet(secretsFile('configured-staging', {
      NEXT_BAR_DATABASE_ENVIRONMENT: 'staging',
      NEXT_BAR_PRODUCTION_PROJECT_REF: REF_B,
      NEXT_BAR_STAGING_PROJECT_REFS: REF_A,
      DATABASE_URL: url(REF_A, 'no-such-target.pooler.supabase.com'),
    }));
    expect(result.output).not.toContain('REFUSING');
    expect(result.status).not.toBe(0);
  }, 120_000);
});
