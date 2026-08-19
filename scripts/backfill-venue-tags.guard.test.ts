import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

/**
 * The venueTags unit tests cover the derivation. Nothing covered the WIRING of
 * the backfill script's target guard and its one blast-radius control, which is
 * where every finding against this script has actually lived: a hostname-only
 * check that accepted plaintext HTTP, and a `--limit` parse that missed the
 * `--limit=25` spelling and ran unlimited instead.
 *
 * So this runs the real CLI. Every fixture points at a refused or malformed
 * target, so a refusal must arrive with no connection attempted at all. The
 * two accepted-ref cases must get PAST the ref extraction and be refused by the
 * allowlist instead — that is what proves the new protocol check only ADDS
 * refusals rather than breaking the accept path.
 */
const STAGING_REF = 'wqxovhiovgcijmfzxgby';
const PRODUCTION_REF = 'nuhqlvneokucxomguxhi';
const OTHER_REF = 'aaaaaaaaaaaaaaaaaaaa';

const BASE_ENV = {
  SUPABASE_SERVICE_ROLE_KEY: 'not-a-real-key',
  NEXT_BAR_PRODUCTION_PROJECT_REF: PRODUCTION_REF,
  NEXT_BAR_STAGING_PROJECT_REFS: STAGING_REF,
};

/** Runs the real script and returns what an operator would see. */
function run(
  env: Record<string, string> = {},
  args: string[] = [],
): { status: number; output: string } {
  try {
    const stdout = execFileSync(
      process.execPath,
      ['node_modules/tsx/dist/cli.mjs', 'scripts/backfill-venue-tags.mts', ...args],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, ...BASE_ENV, ...env },
      },
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

const restUrl = (url: string): Record<string, string> => ({ NEXT_PUBLIC_SUPABASE_URL: url });

describe('backfill-venue-tags — target guard', () => {
  it('refuses a plaintext HTTP endpoint even for an allowlisted ref', () => {
    const result = run(restUrl(`http://${STAGING_REF}.supabase.co`));
    expect(result.status).toBe(1);
    expect(result.output).toContain('could not determine the Supabase project ref');
  }, 120_000);

  it('refuses HTTPS on a non-default port, which no Supabase project serves', () => {
    const result = run(restUrl(`https://${STAGING_REF}.supabase.co:8443`));
    expect(result.status).toBe(1);
    expect(result.output).toContain('could not determine the Supabase project ref');
  }, 120_000);

  it('refuses the production project ref outright', () => {
    const result = run(restUrl(`https://${PRODUCTION_REF}.supabase.co`));
    expect(result.status).toBe(1);
    expect(result.output).toContain('PRODUCTION project ref');
  }, 120_000);

  it('refuses a ref that is not on the staging allowlist', () => {
    const result = run(restUrl(`https://${OTHER_REF}.supabase.co`));
    expect(result.status).toBe(1);
    expect(result.output).toContain('NEXT_BAR_STAGING_PROJECT_REFS');
  }, 120_000);

  it('still extracts the ref from a well-formed HTTPS URL', () => {
    // The two cases above reach allowlist and production checks that only run
    // AFTER a ref was resolved, so the protocol check adds refusals rather than
    // rejecting every URL.
    expect(run(restUrl(`https://${OTHER_REF}.supabase.co`)).output)
      .not.toContain('could not determine');
  }, 120_000);

  it('refuses when certificate verification is globally disabled', () => {
    const result = run({
      ...restUrl(`https://${STAGING_REF}.supabase.co`),
      NODE_TLS_REJECT_UNAUTHORIZED: '0',
    });
    expect(result.status).toBe(1);
    expect(result.output).toContain('NODE_TLS_REJECT_UNAUTHORIZED');
  }, 120_000);
});

describe('backfill-venue-tags — --limit fails closed', () => {
  // Every case below refuses BEFORE the target guard, so the URL is irrelevant
  // and no connection is attempted either way.
  const bad = restUrl(`https://${PRODUCTION_REF}.supabase.co`);

  it('accepts the equals spelling instead of silently ignoring it', () => {
    // Reaching the target refusal means the limit parsed; the old
    // indexOf('--limit') never saw this token and ran unlimited.
    expect(run(bad, ['--limit=25']).output).toContain('PRODUCTION project ref');
  }, 120_000);

  it('rejects a non-numeric limit in either spelling', () => {
    for (const args of [['--limit', 'all'], ['--limit=all']]) {
      const result = run(bad, args);
      expect(result.status, args.join(' ')).toBe(1);
      expect(result.output, args.join(' ')).toContain('--limit takes a positive integer');
    }
  }, 120_000);

  it('rejects a limit with no value rather than reading it as unlimited', () => {
    const result = run(bad, ['--limit']);
    expect(result.status).toBe(1);
    expect(result.output).toContain('--limit takes a positive integer');
  }, 120_000);

  it('rejects zero, a negative and a fractional limit', () => {
    for (const value of ['0', '-1', '2.5']) {
      const result = run(bad, [`--limit=${value}`]);
      expect(result.status, value).toBe(1);
      expect(result.output, value).toContain('--limit takes a positive integer');
    }
  }, 120_000);

  it('rejects an unrecognised flag, since a typo\u2019d limit is an unlimited run', () => {
    const result = run(bad, ['--limitt=25']);
    expect(result.status).toBe(1);
    expect(result.output).toContain('unknown option');
  }, 120_000);
});
