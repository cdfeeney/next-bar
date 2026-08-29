import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import pg from 'pg';

import { authorizeMigrationTarget } from './apply-migration-target-guard';

/**
 * THE TLS CONFIG THAT WAS AUTHORIZED MUST BE THE ONE THAT CONNECTS.
 *
 * Codex round 5, HIGH (R5-3), on the production forward-migration path. The channel layer builds a
 * probe from the CA file and authorizes it; the caller then constructs the real client. If the CA
 * path travels in the CONNECTION STRING as `sslrootcert=`, pg reads that file ITSELF when it builds
 * a client — a SECOND read, after the authorization. Codex reproduced the double read on pg 8.20.0:
 * two clients from one config yielded CA-1 then CA-2. A file replaced between the two reads is
 * authenticated by the real client while every check still reports the certified host, user and
 * port.
 *
 * `PGSSLROOTCERT` has no such seam, because this guard reads the file ONCE and puts the BYTES in the
 * config it returns. So the URL form is now refused outright rather than parsed, and these tests
 * pin both halves: the refusal, and the fact that the authorized config survives the file changing
 * underneath it.
 *
 * No connection is opened — pg resolves its parameters at construction, which is the step under
 * test.
 */
const STAGING = 'stagingrefbbbbbbbbbb';
const PROD = 'prodrefaaaaaaaaaaaaa';
const POOLER = 'aws-0-us-east-1.pooler.supabase.com';

const dir = mkdtempSync(join(tmpdir(), 'tls-cert-'));
const caFile = join(dir, 'pooler-ca.crt');
const ORIGINAL_CA = '-----BEGIN CERTIFICATE-----\nTHE-CERTIFIED-ONE\n-----END CERTIFICATE-----\n';
const SWAPPED_CA = '-----BEGIN CERTIFICATE-----\nSWAPPED-AFTERWARDS\n-----END CERTIFICATE-----\n';

const cwd = mkdtempSync(join(tmpdir(), 'tls-cert-cwd-'));
const originalCwd = process.cwd();
const saved: Record<string, string | undefined> = {};

