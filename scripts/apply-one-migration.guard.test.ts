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
 * Every fixture names its own DATABASE_URL, and every case but one runs with
 * the recorder below attached, so "no connection was attempted" and "the
 * migration was applied, over TLS the guard authorised" are OBSERVED rather
 * than inferred from which error string happened to appear.
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

/**
 * The recorder. It replaces pg's SOCKET — connect/query/end on the REAL Client
 * prototype — inside the spawned child, and nothing else: the same CLI, the
 * same guard, pg's own resolution of the same connection string. What that buys
 * is a direct OBSERVATION in place of two inferences the earlier version of this
 * file was making.
 *
 *   * A refusal used to be trusted because the output lacked 'ECONNREFUSED'.
 *     That is absence of one error string, not absence of a connection: a
 *     connect that was attempted and swallowed, or that failed with ENOTFOUND
 *     instead, looked identical. Now every refusal case asserts ZERO recorded
 *     connects.
 *   * An accepted run used to be trusted because it printed the banner and then
 *     died. It died in DNS, so it never reached a query — deleting
 *     `await pg.query(sql)` from the applier left all of it green. Now the
 *     accepted case asserts the exact sequence, and the connect line carries the
 *     TLS state of the client that actually connected, so rebuilding that client
 *     from the connection string alone (dropping the CA and the explicit ssl the
 *     guard authorised) goes red instead of shipping DDL in the clear.
 *
 * NODE_OPTIONS, not --require: tsx's CLI re-spawns node, and a flag given to the
 * parent never reaches the child that runs the script. Forward slashes: node's
 * NODE_OPTIONS parser treats a backslash inside quotes as an escape, so a
 * Windows temp path arrives as `C:Userscdfee...` and the preload is not found.
 */
const recorder = join(dir, 'record-queries.cjs');
writeFileSync(recorder, [
  "const { createHash } = require('node:crypto');",
  "const { Client } = require(require.resolve('pg', { paths: [process.cwd()] }));",
  "const sha = (t) => createHash('sha256').update(String(t)).digest('hex');",
  'Client.prototype.connect = async function () {',
  '  const p = this.connectionParameters || {};',
  '  const ssl = p.ssl;',
  "  console.log(`[probe] connect ${p.user}@${p.host}:${p.port} ssl=${ssl ? 'on' : 'off'} \\",
  "rejectUnauthorized=${ssl ? String(ssl.rejectUnauthorized) : 'n/a'} ca=${ssl && ssl.ca ? 'yes' : 'no'}`);",
  '};',
  'Client.prototype.query = async function (text) {',
  "  console.log(`[probe] query ${sha(typeof text === 'string' ? text : text && text.text)}`);",
  '  return { rows: [], rowCount: 0 };',
  '};',
  'Client.prototype.end = async function () {};',
  '',
].join('\n'));
const RECORDING = { NODE_OPTIONS: `--require "${recorder.split('\\').join('/')}"` };

