import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

/**
 * apply-one-migration.mts had NO target guard at all: it read DATABASE_URL and
 * connected. Its sibling apply-migration-set.ts refused six ways, and the only
 * thing standing between the two was a runbook sentence.
 *
 * These run the REAL CLI for the same reason the set applier's wiring test
 * does: the guard is only worth what its call site enforces, and a refusal that
 * moved below `client.connect()` — or an import that silently dropped — would
 * ship green against unit tests of the pure functions.
 *
 * Every fixture points DATABASE_URL at port 1 of a pooler hostname that does
 * not resolve, so a refusal must arrive with no connection attempt at all, and
 * the accepted case must get PAST the guard and die afterwards.
 */
const REF_A = 'stagingrefbbbbbbbbbb';
const REF_B = 'prodrefaaaaaaaaaaaaa';
const POOLER = 'aws-0-us-east-1.pooler.supabase.com';
const MIGRATION = 'supabase/migrations/0059_night_outs_respond_revision.sql';

const dir = mkdtempSync(join(tmpdir(), 'apply-one-guard-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

// A stand-in for Supabase's CA: the refusal cases never reach TLS resolution
// and the accepted case dies in DNS, so no case needs a real certificate —
// only a readable file, which is what the tool checks for before connecting.
const caFile = join(dir, 'pooler-ca.crt');
writeFileSync(caFile, ['-----BEGIN CERTIFICATE-----', 'not-a-real-certificate', '-----END CERTIFICATE-----', ''].join('\n'));

const url = (ref: string, host = POOLER) => `postgresql://postgres.${ref}:pw@${host}:1/postgres`;

let fixtures = 0;
/**
 * Every case names its whole environment in a --secrets-file. The developer's
 * own .env.local defines these same four variables, so a test that left one
 * unset would be answered by whatever that untracked file happens to say —
 * green here, absent on a machine without it. The fixture decides, not the box.
 */
function secretsFile(vars: Record<string, string>): string {
  fixtures += 1;
  const file = join(dir, `fixture-${fixtures}.env`);
  writeFileSync(file, Object.entries(vars).map(([k, v]) => `${k}=${v}`).join('\n'));
  return file;
}

function runApplyOne(
  vars: Record<string, string>,
  { args, env = {} }: { args?: string[]; env?: Record<string, string> } = {},
): { status: number; output: string } {
  const file = secretsFile(vars);
  try {
    const stdout = execFileSync(
      process.execPath,
      ['node_modules/tsx/dist/cli.mjs', 'scripts/apply-one-migration.mts',
        '--secrets-file', file, ...(args ?? ['--env', 'staging', MIGRATION])],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, PGSSLROOTCERT: caFile, ...env },
      },
    );
    return { status: 0, output: stdout };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return { status: failure.status ?? -1, output: `${failure.stdout ?? ''}${failure.stderr ?? ''}` };
  }
}

const staging = {
  NEXT_BAR_DATABASE_ENVIRONMENT: 'staging',
  NEXT_BAR_PRODUCTION_PROJECT_REF: REF_B,
  NEXT_BAR_STAGING_PROJECT_REFS: REF_A,
  DATABASE_URL: url(REF_A),
};

