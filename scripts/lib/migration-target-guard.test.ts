import { describe, expect, it } from 'vitest';

import {
  deriveLabel, parseRef, resolveTarget, TargetRefusal, type TargetInput,
} from './migration-target-guard';

const PROD = 'nuhqlvneokucxomguxhi';
const STAGING = 'wqxovhiovgcijmfzxgby';

const poolerUrl = (ref: string) => `postgresql://postgres.${ref}:pw@aws-0-ca-central-1.pooler.supabase.com:6543/postgres`;
const apiUrl = (ref: string) => `https://${ref}.supabase.co`;

/**
 * A target that passes every check: both URLs name the staging project, the operator asked for
 * staging, and no label contradicts the ref. Each test breaks exactly one thing so a failure names
 * its own cause.
 */
function target(overrides: Partial<TargetInput> = {}): TargetInput {
  return {
    env: 'staging',
    shellDatabaseUrl: undefined,
    shellDeclaredEnv: undefined,
    databaseUrl: poolerUrl(STAGING),
    apiUrl: apiUrl(STAGING),
    actualEnv: 'staging',
    classification: { productionRef: PROD, stagingRefs: [STAGING] },
    ...overrides,
  };
}

describe('parseRef', () => {
  it('reads the ref from a pooler connection string (it is in the USERNAME)', () => {
    expect(parseRef(poolerUrl(PROD))).toBe(PROD);
  });

  it('reads the ref from an API URL and a direct connection (it is in the HOST)', () => {
    expect(parseRef(apiUrl(STAGING))).toBe(STAGING);
    expect(parseRef(`postgresql://postgres:pw@db.${STAGING}.supabase.co:5432/postgres`)).toBe(STAGING);
  });

  it('THROWS rather than guessing at something it does not recognise', () => {
    // It used to return null, and every caller had to remember a null branch. A target nobody can
    // identify is a stop, not an absence — see target-spoofing.test.ts for why that mattered.
    expect(() => parseRef('postgres://user:pw@localhost:5432/postgres')).toThrow(TargetRefusal);
    expect(() => parseRef(undefined)).toThrow(TargetRefusal);
  });
});

describe('deriveLabel', () => {
  it('classifies from the operator-set lists only', () => {
    const c = { productionRef: PROD, stagingRefs: [STAGING] };
    expect(deriveLabel(PROD, c)).toBe('production');
    expect(deriveLabel(STAGING, c)).toBe('staging');
    expect(deriveLabel('someotherprojectref12', c)).toBeNull();
  });
});

describe('resolveTarget', () => {
  it('accepts a consistent staging target', () => {
    expect(() => resolveTarget(target())).not.toThrow();
  });

  it('accepts production when --env production and the ref IS production', () => {
    expect(() => resolveTarget(target({
      env: 'production',
      databaseUrl: poolerUrl(PROD),
      apiUrl: apiUrl(PROD),
      actualEnv: 'production',
    }))).not.toThrow();
  });

  it('returns the DERIVED label, never the declared one', () => {
    const resolved = resolveTarget(target({ actualEnv: undefined }));
    expect(resolved.label).toBe('staging');
  });

  // ── THE INCIDENT'S PAIRING, REPRODUCED EXACTLY ────────────────────────────────────────────────
  //
  // 2026-08-28: `.env.staging.local` carried a staging DATABASE_URL and NEXT_PUBLIC_SUPABASE_URL
  // but NO label. dotenv's `override: false` let the repo-root `.env.local` supply
  // NEXT_BAR_DATABASE_ENVIRONMENT=production, so the STAGING connection string was married to the
  // word "production". Under the old rule — `--env` compared against that label — this inverted the
  // guard completely: `--env production --execute` would have been ACCEPTED while pointed at
  // staging, and `--env staging` REFUSED. Nothing was typed wrong; the file layout did it.
  describe("today's pairing: staging URL pair via --secrets-file, production label from .env.local", () => {
    const pairing = (env: string) => target({
      env,
      databaseUrl: poolerUrl(STAGING),
      apiUrl: apiUrl(STAGING),
      actualEnv: 'production', // inherited from .env.local, NOT from the secrets file
    });

    it('REFUSES --env production, because the ref is staging', () => {
      expect(() => resolveTarget(pairing('production'))).toThrow(TargetRefusal);
      expect(() => resolveTarget(pairing('production'))).toThrow(/ref wqxovhiovgcijmfzxgby is staging/);
    });

    it('ACCEPTS --env staging once the contradicting label is gone', () => {
      // The label is what was wrong, so with it absent the ref alone identifies the target and the
      // honest command is accepted. (With the stale label still present, rule 3 refuses — proven
      // by the case above and the one below.)
      expect(() => resolveTarget(target({ env: 'staging', actualEnv: undefined }))).not.toThrow();
    });
  });

  it('REFUSES when the declared label contradicts the ref, whatever --env says', () => {
    expect(() => resolveTarget(target({ env: 'staging', actualEnv: 'production' })))
      .toThrow(/says "production" but ref wqxovhiovgcijmfzxgby is staging/);
  });

  it('REFUSES a contradicting label exported in the SHELL, which a secrets file would overwrite', () => {
    // `--secrets-file` loads with override:true, so a shell label is replaced before the loaded
    // value is read. Snapshotted separately, or a human who exports the wrong label is silently
    // corrected instead of refused.
    expect(() => resolveTarget(target({ shellDeclaredEnv: 'production', actualEnv: 'staging' })))
      .toThrow(/in the shell says "production"/);
  });

  it('REFUSES when DATABASE_URL and NEXT_PUBLIC_SUPABASE_URL name different projects', () => {
    expect(() => resolveTarget(target({ apiUrl: apiUrl(PROD) })))
      .toThrow(/pooler hostname is shared/);
  });

  it('REFUSES an unclassified project rather than defaulting it to anything', () => {
    expect(() => resolveTarget(target({
      databaseUrl: poolerUrl('unclassifiedproject99'),
      apiUrl: apiUrl('unclassifiedproject99'),
      actualEnv: undefined,
    }))).toThrow(/unknown project unclassifiedproject99/);
  });

  it('REFUSES a shell DATABASE_URL that names a different project than the loaded one', () => {
    expect(() => resolveTarget(target({ shellDatabaseUrl: poolerUrl(PROD) })))
      .toThrow(/will not choose/);
  });

  it('accepts a shell DATABASE_URL naming the SAME project — the ref is the identity', () => {
    expect(() => resolveTarget(target({ shellDatabaseUrl: poolerUrl(STAGING) }))).not.toThrow();
  });

  it('REFUSES when DATABASE_URL is missing or unparseable', () => {
    expect(() => resolveTarget(target({ databaseUrl: undefined }))).toThrow(/DATABASE_URL is not set/);
    // Refused by the ENDPOINT rule now, and earlier than before: localhost is neither the pooler
    // nor a direct db.<ref>.supabase.co host, so the question of which project it is never arises.
    expect(() => resolveTarget(target({ databaseUrl: 'postgres://u:p@localhost/db' })))
      .toThrow(/not a Supabase pooler host/);
    // "refusing to guess" is still reachable, on a host this tooling DOES accept whose username
    // carries no ref — the case where the endpoint is fine and the project is unknowable.
    expect(() => resolveTarget(target({
      databaseUrl: 'postgresql://postgres:pw@aws-0-ca-central-1.pooler.supabase.com:5432/postgres',
    }))).toThrow(/refusing to guess/);
  });
});
