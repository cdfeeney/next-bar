import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';

import {
  checkConnectionEndpoint, checkMigrationTarget, resolveProjectRef,
} from '../../scripts/apply-migration-target-guard';

/**
 * The staging-only gate every LIVE vitest suite connects through.
 *
 * Test-support only — nothing in the app imports this. It was extracted from
 * `nightOutsRls.live.test.ts`, which built the whole chain inline, at the point
 * a second live suite (`friendScoreRls.live.test.ts`) needed it. A second COPY
 * of a security gate is the exact failure this repo has already paid for twice:
 * `apply-migration-target-guard.ts`'s own header records a hand-copied
 * comparison that accepted a malformed production ref, and
 * `effectiveMigration.ts` exists because three copies of one list left two live
 * controls silently covering four of five names. One copy, or the two suites
 * drift and only one of them is actually gated.
 *
 * The decisions themselves are NOT re-implemented here: `checkMigrationTarget`
 * and `checkConnectionEndpoint` are imported from the migration guard, which is
 * the one place that decides whether a resolved project ref and endpoint are an
 * acceptable target.
 */

/**
 * A value from the repo-root `.env.local`.
 *
 * Read from the FILE, not `process.env`: nothing loads `.env.local` into the
 * environment for vitest (`vitest.setup.ts` only imports jest-dom), so a
 * suite that read `process.env` alone would silently take the unconfigured
 * path on the machine that followed the documentation.
 */
export function envValue(key: string): string | null {
  try {
    const env = readFileSync(path.join(__dirname, '..', '..', '.env.local'), 'utf8');
    return env.match(new RegExp(`^${key}=(.+)$`, 'm'))?.[1]?.trim() ?? null;
  } catch {
    return null;
  }
}

/**
 * Supabase's CA, when the operator has pointed PGSSLROOTCERT at it. Read from
 * `.env.local` as well as the environment, for the reason above.
 */
function caCertificate(suite: string): string {
  // `||`, not `??`: an EMPTY PGSSLROOTCERT in the environment is not a
  // configured value, and letting it shadow .env.local would reintroduce the
  // same silent downgrade.
  const caPath = (process.env.PGSSLROOTCERT ?? '').trim() || (envValue('PGSSLROOTCERT') ?? '').trim();
  if (!caPath) return '';
  // A configured-but-unreadable CA is a misconfiguration, not a licence to
  // connect unverified: swallowing it was the same silent downgrade.
  try {
    return readFileSync(caPath, 'utf8');
  } catch (error) {
    throw new Error(
      `${suite} refuses to run: PGSSLROOTCERT is set to ${caPath}, which cannot be `
      + `read (${(error as Error).message}). Fix the path or unset it deliberately.`,
    );
  }
}

export type LiveSsl = { rejectUnauthorized: boolean; ca?: string };

/**
 * The TLS config a live suite connects with: verified against Supabase's CA
 * when the operator has one, encrypted-only otherwise.
 *
 * ponytail: unset PGSSLROOTCERT leaves a live suite encrypted but
 * unauthenticated. Hard-refusing would make the suites unrunnable on a machine
 * that has not downloaded the CA, which is a test-harness decision; the APPLY
 * tool refuses, because that is the path that writes.
 */
function sslOption(suite: string): LiveSsl {
  const ca = caCertificate(suite);
  return ca ? { rejectUnauthorized: true, ca } : { rejectUnauthorized: false };
}

/**
 * Ask `pg` itself what it will connect AS, rather than reading the URL.
 *
 * pg's connection-string parser gives QUERY PARAMETERS precedence over the
 * authority. A string whose authority says `postgres.<staging-ref>` while its
 * query says `user=postgres.<production-ref>` passes a URL-parsing gate and
 * connects to production — the gate reads one value and pg uses another.
 * Building the client and inspecting its own resolved parameters makes those
 * the same question by construction. Same config as the real client below, or
 * this answers a question about a different connection — including whether it
 * is encrypted at all.
 *
 * `connectionParameters` is not in @types/pg, hence the narrow cast.
 */
function effectiveConnection(
  connectionString: string,
  ssl: LiveSsl,
): { user: string; host: string; port: string; options: string; ssl: unknown } {
  const probe = new Client({ connectionString, ssl }) as unknown as {
    connectionParameters?: {
      user?: string; host?: string; port?: number | string; options?: string; ssl?: unknown;
    };
  };
  return {
    user: probe.connectionParameters?.user ?? '',
    host: probe.connectionParameters?.host ?? '',
    port: String(probe.connectionParameters?.port ?? ''),
    options: probe.connectionParameters?.options ?? '',
    ssl: probe.connectionParameters?.ssl,
  };
}