describe('apply-one-migration CLI target guard', () => {
  it('refuses, without connecting, when the target is not named', () => {
    const result = runApplyOne(staging, { args: [MIGRATION] });
    expect(result.status).toBe(2);
    expect(result.output).toContain('--env <label> is required');
    expect(result.output).not.toContain('ECONNREFUSED');
  }, 120_000);

  it('refuses, without connecting, when the production ref is unset', () => {
    const result = runApplyOne({ ...staging, NEXT_BAR_PRODUCTION_PROJECT_REF: '' });
    expect(result.status).toBe(1);
    expect(result.output).toContain('NEXT_BAR_PRODUCTION_PROJECT_REF is not set');
    expect(result.output).not.toContain('ECONNREFUSED');
  }, 120_000);

  it('refuses, without connecting, when the ref is outside the staging allowlist', () => {
    const result = runApplyOne({ ...staging, NEXT_BAR_STAGING_PROJECT_REFS: 'otherrefccccccccccc0' });
    expect(result.status).toBe(1);
    expect(result.output).toContain('not in NEXT_BAR_STAGING_PROJECT_REFS');
    expect(result.output).not.toContain('ECONNREFUSED');
  }, 120_000);

  it('refuses, without connecting, when DATABASE_URL points at the production ref', () => {
    const result = runApplyOne({
      ...staging,
      NEXT_BAR_STAGING_PROJECT_REFS: `${REF_A},${REF_B}`,
      DATABASE_URL: url(REF_B),
    });
    expect(result.status).toBe(1);
    expect(result.output).toContain('PRODUCTION project ref');
    expect(result.output).not.toContain('ECONNREFUSED');
  }, 120_000);

  // pg gives ?host= / ?port= precedence over the authority the operator reads,
  // so the allowlisted ref in the username stays intact while the connection
  // goes somewhere else entirely.
  it('refuses, without connecting, when ?host= moves the connection off the authority', () => {
    const result = runApplyOne({ ...staging, DATABASE_URL: `${url(REF_A)}?host=elsewhere.example.com` });
    expect(result.status).toBe(1);
    expect(result.output).toContain('effective connection host does not match');
    expect(result.output).not.toContain('ECONNREFUSED');
  }, 120_000);

  it('refuses, without connecting, when ?port= moves the connection off the authority', () => {
    const result = runApplyOne({ ...staging, DATABASE_URL: `${url(REF_A)}?port=6543` });
    expect(result.status).toBe(1);
    expect(result.output).toContain('effective connection port does not match');
    expect(result.output).not.toContain('ECONNREFUSED');
  }, 120_000);

  it('refuses, without connecting, when no pooler CA is configured', () => {
    const result = runApplyOne({ ...staging, PGSSLROOTCERT: '' });
    expect(result.status).toBe(1);
    expect(result.output).toContain('no CA certificate for the pooler');
    expect(result.output).not.toContain('ECONNREFUSED');
  }, 120_000);

  // The other half of the proof: a guard that refused everything would also
  // "pass" every case above. The host is a pooler name that does not resolve,
  // so an authorised run dies in DNS instead of reaching anyone real.
  it('accepts the configured staging target and fails only afterwards', () => {
    const result = runApplyOne({
      ...staging,
      DATABASE_URL: url(REF_A, 'no-such-target.pooler.supabase.com'),
    });
    expect(result.output).not.toContain('REFUSING');
    expect(result.output).toContain('[apply-one] tls      : on, peer certificate verified');
    expect(result.status).not.toBe(0);
  }, 120_000);

  // ...and the other half of THAT. Dying in DNS proves the guard let the run
  // through, and nothing more: delete `await pg.query(sql)` from the applier
  // and every case above still passes, because no case ever gets far enough to
  // notice. This one does. It replaces pg's SOCKET (connect/query/end on the
  // real Client prototype) and leaves everything else real — the same CLI, the
  // same guard, pg's own resolution of the same connection string — so what it
  // asserts is the exact query sequence an authorised apply issues.
  //
  // NODE_OPTIONS, not --require: tsx's CLI re-spawns node, and a flag passed to
  // the parent never reaches the child that actually runs the script.
  it('applies the migration on an authorised staging target, in order', () => {
    const recorder = join(dir, 'record-queries.cjs');
    writeFileSync(recorder, [
      "const { createHash } = require('node:crypto');",
      "const { Client } = require(require.resolve('pg', { paths: [process.cwd()] }));",
      "const sha = (t) => createHash('sha256').update(String(t)).digest('hex');",
      "Client.prototype.connect = async function () { console.log('[probe] connect'); };",
      'Client.prototype.query = async function (text) {',
      "  console.log(`[probe] query ${sha(typeof text === 'string' ? text : text && text.text)}`);",
      '  return { rows: [], rowCount: 0 };',
      '};',
      'Client.prototype.end = async function () {};',
      '',
    ].join('\n'));

    const result = runApplyOne(staging, { env: { NODE_OPTIONS: `--require "${recorder.split('\\').join('/')}"` } });
    const sha = (text: string) => createHash('sha256').update(text).digest('hex');

    expect(result.output.split('\n').map((line) => line.trim()).filter((line) => line.startsWith('[probe]')))
      .toEqual([
        '[probe] connect',
        `[probe] query ${sha("SET lock_timeout = '10s'")}`,
        `[probe] query ${sha("SET statement_timeout = '300s'")}`,
        `[probe] query ${sha(readFileSync(MIGRATION, 'utf8'))}`,
      ]);
    expect(result.output).toContain(`ok ${MIGRATION}`);
    expect(result.status).toBe(0);
  }, 120_000);
});
