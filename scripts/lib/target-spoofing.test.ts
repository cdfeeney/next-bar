import pg from 'pg';
import { describe, expect, it } from 'vitest';

import {
  assertCoherentClassification, deriveLabel, parseApiRef, parseRef, resolveIdentity, resolveTarget, TargetRefusal,
} from './migration-target-guard';

/**
 * THE BYPASS CODEX FOUND ON 2026-08-28, PINNED AS A FIXTURE.
 *
 * `parseRef` regex-scanned the whole connection string. A PERCENT-ENCODED production pooler
 * username plus `?application_name=postgres.<staging-ref>:` in the query string made every guard in
 * this repo report "staging" while `pg` decoded the username and connected to PRODUCTION. The same
 * trick fooled the API-URL side.
 *
 * The test that matters is not "does the guard say the right word" — it is "does the guard agree
 * with the client that will actually open the socket". So the harness below asks `pg` itself, via
 * `Client.connectionParameters.user`, and NO CONNECTION IS OPENED: pg parses the string at
 * construction, which is exactly the step the guard has to match.
 */
const PROD = 'nuhqlvneokucxomguxhi';
const STAGING = 'wqxovhiovgcijmfzxgby';
const classification = { productionRef: PROD, stagingRefs: [STAGING] };

/** The exact shape of the reported bypass: production username, encoded, staging decoy in the query. */
const SPOOFED = `postgresql://postgres%2E${PROD}:pw@aws-1-us-east-1.pooler.supabase.com:5432/postgres?application_name=postgres.${STAGING}:`;

/** What pg will really use, without connecting. */
function pgResolvesUserTo(connectionString: string): string {
  // `connectionParameters` is populated at construction and is not in pg's public types.
  const client = new pg.Client({ connectionString }) as unknown as { connectionParameters: { user?: string } };
  return client.connectionParameters.user ?? '';
}

describe('identity spoofing — the guard must agree with the client that opens the socket', () => {
  it('pg resolves the spoofed string to the PRODUCTION user (this is why it mattered)', () => {
    const user = pgResolvesUserTo(SPOOFED);
    expect(user).toBe(`postgres.${PROD}`);
    expect(user).not.toContain(STAGING);
  });

  it('the guard now reports PRODUCTION for the same string, agreeing with pg', () => {
    // Before the fix this returned the staging ref from the query string. The assertion is that the
    // two parsers agree, not merely that the guard returns something.
    expect(parseRef(SPOOFED)).toBe(PROD);
    expect(pgResolvesUserTo(SPOOFED)).toBe(`postgres.${parseRef(SPOOFED)}`);
  });

  it('deriveLabel therefore calls it production, not staging', () => {
    expect(deriveLabel(parseRef(SPOOFED), classification)).toBe('production');
  });

  it('resolveTarget REFUSES the spoofed string for a staging run', () => {
    expect(() => resolveTarget({
      env: 'staging',
      shellDatabaseUrl: undefined,
      shellDeclaredEnv: undefined,
      databaseUrl: SPOOFED,
      apiUrl: `https://${STAGING}.supabase.co`,
      actualEnv: undefined,
      classification,
    })).toThrow(TargetRefusal);
  });

  it('a query string can never name a project — search params are ignored entirely', () => {
    const honest = `postgresql://postgres.${STAGING}:pw@aws-0-ca-central-1.pooler.supabase.com:6543/postgres?application_name=postgres.${PROD}:`;
    expect(parseRef(honest)).toBe(STAGING);
  });

  it('an API URL cannot carry a ref in a userinfo prefix — hostname only', () => {
    expect(() => parseApiRef(`https://postgres.${PROD}@${STAGING}.supabase.co`)).not.toThrow();
    expect(parseApiRef(`https://postgres.${PROD}@${STAGING}.supabase.co`)).toBe(STAGING);
  });

  it('THROWS rather than returning null when no ref can be established', () => {
    // The old signature returned null, and every caller had to remember a null branch. A target
    // nobody can identify is a stop, not an absence.
    expect(() => parseRef('postgres://user:pw@localhost:5432/postgres')).toThrow(TargetRefusal);
    expect(() => parseRef('not a url at all')).toThrow(TargetRefusal);
    expect(() => parseRef(undefined)).toThrow(TargetRefusal);
  });

  it('never echoes the password when refusing', () => {
    let message = '';
    try { parseRef('postgres://user:hunter2@localhost:5432/postgres'); } catch (e) { message = (e as Error).message; }
    expect(message).not.toContain('hunter2');
  });
});