/**
 * STAGING-ONLY GATE (round-1 review, Codex: "a loaded gun pointed at prod").
 *
 * A live suite does not merely read — it inserts fixture identities and calls
 * definer RPCs, so it issues real DML, WAL and locks against whatever
 * DATABASE_URL names. ROLLBACK stops rows from being committed; it does not
 * stop any of that, and it is not an authorization.
 *
 * The URL itself cannot tell you which database it is: Supabase's pooler
 * hostname is shared and the project ref hides in the username, so a human
 * reading the connection string sees the same text for staging and production.
 * Therefore the target must be named explicitly, and the gate FAILS CLOSED —
 * an unset allowlist is not permission, it is a missing answer.
 *
 * Set in `.env.local` (see .env.example):
 *   NEXT_BAR_STAGING_PROJECT_REFS=<ref>[,<ref>...]
 *   NEXT_BAR_PRODUCTION_PROJECT_REF=<ref>
 */
function assertStagingOnly(suite: string, connectionString: string, ssl: LiveSsl): void {
  const effective = effectiveConnection(connectionString, ssl);
  const ref = resolveProjectRef(effective.user);
  const allowlist = (envValue('NEXT_BAR_STAGING_PROJECT_REFS') ?? '')
    .split(',').map((value) => value.trim()).filter(Boolean);
  const productionRef = envValue('NEXT_BAR_PRODUCTION_PROJECT_REF');

  // pg parses the connection string OVER the explicit ssl option, so
  // `?sslmode=disable` turns it back off and a suite would send the role
  // password and its DML in the clear while claiming otherwise.
  if (!effective.ssl) {
    throw new Error(
      `${suite} refuses to run: DATABASE_URL disables TLS, so the role password and this suite's `
      + 'DML would cross the network in the clear.',
    );
  }

  // No endpoint override either: the connection must go where the URL's
  // authority says it goes, so a redirected host or port cannot ride along with
  // an allowlisted user. This is the migration guard's own check, imported
  // rather than copied — the copy short-circuited when either side was empty,
  // which a host-less authority (`postgres:///db?host=elsewhere`) produces.
  const authority = new globalThis.URL(connectionString);
  const endpointRefusal = checkConnectionEndpoint(
    { host: effective.host, port: effective.port, options: effective.options },
    { host: authority.hostname, port: authority.port },
  );
  if (endpointRefusal) throw new Error(`${suite} refuses to run: ${endpointRefusal}.`);

  // Config comparison is the migration guard's job, not a second copy of it:
  // the copy accepted a malformed production ref (a trailing comma made it
  // truthy but never equal), which is the fail-open that guard exists to close.
  const refusal = checkMigrationTarget({
    env: 'staging', ref, productionRef: productionRef ?? '', stagingRefs: allowlist,
  });
  if (refusal) {
    throw new Error(
      `${suite} refuses to run: ${refusal}. This suite writes to the database it connects to, so `
      + 'the staging target must be named explicitly and verifiably.',
    );
  }
}

export type LiveDbTarget = { url: string; ssl: LiveSsl };

/**
 * The verified staging target for `suite`, or null when this environment has
 * no credentials AND has acknowledged that.
 *
 * A security gate that silently skips is not a gate (round-3 review, Codex:
 * "fail-open and incomplete"). Absent credentials are only a legitimate reason
 * to skip on a CI runner, which has none by design. Anywhere else — an operator
 * machine, a deploy box — a missing DATABASE_URL means these denials went
 * UNVERIFIED, and that must be loud rather than green.
 */
export function stagingDatabaseTarget(suite: string): LiveDbTarget | null {
  const url = envValue('DATABASE_URL');
  if (url) {
    const ssl = sslOption(suite);
    assertStagingOnly(suite, url, ssl);
    return { url, ssl };
  }
  const skipAllowed = process.env.CI === 'true' || process.env.CI === '1';
  if (!skipAllowed) {
    throw new Error(
      `${suite}: no DATABASE_URL in .env.local, so the behavioral RLS/RPC denials were NOT `
      + 'verified. Set it, or set CI=1 to acknowledge that this environment cannot run them.',
    );
  }
  return null;
}