function setEnv(key: string, value: string | undefined): void {
  if (!(key in saved)) saved[key] = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

beforeAll(() => {
  writeFileSync(caFile, ORIGINAL_CA);
  writeFileSync(join(cwd, '.env.local'), [
    `NEXT_BAR_PRODUCTION_PROJECT_REF=${PROD}`,
    `NEXT_BAR_STAGING_PROJECT_REFS=${STAGING}`,
    '',
  ].join('\n'));
  process.chdir(cwd);
  setEnv('NEXT_BAR_DATABASE_ENVIRONMENT', 'staging');
  setEnv('NEXT_PUBLIC_SUPABASE_URL', `https://${STAGING}.supabase.co`);
  setEnv('PGSSLROOTCERT', caFile);
  setEnv('NODE_TLS_REJECT_UNAUTHORIZED', undefined);
});

afterAll(() => {
  process.chdir(originalCwd);
  for (const [key, value] of Object.entries(saved)) setEnv(key, value);
  rmSync(dir, { recursive: true, force: true });
  rmSync(cwd, { recursive: true, force: true });
});

describe('the CA path may only come from the environment', () => {
  it('REFUSES a sslrootcert named in DATABASE_URL, because pg would read it again', () => {
    setEnv('DATABASE_URL', `postgresql://postgres.${STAGING}:pw@${POOLER}:5432/postgres?sslrootcert=${caFile}`);
    const result = authorizeMigrationTarget('staging');
    expect(result.refusal).toMatch(/sslrootcert/);
    expect(result.refusal).toMatch(/read that file again|PGSSLROOTCERT/);
    expect(result.target).toBeNull();
  });

  it('refuses it however the parameter is spelled into the string', () => {
    // Another ssl parameter alongside it must not distract the check.
    setEnv('DATABASE_URL', `postgresql://postgres.${STAGING}:pw@${POOLER}:5432/postgres?sslmode=verify-full&sslrootcert=${caFile}`);
    expect(authorizeMigrationTarget('staging').refusal).toMatch(/sslrootcert/);
  });

  it('accepts the environment form and carries the CA as BYTES, not as a path', () => {
    setEnv('DATABASE_URL', `postgresql://postgres.${STAGING}:pw@${POOLER}:5432/postgres`);
    const result = authorizeMigrationTarget('staging');
    expect(result.refusal).toBeNull();
    expect(result.target?.clientConfig.ssl.ca).toBe(ORIGINAL_CA);
    // The path is nowhere in the authorized config — only the contents.
    expect(JSON.stringify(result.target?.clientConfig)).not.toContain(caFile);
  });

  it('THE POINT: swapping the CA file after authorization cannot change what was authorized', () => {
    setEnv('DATABASE_URL', `postgresql://postgres.${STAGING}:pw@${POOLER}:5432/postgres`);
    const result = authorizeMigrationTarget('staging');
    expect(result.refusal).toBeNull();
    const authorized = result.target!.clientConfig;
    expect(authorized.ssl.ca).toBe(ORIGINAL_CA);

    // The attack: replace the CA on disk between authorization and the connection.
    writeFileSync(caFile, SWAPPED_CA);
    expect(readFileSync(caFile, 'utf8')).toBe(SWAPPED_CA);

    // The authorized object is unchanged...
    expect(authorized.ssl.ca).toBe(ORIGINAL_CA);
    expect(authorized.ssl.ca).not.toBe(SWAPPED_CA);

    // ...and, the part that actually matters, THE CLIENT BUILT FROM IT RESOLVES THAT SAME CA.
    // Asserting only on the string would prove that a JavaScript value did not change by itself
    // (round 7, MEDIUM). The claim under test is about what pg does, so ask pg. No connection is
    // opened — parameters are resolved at construction, which is the step that could re-read.
    const client = new pg.Client(authorized) as unknown as {
      connectionParameters: { ssl?: { ca?: string } };
    };
    expect(client.connectionParameters.ssl?.ca).toBe(ORIGINAL_CA);
    expect(client.connectionParameters.ssl?.ca).not.toBe(SWAPPED_CA);

    writeFileSync(caFile, ORIGINAL_CA);
  });

  it('REFUSES the percent-encoded key that a raw text scan missed (round 7, HIGH)', () => {
    // Reproduced on pg 8.20.0: new URL() rejects the empty authority, a literal sslrootcert=
    // scan misses the encoded key, and pg then repairs the host, decodes the key and reads the
    // file. The guard now refuses anything it cannot parse, so this never reaches that point.
    setEnv(
      'DATABASE_URL',
      `postgresql://postgres.${STAGING}:pw@/postgres?host=${POOLER}&%73slrootcert=${caFile}`,
    );
    const result = authorizeMigrationTarget('staging');
    expect(result.refusal).toBeTruthy();
    expect(result.target).toBeNull();
  });

  it('refuses a percent-encoded key inside an otherwise well-formed URL too', () => {
    setEnv(
      'DATABASE_URL',
      `postgresql://postgres.${STAGING}:pw@${POOLER}:5432/postgres?%73slrootcert=${caFile}`,
    );
    expect(authorizeMigrationTarget('staging').refusal).toMatch(/sslrootcert/);
  });

  it('refuses a string that does not parse as a URL at all, rather than scanning it', () => {
    setEnv('DATABASE_URL', 'host=somewhere dbname=postgres sslrootcert=/tmp/evil.crt');
    expect(authorizeMigrationTarget('staging').refusal).toMatch(/not a parseable URL/);
  });

  it('still refuses when no CA is configured at all', () => {
    setEnv('PGSSLROOTCERT', '');
    setEnv('DATABASE_URL', `postgresql://postgres.${STAGING}:pw@${POOLER}:5432/postgres`);
    expect(authorizeMigrationTarget('staging').refusal).toMatch(/no CA certificate for the pooler/);
    setEnv('PGSSLROOTCERT', caFile);
  });
});