/**
 * CODEX ROUND 3 — THE TWO CRITICALS, PINNED.
 *
 * Both are one failure wearing two coats: the guard decided identity from a MODEL of the input
 * instead of from the object that will act on it.
 *
 * So the oracle below is `new pg.Client(config).connectionParameters` — the object the client keeps
 * and connects with — and NOT `pg-connection-string.parse()`. Round 3 found that distinction IS the
 * bug: `parse()` answers what the string says, the Client answers what it will DO, and it fills a
 * missing user or host from PGUSER/PGHOST afterwards (pg/lib/connection-parameters.js). Every test
 * written against `parse()` agreed with a guard that was wrong, which is why the suite was green
 * while production was reachable through a string that read as staging.
 */
const poolerUrl = (ref: string) => `postgresql://postgres.${ref}:pw@aws-0-ca-central-1.pooler.supabase.com:5432/postgres`;
/** No host in the authority at all — pg fills it from PGHOST. This is the round-3 payload. */
const NO_HOST = `postgresql://postgres.${STAGING}@/postgres`;

/** What the client will really use. Constructed, never connected. */
function clientIdentity(connectionString: string): { user: string; host: string } {
  const client = new pg.Client({ connectionString }) as unknown as {
    connectionParameters: { user?: string; host?: string };
  };
  return {
    user: client.connectionParameters.user ?? '',
    host: client.connectionParameters.host ?? '',
  };
}

