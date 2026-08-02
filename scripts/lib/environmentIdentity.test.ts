import { describe, expect, it } from 'vitest';
import * as scriptsSide from './environmentIdentity.mjs';
import * as appSide from '@/lib/environment';

/**
 * SHARED TABLE (goal g-a5ec7d32): scripts/ keeps its own dependency-free mirror
 * of the environment normalizer so `node scripts/check-env.mjs` runs without a
 * bundler. That duplication is only safe if the two implementations cannot
 * drift — this file is the thing that makes that true.
 */

const NORMALIZE_CASES: Array<[string | undefined, string]> = [
  ['production', 'production'],
  ['preview', 'preview'],
  ['staging', 'staging'],
  ['local', 'local'],
  ['development', 'local'],
  ['  STAGING ', 'staging'],
  ['Production', 'production'],
  ['', 'local'],
  ['   ', 'local'],
  [undefined, 'local'],
  ['prod', 'unknown'],
  ['stage', 'unknown'],
  ['qa', 'unknown'],
  ['preprod', 'unknown'],
];

const RESOLVE_CASES: Array<[Record<string, string | undefined>, string]> = [
  [{ VERCEL_TARGET_ENV: 'staging', VERCEL_ENV: 'preview' }, 'staging'],
  [{ VERCEL_ENV: 'production' }, 'production'],
  [{ VERCEL_TARGET_ENV: '   ', VERCEL_ENV: 'preview' }, 'preview'],
  [{}, 'local'],
  [{ VERCEL_TARGET_ENV: 'stg', VERCEL_ENV: 'preview' }, 'unknown'],
  [{ VERCEL_ENV: 'qa' }, 'unknown'],
  [{ VERCEL_TARGET_ENV: 'development' }, 'local'],
];

describe('scripts mirror and app implementation agree exactly', () => {
  it.each(NORMALIZE_CASES)('normalizeEnvironment(%p) === %p on both sides', (input, expected) => {
    expect(appSide.normalizeEnvironment(input)).toBe(expected);
    expect(scriptsSide.normalizeEnvironment(input)).toBe(expected);
  });

  it.each(RESOLVE_CASES)('resolveEnvironment(%p) === %p on both sides', (env, expected) => {
    expect(appSide.resolveEnvironment(env)).toBe(expected);
    expect(scriptsSide.resolveEnvironment(env)).toBe(expected);
  });

  it('both expose the same recognized identities', () => {
    expect([...scriptsSide.DEPLOY_ENVIRONMENTS].sort()).toEqual(
      [...appSide.DEPLOY_ENVIRONMENTS].sort(),
    );
  });

  it('both agree on which identities are deployments', () => {
    for (const value of ['local', 'preview', 'staging', 'production', 'unknown'] as const) {
      expect(scriptsSide.isDeployedEnvironment(value)).toBe(
        appSide.isDeployedEnvironment(value as never),
      );
    }
  });
});

describe('envCheck consumes the same identity source (no third copy)', () => {
  it('rejects every unrecognized identity and accepts every recognized one', async () => {
    const { checkEnv } = await import('./envCheck.mjs');
    // Santa (Claude MEDIUM): envCheck used to re-declare its own list, which
    // could drift from the pinned pair and make the fail-closed guard reject a
    // genuinely valid target. It now imports DEPLOY_ENVIRONMENTS; this asserts
    // the two stay in agreement.
    for (const environment of scriptsSide.DEPLOY_ENVIRONMENTS) {
      const found = checkEnv({}, { environment });
      expect(found.every((f: { name: string }) => f.name !== 'ENVIRONMENT')).toBe(true);
    }
    for (const bogus of ['stg', 'preprod', 'qa', 'unknown']) {
      const found = checkEnv({}, { environment: bogus });
      expect(found).toHaveLength(1);
      expect(found[0].name).toBe('ENVIRONMENT');
    }
  });
});

describe('check-env CLI fails closed on a malformed --environment (santa: Codex HIGH)', () => {
  const runCli = async (args: string[], env: Record<string, string> = {}) => {
    const { execFileSync } = await import('node:child_process');
    try {
      const stdout = execFileSync(process.execPath, ['scripts/check-env.mjs', ...args], {
        encoding: 'utf8',
        env: { ...process.env, ...env },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      return { code: 0, out: stdout };
    } catch (err) {
      const e = err as { status?: number; stdout?: string; stderr?: string };
      return { code: e.status ?? 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
    }
  };

  it('refuses `--environment` with NO value instead of silently checking local', async () => {
    // The CI shape that motivated this: `--environment "$DEPLOY_ENV"` with the
    // variable unset would otherwise skip every deployed requirement, exit 0.
    const bare = await runCli(['--environment']);
    expect(bare.code).toBe(1);
    expect(bare.out).toMatch(/UNKNOWN environment/);

    const blank = await runCli(['--environment', '   ']);
    expect(blank.code).toBe(1);
    expect(blank.out).toMatch(/UNKNOWN environment/);
  });

  it('refuses an unrecognized name', async () => {
    const res = await runCli(['--environment', 'preprod']);
    expect(res.code).toBe(1);
    expect(res.out).toMatch(/Unrecognized|UNKNOWN environment/);
  });
});