/** Every line the recorder emitted, in order. Empty means no client ever connected. */
const probed = (output: string): string[] => output
  .split('\n').map((line) => line.trim()).filter((line) => line.startsWith('[probe]'));

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
  { args, env = {}, record = true }:
  { args?: string[]; env?: Record<string, string>; record?: boolean } = {},
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
        env: { ...process.env, PGSSLROOTCERT: caFile, ...(record ? RECORDING : {}), ...env },
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
    expect(probed(result.output)).toEqual([]);
  }, 120_000);

  it('refuses, without connecting, when the production ref is unset', () => {
    const result = runApplyOne({ ...staging, NEXT_BAR_PRODUCTION_PROJECT_REF: '' });
    expect(result.status).toBe(1);
    expect(result.output).toContain('NEXT_BAR_PRODUCTION_PROJECT_REF is not set');
    expect(probed(result.output)).toEqual([]);
  }, 120_000);

  it('refuses, without connecting, when the ref is outside the staging allowlist', () => {
    const result = runApplyOne({ ...staging, NEXT_BAR_STAGING_PROJECT_REFS: 'otherrefccccccccccc0' });
    expect(result.status).toBe(1);
    expect(result.output).toContain('not in NEXT_BAR_STAGING_PROJECT_REFS');
    expect(probed(result.output)).toEqual([]);
  }, 120_000);

  it('refuses, without connecting, when DATABASE_URL points at the production ref', () => {
    const result = runApplyOne({
      ...staging,
      NEXT_BAR_STAGING_PROJECT_REFS: `${REF_A},${REF_B}`,
      DATABASE_URL: url(REF_B),
    });
    expect(result.status).toBe(1);
    expect(result.output).toContain('PRODUCTION project ref');
    expect(probed(result.output)).toEqual([]);
  }, 120_000);

  // pg gives ?host= / ?port= precedence over the authority the operator reads,
  // so the allowlisted ref in the username stays intact while the connection
  // goes somewhere else entirely.
  it('refuses, without connecting, when ?host= moves the connection off the authority', () => {
    const result = runApplyOne({ ...staging, DATABASE_URL: `${url(REF_A)}?host=elsewhere.example.com` });
    expect(result.status).toBe(1);
    expect(result.output).toContain('effective connection host does not match');
    expect(probed(result.output)).toEqual([]);
  }, 120_000);

  it('refuses, without connecting, when ?port= moves the connection off the authority', () => {
    const result = runApplyOne({ ...staging, DATABASE_URL: `${url(REF_A)}?port=6543` });
    expect(result.status).toBe(1);
    expect(result.output).toContain('effective connection port does not match');
    expect(probed(result.output)).toEqual([]);
  }, 120_000);

  it('refuses, without connecting, when no pooler CA is configured', () => {
    const result = runApplyOne({ ...staging, PGSSLROOTCERT: '' });
    expect(result.status).toBe(1);
    expect(result.output).toContain('no CA certificate for the pooler');
    expect(probed(result.output)).toEqual([]);
  }, 120_000);

  // The other half of the proof: a guard that refused everything would also
  // "pass" every case above. This is the ONE case that runs against unmodified
  // pg — record: false — so something in the suite still reaches the real
  // network stack. The host is a pooler name that does not resolve, so it dies
  // in DNS instead of reaching anyone real.
  it('accepts the configured staging target and fails only afterwards', () => {
    const result = runApplyOne({
      ...staging,
      DATABASE_URL: url(REF_A, 'no-such-target.pooler.supabase.com'),
    }, { record: false });
    expect(result.output).not.toContain('REFUSING');
    expect(result.output).toContain('[apply-one] tls      : on, peer certificate verified');
    expect(result.status).not.toBe(0);
  }, 120_000);

  // ...and the other half of THAT. Dying in DNS proves the guard let the run
  // through and nothing more. This asserts what an authorised apply actually
  // issues, and over what: the connect line carries the resolved TLS state of
  // the client that connected — its resolved user@host:port AND its TLS state,
  // which together are what distinguish the authorised clientConfig from a
  // client rebuilt, redirected, or downgraded after the guard had its say. pg
  // gives `?host=`/`?port=` precedence over the authority, so appending one to
  // the connection string on the way to `new Client` would move the connection
  // somewhere the guard never inspected while every other assertion held.
  // apply-migration-target-guard.ts says why that distinction matters — rebuilt,
  // the CA and the explicit ssl are gone and pg's default for a URL naming no
  // sslmode is no TLS at all, so the DDL and the role password would cross the
  // network in the clear while the banner still claimed a verified peer.
  it('applies the migration over the authorised TLS config, in order', () => {
    const result = runApplyOne(staging);
    const sha = (text: string) => createHash('sha256').update(text).digest('hex');

    expect(probed(result.output)).toEqual([
      `[probe] connect postgres.${REF_A}@${POOLER}:1 ssl=on rejectUnauthorized=true ca=yes`,
      `[probe] query ${sha("SET lock_timeout = '10s'")}`,
      `[probe] query ${sha("SET statement_timeout = '300s'")}`,
      `[probe] query ${sha(readFileSync(MIGRATION, 'utf8'))}`,
    ]);
    expect(result.output).toContain(`ok ${MIGRATION}`);
    expect(result.status).toBe(0);
  }, 120_000);
});