function withEnv(vars: Record<string, string>, run: () => void): void {
  const saved = Object.keys(vars).map((key) => [key, process.env[key]] as const);
  Object.assign(process.env, vars);
  try {
    run();
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

describe('R3-2 — identity is the connecting client, not a parser', () => {
  it('PGHOST really does redirect the client (the premise Codex demonstrated)', () => {
    withEnv({ PGHOST: `db.${PROD}.supabase.co` }, () => {
      expect(clientIdentity(NO_HOST)).toEqual({
        user: `postgres.${STAGING}`,
        host: `db.${PROD}.supabase.co`,
      });
    });
  });

  it('REFUSES while a libpq PG* variable is set — the string is not the whole target', () => {
    withEnv({ PGHOST: `db.${PROD}.supabase.co` }, () => {
      expect(() => resolveIdentity(NO_HOST)).toThrow(TargetRefusal);
      expect(() => resolveIdentity(NO_HOST)).toThrow(/PGHOST/);
    });
  });

  it('refuses for PGUSER and PGPORT too, not only the variable that was demonstrated', () => {
    withEnv({ PGUSER: `postgres.${PROD}` }, () => {
      expect(() => resolveIdentity(poolerUrl(STAGING))).toThrow(/PGUSER/);
    });
    withEnv({ PGPORT: '5432' }, () => {
      expect(() => resolveIdentity(poolerUrl(STAGING))).toThrow(/PGPORT/);
    });
  });

  it('PGSSLROOTCERT is the one exemption: it names a CA FILE and can never name a project', () => {
    // The repo's own TLS configuration sets it, and refusing it would refuse the sanctioned
    // production path. Every other PG* variable can move the connection; this one cannot.
    withEnv({ PGSSLROOTCERT: 'C:/certs/prod-ca-2021.crt' }, () => {
      expect(resolveIdentity(poolerUrl(STAGING)).ref).toBe(STAGING);
    });
  });

  it('an empty PG* variable is not "set"', () => {
    withEnv({ PGHOST: '' }, () => {
      expect(resolveIdentity(poolerUrl(STAGING)).ref).toBe(STAGING);
    });
  });

  it('what the guard reports IS what the client will use — user and host, not just the ref', () => {
    for (const url of [poolerUrl(STAGING), poolerUrl(PROD)]) {
      const identity = resolveIdentity(url);
      expect({ user: identity.user ?? '', host: identity.host ?? '' }).toEqual(clientIdentity(url));
    }
  });
});

describe('R5-1 — a direct db.<ref>.supabase.co host is refused: DNS is not an identity', () => {
  /**
   * ROUND 4 ASKED FOR DIRECT HOSTS AND ROUND 5 WITHDREW THE REQUEST, which is worth a test rather
   * than a comment. On the pooler the project ref is in the USERNAME and the server authenticates
   * it. On a direct host the ref IS the hostname, so it is whatever DNS says it is: a `hosts` entry
   * pointing db.<staging>.supabase.co at a bridge to production certifies staging and connects to
   * production, with nothing in the string looking wrong to a reader.
   */
  const DIRECT = `postgresql://postgres:pw@db.${STAGING}.supabase.co:5432/postgres`;
  const SPLIT_HALVES = `postgresql://postgres.${STAGING}:pw@db.${PROD}.supabase.co:5432/postgres`;

  it('refuses an honest-looking direct host, though pg would happily connect to it', () => {
    expect(clientIdentity(DIRECT).host).toBe(`db.${STAGING}.supabase.co`);
    expect(() => resolveIdentity(DIRECT)).toThrow(/not a Supabase pooler host/);
  });

  it('refuses a direct host whose username and hostname name different projects', () => {
    expect(() => resolveIdentity(SPLIT_HALVES)).toThrow(/not a Supabase pooler host/);
  });

  it('the API URL still reads its ref from a hostname — it names no connection', () => {
    // parseApiRef is unaffected: NEXT_PUBLIC_SUPABASE_URL is a browser URL that opens no socket,
    // and its only job here is to AGREE with the connection string's ref.
    expect(parseApiRef(`https://${STAGING}.supabase.co`)).toBe(STAGING);
  });
});

describe('R3-5 — the authority is compared to what pg resolved', () => {
  /**
   * THIS TEST WAS WRONG FOR ONE ROUND, AND THE WAY IT WAS WRONG IS THE POINT.
   *
   * It used `postgres.<staging>@db.<production>.supabase.co?host=<pooler>` to prove the authority's
   * HOST half was compared. That payload passed for the wrong reason as soon as round 4's endpoint
   * rule landed: `?host=` makes pg's effective host differ from the authority's, which
   * `checkConnectionEndpoint` refuses first. A test whose payload is caught by an earlier rule
   * pins that earlier rule, not the one it names — the exact overdetermination round 3 warned
   * about, and the same shape as the authority check being unpinned in round 1.
   *
   * The HOST half is now UNREACHABLE BY CONSTRUCTION: the endpoint rule requires pg's host to equal
   * the authority's host, so both halves of that comparison read one string and can never disagree.
   * It is kept in the guard as defence in depth against a future edit that relaxes the endpoint
   * rule — not because it fires today, and the mutation matrix no longer claims it does.
   *
   * The USER half is still live, because `?user=` moves the effective user while the authority's
   * username stays exactly where a human reads it.
   */
  const USER_HALF = `postgresql://postgres.${PROD}:pw@aws-0-ca-central-1.pooler.supabase.com:5432/postgres?user=postgres.${STAGING}`;

  it('pg authenticates as the OVERRIDE, not as the authority (the premise)', () => {
    expect(clientIdentity(USER_HALF).user).toBe(`postgres.${STAGING}`);
    expect(clientIdentity(USER_HALF).host).toBe('aws-0-ca-central-1.pooler.supabase.com');
  });

  it('REFUSES it: the authority reads production, the client authenticates as staging', () => {
    expect(() => resolveIdentity(USER_HALF)).toThrow(TargetRefusal);
    expect(() => resolveIdentity(USER_HALF)).toThrow(new RegExp(`authority names project ${PROD}`));
  });

  it('a host-half divergence is refused too — by the ENDPOINT rule, which is why it gets there first', () => {
    const HOST_HALF = `postgresql://postgres.${STAGING}:pw@db.${PROD}.supabase.co:5432/postgres?host=aws-0-ca-central-1.pooler.supabase.com`;
    expect(() => resolveIdentity(HOST_HALF)).toThrow(/effective connection host does not match/);
  });
});

describe('R3-1 — a DECLARED ref must look like a project ref, or it fails open', () => {
  /**
   * `not-a-project-ref` is in neither list, so the overlap check passes; it then equals no real ref,
   * so production derives as "staging" off the staging list. The check that closes this already
   * existed at apply-migration-target-guard.ts:25 and was not carried into the new reader.
   */
  const INVALID = { productionRef: 'not-a-project-ref', stagingRefs: [STAGING, PROD] };

  it('REFUSES a production ref that is not 20 lowercase alphanumerics', () => {
    expect(() => assertCoherentClassification(INVALID)).toThrow(TargetRefusal);
    expect(() => assertCoherentClassification(INVALID)).toThrow(/not-a-project-ref/);
  });

  it('so the fail-open is closed: production no longer derives as staging', () => {
    expect(() => deriveLabel(PROD, INVALID)).toThrow(TargetRefusal);
  });

  it('a placeholder word is refused as well — this is how it gets typed in real life', () => {
    expect(() => assertCoherentClassification({ productionRef: 'production', stagingRefs: [STAGING] }))
      .toThrow(TargetRefusal);
  });

  it('REFUSES a malformed STAGING or DEVELOPMENT ref too, not only production', () => {
    expect(() => assertCoherentClassification({ productionRef: PROD, stagingRefs: ['staging'] }))
      .toThrow(TargetRefusal);
    expect(() => assertCoherentClassification({
      productionRef: PROD, stagingRefs: [STAGING], developmentRefs: ['dev'],
    })).toThrow(TargetRefusal);
  });

  it('accepts the real classification', () => {
    expect(() => assertCoherentClassification({
      productionRef: PROD, stagingRefs: [STAGING], developmentRefs: ['devprojectref000000x'],
    })).not.toThrow();
  });
});

describe('R3-4 — a ref in staging AND development is a refusal, not a precedence puzzle', () => {
  it('REFUSES the overlap instead of quietly deriving "staging"', () => {
    expect(() => assertCoherentClassification({
      productionRef: PROD, stagingRefs: [STAGING], developmentRefs: [STAGING],
    })).toThrow(TargetRefusal);
  });

  it('and deriveLabel refuses it too, which is what the reset script asks', () => {
    expect(() => deriveLabel(STAGING, {
      productionRef: PROD, stagingRefs: [STAGING], developmentRefs: [STAGING],
    })).toThrow(TargetRefusal);
  });
});

describe('WHICH DATABASE — ported from the home branches, where this branch never had it', () => {
  /**
   * Rounds 4 and 5 hardened the project ref, the endpoint host and port, startup options, the libpq
   * environment and the certified object. NOBODY CHECKED THE DATABASE NAME. One cluster serves many
   * databases, so a URL whose path simply says `/shadow` is self-consistent with every check above
   * it: the ref is the allowlisted one, the host is the right pooler, the port matches, there are no
   * options. If that database happens to carry the ledger, an apply would record itself against a
   * database nobody named. Importing the home branches' tooling is what surfaced the gap.
   */
  const SHADOW = `postgresql://postgres.${STAGING}:pw@aws-0-ca-central-1.pooler.supabase.com:5432/shadow`;
  const HONEST = `postgresql://postgres.${STAGING}:pw@aws-0-ca-central-1.pooler.supabase.com:5432/postgres`;
  const lists = { productionRef: PROD, stagingRefs: [STAGING] };
  const target = (databaseUrl: string) => ({
    env: 'staging',
    shellDatabaseUrl: undefined,
    shellDeclaredEnv: undefined,
    databaseUrl,
    apiUrl: `https://${STAGING}.supabase.co`,
    actualEnv: undefined,
    classification: lists,
  });

  it('pg really does resolve the path as the database (the premise)', () => {
    expect(resolveIdentity(SHADOW).database).toBe('shadow');
    expect(resolveIdentity(HONEST).database).toBe('postgres');
  });

  it('every check ABOVE this one passes for the shadow URL — that is why it needs its own rule', () => {
    const identity = resolveIdentity(SHADOW);
    expect(identity.ref).toBe(STAGING);
    expect(identity.host).toBe('aws-0-ca-central-1.pooler.supabase.com');
    expect(identity.port).toBe(5432);
  });

  it('REFUSES a second database inside the allowlisted project', () => {
    expect(() => resolveTarget(target(SHADOW))).toThrow(TargetRefusal);
    expect(() => resolveTarget(target(SHADOW))).toThrow(/reaches the database "shadow"/);
  });

  it('accepts the Supabase default, which is what every real project uses', () => {
    expect(() => resolveTarget(target(HONEST))).not.toThrow();
  });

  it('an explicitly EMPTY NEXT_BAR_DATABASE_NAME is refused, not treated as "no expectation"', () => {
    expect(() => resolveTarget({
      ...target(HONEST),
      classification: { ...lists, expectedDatabase: '' },
    })).toThrow(/cannot be verified/);
  });

  it('honours an operator override for a project that genuinely uses another database', () => {
    expect(() => resolveTarget({
      ...target(SHADOW),
      classification: { ...lists, expectedDatabase: 'shadow' },
    })).not.toThrow();
  });
});
