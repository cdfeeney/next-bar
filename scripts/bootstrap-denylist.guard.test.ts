import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

/**
 * RULE 4 END-TO-END, AT THE CLI: a label cannot launder the ref.
 *
 * WHY A CLI TEST AND NOT A UNIT ONE. The unit tests exercise the guard functions; nothing covered
 * the runner's WIRING, which is where a fail-open would actually live. This runs the real
 * `apply-migrations.ts --bootstrap`.
 *
 * THE ATTACK IT PINS. `--secrets-file` loads with `override: true`, so a secrets file can supply
 * whatever it likes: here it points at PRODUCTION, declares itself `staging`, lists production as a
 * staging ref, and supplies a decoy `NEXT_BAR_PRODUCTION_PROJECT_REF` naming some other project.
 * The operator's true classification exists only in the temp cwd's `.env.local`, which is the one
 * source the runner reads for it. The label is derived from the ref against that file, so the
 * declared `staging` contradicts it and the run is refused.
 *
 * IT PINS RULE 4, NOT RULE 5, and the name says so. An earlier version of this file claimed to pin
 * the denylist SOURCING; mutation showed it did not, because a production ref always derives to the
 * label "production" and is refused before any denylist could be consulted. That comparison has
 * since been deleted as unreachable — the classification file IS the denylist.
 *
 * No database is reachable: the fixture host does not resolve, so a refusal must arrive with no
 * connection attempt, and the accepted case must get PAST the guard and die afterwards on DNS.
 */
const PROD = 'nuhqlvneokucxomguxhi';
const STAGING = 'wqxovhiovgcijmfzxgby';
const DECOY = 'decoyprojectref00000';
const MIGRATION = '0060_nyc_night_key_sweep.sql';

const dir = mkdtempSync(join(tmpdir(), 'bootstrap-denylist-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const poolerUrl = (ref: string) => `postgresql://postgres.${ref}:pw@no-such-host.pooler.supabase.com:5432/postgres`;

function secretsFile(name: string, lines: Record<string, string>): string {
  const file = join(dir, `${name}.env`);
  writeFileSync(file, Object.entries(lines).map(([k, v]) => `${k}=${v}`).join('\n'));
  return file;
}

/** A cwd carrying the operator's REAL classification, as the repo root would. */
function cwdWithTrueClassification(): string {
  const cwd = mkdtempSync(join(tmpdir(), 'bootstrap-cwd-'));
  mkdirSync(join(cwd, 'supabase', 'migrations'), { recursive: true });
  copyFileSync(
    join(process.cwd(), 'supabase', 'migrations', MIGRATION),
    join(cwd, 'supabase', 'migrations', MIGRATION),
  );
  writeFileSync(join(cwd, '.env.local'), [
    `NEXT_BAR_PRODUCTION_PROJECT_REF=${PROD}`,
    `NEXT_BAR_STAGING_PROJECT_REFS=${STAGING}`,
    '',
  ].join('\n'));
  return cwd;
}

function runBootstrap(secrets: string, cwd: string): { status: number; output: string } {
  const repo = process.cwd();
  try {
    const stdout = execFileSync(
      process.execPath,
      [join(repo, 'node_modules/tsx/dist/cli.mjs'), join(repo, 'scripts/apply-migrations.ts'),
        '--bootstrap', '--secrets-file', secrets],
      { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env } },
    );
    return { status: 0, output: stdout };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return { status: failure.status ?? -1, output: `${failure.stdout ?? ''}${failure.stderr ?? ''}` };
  }
}

describe('RULE 4 end-to-end (CLI): a label cannot launder the ref', () => {
  it('REFUSES a production target carrying a staging label and a decoy denylist', () => {
    const secrets = secretsFile('decoy-denylist', {
      DATABASE_URL: poolerUrl(PROD),
      NEXT_PUBLIC_SUPABASE_URL: `https://${PROD}.supabase.co`,
      // The attack: name some OTHER project as "the one that must never be bootstrapped", so the
      // denylist is pointed away from the project this command actually targets.
      NEXT_BAR_PRODUCTION_PROJECT_REF: DECOY,
      NEXT_BAR_STAGING_PROJECT_REFS: PROD,
      NEXT_BAR_DATABASE_ENVIRONMENT: 'staging',
    });
    const result = runBootstrap(secrets, cwdWithTrueClassification());
    expect(result.status).not.toBe(0);
    expect(result.output).toContain('[bootstrap-guard]');
    // It must refuse for the RIGHT reason: the ref is production per the FILE, not per the decoy.
    expect(result.output).toMatch(/production/i);
    expect(result.output).not.toMatch(/applied|bootstrapping|ledger row/i);
  });

  it('still ACCEPTS an honest staging target through the same path', () => {
    // The complement: this must not be a guard that refuses everything.
    const secrets = secretsFile('honest-staging', {
      DATABASE_URL: poolerUrl(STAGING),
      NEXT_PUBLIC_SUPABASE_URL: `https://${STAGING}.supabase.co`,
      NEXT_BAR_DATABASE_ENVIRONMENT: 'staging',
    });
    const result = runBootstrap(secrets, cwdWithTrueClassification());
    // It gets PAST the target guard and dies later, on DNS — the host does not resolve.
    expect(result.output).not.toContain('[bootstrap-guard]');
    expect(result.status).not.toBe(0);
  }, 60_000);
});
