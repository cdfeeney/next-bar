import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';

/**
 * THE TARGET GUARDS, DRIVEN THROUGH THE REAL RUNNERS.
 *
 * Two rounds of review found bypasses that unit tests could not, and a third round found that the
 * unit tests did not pin the WIRING either — a helper that re-implements the composition stays green
 * when the runner stops calling it. So these spawn the actual CLIs with a temp cwd carrying its own
 * `.env.local` and a `--secrets-file`, and assert on what an operator would see.
 *
 * THE CLIENT IS THE AUTHORITY. Every accepted target is checked against
 * `new pg.Client(config).connectionParameters` — the object that will open the socket — and NOT
 * against `pg-connection-string.parse()`. Round 3 found that distinction is load-bearing: parse()
 * answers what the string SAYS, the Client answers what it will DO, and it fills a missing user or
 * host from PGUSER/PGHOST afterwards. These tests asked parse(), so they agreed with a guard that
 * was wrong and the whole file stayed green while production was reachable.
 *
 * No database is reachable: the fixture host does not resolve.
 */

/** What the client will really use. Constructed, never connected. */
function clientIdentity(connectionString: string): { user?: string; host?: string } {
  return (new pg.Client({ connectionString }) as unknown as {
    connectionParameters: { user?: string; host?: string };
  }).connectionParameters;
}
const PROD = 'nuhqlvneokucxomguxhi';
const STAGING = 'wqxovhiovgcijmfzxgby';
const DEV = 'devprojectref000000x';
const DECOY = 'decoyprojectref00000';
const MIGRATION = '0060_nyc_night_key_sweep.sql';
const HOST = 'no-such-host.pooler.supabase.com';

const dir = mkdtempSync(join(tmpdir(), 'target-identity-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const poolerUrl = (ref: string) => `postgresql://postgres.${ref}:pw@${HOST}:5432/postgres`;

/** CODEX ROUND 2, CRITICAL: pg reads query params FIRST and lets ?user= override the authority. */
const USER_OVERRIDE = `postgresql://postgres.${STAGING}:pw@${HOST}:5432/postgres?user=postgres.${PROD}`;
/** CODEX ROUND 2: ?host= overrides the host the same way. */
const HOST_OVERRIDE = `postgresql://postgres.${STAGING}:pw@${HOST}:5432/postgres?host=db.${PROD}.supabase.co`;
/** CODEX ROUND 1, CRITICAL: percent-encoded username + a staging decoy in application_name. */
const ENCODED = `postgresql://postgres%2E${PROD}:pw@${HOST}:5432/postgres?application_name=postgres.${STAGING}:`;
/**
 * THE OVERRIDE POINTED THE OTHER WAY: the authority reads production, pg connects to staging.
 *
 * This one is SAFE by outcome — pg reaches staging — and that is exactly why it needs its own test.
 * Mutation showed the authority-contradiction check was unpinned without it: every payload above is
 * ALSO caught by the production refusal downstream, so deleting the comparison changed no verdict.
 * A connection string whose visible half names one project and whose effective half names another
 * is untrustworthy in both directions; the guard refuses the ambiguity rather than the outcome.
 */
const INVERTED_OVERRIDE = `postgresql://postgres.${PROD}:pw@${HOST}:5432/postgres?user=postgres.${STAGING}`;
/** ROUND 4, CRITICAL: Supabase's pooler reads `options=reference=<ref>` as the tenant selector. */
const OPTIONS_TENANT = `postgresql://postgres.${STAGING}:pw@${HOST}:5432/postgres?options=reference%3D${PROD}`;
/** ROUND 4, HIGH: the username still reads as staging; the socket goes somewhere else entirely. */
const LOCALHOST_REDIRECT = `postgresql://postgres.${STAGING}:pw@${HOST}:5432/postgres?host=127.0.0.1`;

function secretsFile(name: string, lines: Record<string, string>): string {
  const file = join(dir, `${name}.env`);
  writeFileSync(file, Object.entries(lines).map(([k, v]) => `${k}=${v}`).join('\n'));
  return file;
}

function cwdWith(envLocal: Record<string, string>): string {
  const cwd = mkdtempSync(join(tmpdir(), 'target-cwd-'));
  mkdirSync(join(cwd, 'supabase', 'migrations'), { recursive: true });
  copyFileSync(
    join(process.cwd(), 'supabase', 'migrations', MIGRATION),
    join(cwd, 'supabase', 'migrations', MIGRATION),
  );
  writeFileSync(
    join(cwd, '.env.local'),
    `${Object.entries(envLocal).map(([k, v]) => `${k}=${v}`).join('\n')}\n`,
  );
  return cwd;
}

const TRUE_LISTS = {
  NEXT_BAR_PRODUCTION_PROJECT_REF: PROD,
  NEXT_BAR_STAGING_PROJECT_REFS: STAGING,
  NEXT_BAR_DEVELOPMENT_PROJECT_REFS: DEV,
};

function runCli(
  script: string,
  args: string[],
  cwd: string,
  env: Record<string, string> = {},
): { status: number; output: string } {
  const repo = process.cwd();
  try {
    const stdout = execFileSync(
      process.execPath,
      [join(repo, 'node_modules/tsx/dist/cli.mjs'), join(repo, script), ...args],
      { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env } },
    );
    return { status: 0, output: stdout };
  } catch (error) {
    const f = error as { status?: number; stdout?: string; stderr?: string };
    return { status: f.status ?? -1, output: `${f.stdout ?? ''}${f.stderr ?? ''}` };
  }
}

const bootstrap = (secrets: string, cwd: string, env: Record<string, string> = {}) =>
  runCli('scripts/apply-migrations.ts', ['--bootstrap', '--secrets-file', secrets], cwd, env);
const whoami = (secrets: string, cwd: string, env: Record<string, string> = {}) =>
  runCli('scripts/db-whoami.mts', ['--secrets-file', secrets], cwd, env);
/** The ORDINARY mode — no --bootstrap. This is `npm run db:migrate`. */
const migrate = (secrets: string, cwd: string, env: Record<string, string> = {}) =>
  runCli('scripts/apply-migrations.ts', ['--secrets-file', secrets], cwd, env);

const targeting = (url: string, extra: Record<string, string> = {}) => secretsFile(
  `t-${Math.random().toString(36).slice(2)}`,
  { DATABASE_URL: url, NEXT_PUBLIC_SUPABASE_URL: `https://${STAGING}.supabase.co`, ...extra },
);

describe('pg is the authority — query-parameter overrides are contradictions', () => {
  it('pg really does resolve these payloads to PRODUCTION (the premise)', () => {
    expect(clientIdentity(USER_OVERRIDE).user).toBe(`postgres.${PROD}`);
    expect(clientIdentity(HOST_OVERRIDE).host).toBe(`db.${PROD}.supabase.co`);
    expect(clientIdentity(ENCODED).user).toBe(`postgres.${PROD}`);
  });

  it('the BOOTSTRAP refuses a ?user= override', () => {
    const r = bootstrap(targeting(USER_OVERRIDE), cwdWith(TRUE_LISTS));
    expect(r.status).not.toBe(0);
    expect(r.output).toContain('[bootstrap-guard]');
  });

  it('the BOOTSTRAP refuses a ?host= override', () => {
    const r = bootstrap(targeting(HOST_OVERRIDE), cwdWith(TRUE_LISTS));
    expect(r.status).not.toBe(0);
    expect(r.output).toContain('[bootstrap-guard]');
  });

  it('the BOOTSTRAP refuses the encoded-username payload', () => {
    const r = bootstrap(targeting(ENCODED), cwdWith(TRUE_LISTS));
    expect(r.status).not.toBe(0);
    expect(r.output).toContain('[bootstrap-guard]');
  });

  it('REFUSES an override that resolves SAFELY: the ambiguity is the defect, not the outcome', () => {
    const cwd = cwdWith(TRUE_LISTS);
    // pg reaches staging, which this tooling is allowed to write to...
    expect(clientIdentity(INVERTED_OVERRIDE).user).toBe(`postgres.${STAGING}`);
    // ...and it is refused anyway, because the string names two projects.
    const r = bootstrap(targeting(INVERTED_OVERRIDE), cwd);
    expect(r.status).not.toBe(0);
    expect(r.output).toMatch(/authority names project nuhqlvneokucxomguxhi, but pg resolves/);
  });

  it('db:whoami refuses them too — the tool that ANSWERS "which database is this"', () => {
    const r = whoami(targeting(USER_OVERRIDE), cwdWith(TRUE_LISTS));
    expect(r.status).toBe(2);
  });

  it('an honest staging target is accepted, and the guard agrees with pg about it', () => {
    const cwd = cwdWith(TRUE_LISTS);
    const secrets = secretsFile('honest', {
      DATABASE_URL: poolerUrl(STAGING),
      NEXT_PUBLIC_SUPABASE_URL: `https://${STAGING}.supabase.co`,
    });
    const r = whoami(secrets, cwd);
    // db:whoami prints its identity line WITH the counts, so an unreachable fixture host cannot
    // show one. What it must not do is refuse: exit 1 "could not connect", never exit 2 REFUSED.
    expect(r.status).toBe(1);
    expect(r.output).toContain('could not connect');
    expect(r.output).not.toContain('REFUSED');
    // The standard to beat: the ref the guard accepted is the one pg would authenticate as.
    expect(clientIdentity(poolerUrl(STAGING)).user).toBe(`postgres.${STAGING}`);
  });
});

describe('classification coherence — read from the file, and it must make sense', () => {
  it('REFUSES when NEXT_BAR_PRODUCTION_PROJECT_REF is absent, even if the rest looks fine', () => {
    // Codex round 2: with the declaration missing and production mistakenly listed as staging, a
    // production target derives as "staging" and would be written to.
    const cwd = cwdWith({ NEXT_BAR_STAGING_PROJECT_REFS: `${STAGING} ${PROD}` });
    const r = bootstrap(targeting(poolerUrl(PROD)), cwd);
    expect(r.status).not.toBe(0);
    expect(r.output).toMatch(/NEXT_BAR_PRODUCTION_PROJECT_REF is not set/);
  });

  it('REFUSES a ref that appears in BOTH lists rather than picking a winner', () => {
    const cwd = cwdWith({
      NEXT_BAR_PRODUCTION_PROJECT_REF: PROD,
      NEXT_BAR_STAGING_PROJECT_REFS: `${STAGING} ${PROD}`,
    });
    const r = bootstrap(targeting(poolerUrl(STAGING)), cwd);
    expect(r.status).not.toBe(0);
    expect(r.output).toMatch(/declared as production AND listed as staging\/development/);
  });

  it('a --secrets-file cannot supply the classification: only the cwd .env.local counts', () => {
    // The secrets file declares a decoy production ref and calls production "staging". The true
    // lists live in the cwd's .env.local, which is the only place the reader looks.
    const cwd = cwdWith(TRUE_LISTS);
    const secrets = targeting(poolerUrl(PROD), {
      NEXT_BAR_PRODUCTION_PROJECT_REF: DECOY,
      NEXT_BAR_STAGING_PROJECT_REFS: PROD,
      NEXT_PUBLIC_SUPABASE_URL: `https://${PROD}.supabase.co`,
    });
    const r = bootstrap(secrets, cwd);
    expect(r.status).not.toBe(0);
    expect(r.output).toContain('[bootstrap-guard]');
  });
});

describe('development is permitted again', () => {
  it('a development ref bootstraps: it gets PAST the guard and dies later on DNS', () => {
    const cwd = cwdWith(TRUE_LISTS);
    const secrets = secretsFile('dev', {
      DATABASE_URL: poolerUrl(DEV),
      NEXT_PUBLIC_SUPABASE_URL: `https://${DEV}.supabase.co`,
    });
    const r = bootstrap(secrets, cwd);
    expect(r.output).not.toContain('[bootstrap-guard]');
    expect(r.status).not.toBe(0);
  }, 60_000);

  it('and db:whoami does not refuse a development ref', () => {
    const cwd = cwdWith(TRUE_LISTS);
    const secrets = secretsFile('dev-whoami', {
      DATABASE_URL: poolerUrl(DEV),
      NEXT_PUBLIC_SUPABASE_URL: `https://${DEV}.supabase.co`,
    });
    const r = whoami(secrets, cwd);
    expect(r.status).toBe(1);
    expect(r.output).not.toContain('REFUSED');
  }, 60_000);
});

describe('the destructive script — scripts/db-reset-staging.mts', () => {
  /**
   * IT HAD ITS OWN CLASSIFICATION READER AND ITS OWN COPY OF THE ROUND-2 DEFECT:
   * `if (productionRef && ref === productionRef)`. An absent NEXT_BAR_PRODUCTION_PROJECT_REF made
   * the production refusal a no-op — in the single script that exists to empty a database. Nothing
   * covered it, because the check sat after a step that needs a live connection, so it was only
   * reachable when a database answered. The read now happens first, on the shared reader.
   */
  const resetScript = (
    cwd: string,
    env: Record<string, string> = {},
    args: string[] = [],
  ) => {
    const repo = process.cwd();
    try {
      execFileSync(
        process.execPath,
        [join(repo, 'node_modules/tsx/dist/cli.mjs'), join(repo, 'scripts/db-reset-staging.mts'), ...args],
        { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env } },
      );
      return { status: 0, output: '' };
    } catch (error) {
      const f = error as { status?: number; stdout?: string; stderr?: string };
      return { status: f.status ?? -1, output: `${f.stdout ?? ''}${f.stderr ?? ''}` };
    }
  };

  /**
   * ROUND 5, HIGH — A REGRESSION THE IN-PROCESS REFACTOR INTRODUCED.
   *
   * Identifying the target in this process means `whoami()` loads the `--secrets-file` with
   * `override: true` into the script's OWN environment. Consent read after that could therefore be
   * supplied by the very file naming the target: a secrets file carrying
   * `HARNESS_DB_WRITE_OK=<staging-ref>` would satisfy the per-act approval the operator is supposed
   * to type, for the one tool that empties a database. The child process that used to answer
   * "which database is this" contained the mutation; nothing does now, so the value is snapshotted
   * at module load.
   *
   * The consent check sits behind the production and staging-label refusals, so this test uses a
   * legitimate staging target: what it pins is that the APPROVAL cannot come from a file.
   */
  it('a --secrets-file cannot grant its own destructive consent', () => {
    const cwd = cwdWith(TRUE_LISTS);
    const secrets = secretsFile('self-consenting', {
      DATABASE_URL: poolerUrl(STAGING),
      NEXT_PUBLIC_SUPABASE_URL: `https://${STAGING}.supabase.co`,
      HARNESS_DB_WRITE_OK: STAGING,
    });
    const r = resetScript(cwd, {}, ['--execute', '--secrets-file', secrets]);
    expect(r.status).toBe(2);
    expect(r.output).toMatch(/--execute requires HARNESS_DB_WRITE_OK/);
    // And it stopped at consent, before the dump step could open anything.
    expect(r.output).not.toContain('STEP 2');
  }, 60_000);

  it('the operator typing it in the SHELL still works', () => {
    // The other half of the proof: a guard that refused everything would pass the test above.
    // Here the shell supplies consent and the run gets past it, dying later for want of a database.
    const cwd = cwdWith(TRUE_LISTS);
    const secrets = secretsFile('shell-consented', {
      DATABASE_URL: poolerUrl(STAGING),
      NEXT_PUBLIC_SUPABASE_URL: `https://${STAGING}.supabase.co`,
    });
    const r = resetScript(cwd, { HARNESS_DB_WRITE_OK: STAGING }, ['--execute', '--secrets-file', secrets]);
    expect(r.output).not.toMatch(/--execute requires HARNESS_DB_WRITE_OK/);
  }, 60_000);

  it('REFUSES to run at all when no production ref is declared', () => {
    const cwd = cwdWith({ NEXT_BAR_STAGING_PROJECT_REFS: STAGING });
    const r = resetScript(cwd, { HARNESS_DB_WRITE_OK: STAGING });
    expect(r.status).toBe(2);
    expect(r.output).toMatch(/NEXT_BAR_PRODUCTION_PROJECT_REF is not set/);
    // And it stopped BEFORE identifying anything, so nothing was connected to.
    expect(r.output).not.toContain('STEP 1');
  });

  it('REFUSES an incoherent classification (production also listed as staging)', () => {
    const cwd = cwdWith({
      NEXT_BAR_PRODUCTION_PROJECT_REF: PROD,
      NEXT_BAR_STAGING_PROJECT_REFS: `${STAGING} ${PROD}`,
    });
    const r = resetScript(cwd, { HARNESS_DB_WRITE_OK: STAGING });
    expect(r.status).toBe(2);
    expect(r.output).toMatch(/declared as production AND listed as staging\/development/);
  });
});


/**
 * CODEX ROUND 3, THROUGH THE CLI.
 *
 * The unit tests pin the rules; these pin that the RUNNERS enforce them. Round 3's own lesson is
 * why both exist: the rule can be right in the module and absent from the path that opens the
 * connection, and a mutation matrix built on the module alone reports green either way.
 */
describe('R3-1 — an invalid declared production ref must not fail open', () => {
  /**
   * THE EXACT REPRODUCTION. `not-a-project-ref` is in neither list, so the overlap check sees
   * nothing; it equals no real ref, so production falls through to the staging list and derives as
   * "staging". Codex ran this and got PRODUCTION ACCEPTED as "staging".
   *
   * The API URL names PRODUCTION here on purpose: pointed at staging it would be refused by the
   * URL/API pair rule instead, and the test would pass for a reason that is not this defect.
   */
  const BROKEN = {
    NEXT_BAR_PRODUCTION_PROJECT_REF: 'not-a-project-ref',
    NEXT_BAR_STAGING_PROJECT_REFS: `${STAGING} ${PROD}`,
  };
  const atProduction = () => targeting(poolerUrl(PROD), {
    NEXT_PUBLIC_SUPABASE_URL: `https://${PROD}.supabase.co`,
  });

  it('the BOOTSTRAP refuses rather than writing to production as "staging"', () => {
    const r = bootstrap(atProduction(), cwdWith(BROKEN));
    expect(r.status).not.toBe(0);
    expect(r.output).toMatch(/is not a Supabase project ref/);
    expect(r.output).not.toMatch(/derived|staging target accepted/i);
  });

  it('db:whoami refuses it too, with exit 2', () => {
    const r = whoami(atProduction(), cwdWith(BROKEN));
    expect(r.status).toBe(2);
    expect(r.output).toMatch(/is not a Supabase project ref/);
  });

  it('a malformed STAGING ref is refused as well, not only production', () => {
    const r = bootstrap(targeting(poolerUrl(STAGING)), cwdWith({
      NEXT_BAR_PRODUCTION_PROJECT_REF: PROD,
      NEXT_BAR_STAGING_PROJECT_REFS: 'staging',
    }));
    expect(r.status).not.toBe(0);
    expect(r.output).toMatch(/NEXT_BAR_STAGING_PROJECT_REFS contains "staging"/);
  });
});

describe('R3-2 — the libpq environment can move the connection, so it is refused', () => {
  /** pg fills a missing host from PGHOST, so this string reaches PRODUCTION while reading staging. */
  const NO_HOST = `postgresql://postgres.${STAGING}@/postgres`;

  it('the BOOTSTRAP refuses while PGHOST is set, naming the variable', () => {
    const r = bootstrap(targeting(NO_HOST), cwdWith(TRUE_LISTS), {
      PGHOST: `db.${PROD}.supabase.co`,
    });
    expect(r.status).not.toBe(0);
    expect(r.output).toMatch(/PGHOST/);
  });

  it('and refuses PGHOST even on an otherwise honest staging URL', () => {
    const r = bootstrap(targeting(poolerUrl(STAGING)), cwdWith(TRUE_LISTS), {
      PGHOST: `db.${PROD}.supabase.co`,
    });
    expect(r.status).not.toBe(0);
    expect(r.output).toMatch(/PGHOST/);
  });

  it('db:whoami refuses it with exit 2 — the tool that ANSWERS "which database is this"', () => {
    const r = whoami(targeting(poolerUrl(STAGING)), cwdWith(TRUE_LISTS), {
      PGUSER: `postgres.${PROD}`,
    });
    expect(r.status).toBe(2);
    expect(r.output).toMatch(/PGUSER/);
  });

  it('PGSSLROOTCERT is exempt end to end: it names a CA file and cannot move anything', () => {
    // The repo configures pooler TLS with it. A refusal here would refuse the sanctioned
    // production path, so the exemption is wired, not merely unit-tested.
    const r = whoami(targeting(poolerUrl(STAGING)), cwdWith(TRUE_LISTS), {
      PGSSLROOTCERT: 'C:/certs/prod-ca-2021.crt',
    });
    expect(r.status).toBe(1);
    expect(r.output).toContain('could not connect');
    expect(r.output).not.toContain('REFUSED');
  });
});

describe('R3-4 — staging and development may not overlap either', () => {
  it('REFUSES a ref listed as BOTH, instead of deriving "staging" by statement order', () => {
    const r = bootstrap(targeting(poolerUrl(STAGING)), cwdWith({
      NEXT_BAR_PRODUCTION_PROJECT_REF: PROD,
      NEXT_BAR_STAGING_PROJECT_REFS: STAGING,
      NEXT_BAR_DEVELOPMENT_PROJECT_REFS: STAGING,
    }));
    expect(r.status).not.toBe(0);
    expect(r.output).toMatch(/listed as BOTH staging and development/);
  });
});

/**
 * ROUND 4, CRITICAL — THE GUARD USED TO LIVE INSIDE `if (BOOTSTRAP)`.
 *
 * `npm run db:migrate` — no flag, the most ordinary command in the file — reached `new Client` and
 * wrote the ledger having checked no ref, no API pair, no classification, no label, no endpoint and
 * no libpq environment. Every payload the bootstrap refuses walked straight through the door next
 * to it. These drive the unflagged mode, which nothing exercised before.
 */
describe('every mode of apply-migrations is guarded, not just --bootstrap', () => {
  it('REFUSES a production target in the ordinary migrate mode', () => {
    const r = migrate(targeting(poolerUrl(PROD), {
      NEXT_PUBLIC_SUPABASE_URL: `https://${PROD}.supabase.co`,
    }), cwdWith(TRUE_LISTS));
    expect(r.status).not.toBe(0);
    expect(r.output).toContain('[migrate-guard]');
    // Production is reached ONLY through apply-migration-set.ts, which carries the channel-security
    // layer and the ledger checks this script does not.
    expect(r.output).toMatch(/production/i);
  });

  it('REFUSES a ?user= override in the ordinary migrate mode', () => {
    const r = migrate(targeting(USER_OVERRIDE), cwdWith(TRUE_LISTS));
    expect(r.status).not.toBe(0);
    expect(r.output).toContain('[migrate-guard]');
  });

  it('REFUSES startup options in the ordinary migrate mode', () => {
    const r = migrate(targeting(OPTIONS_TENANT), cwdWith(TRUE_LISTS));
    expect(r.status).not.toBe(0);
    expect(r.output).toMatch(/startup options/);
  });

  it('REFUSES a set libpq environment in the ordinary migrate mode', () => {
    const r = migrate(targeting(poolerUrl(STAGING)), cwdWith(TRUE_LISTS), {
      PGHOST: `db.${PROD}.supabase.co`,
    });
    expect(r.status).not.toBe(0);
    expect(r.output).toMatch(/PGHOST/);
  });

  it('an honest staging target still gets PAST the guard and dies later on DNS', () => {
    const r = migrate(targeting(poolerUrl(STAGING)), cwdWith(TRUE_LISTS));
    expect(r.output).not.toContain('[migrate-guard]');
    expect(r.status).not.toBe(0);
  }, 60_000);
});

/**
 * ROUND 4 — THE ENDPOINT IS CERTIFIED, NOT JUST THE PROJECT.
 *
 * `options=reference=<ref>` is Supabase's own pooler tenant selector, and `?host=` moves the socket
 * outright; both leave the username — and therefore the ref — reading exactly as intended. The
 * stricter set-applier had refused them for months; the shared guard had never looked, so the
 * bootstrap and the destructive reset accepted every one of them.
 */
describe('the endpoint is certified for every entry point', () => {
  it('REFUSES options=reference, the pooler tenant selector', () => {
    const r = bootstrap(targeting(OPTIONS_TENANT), cwdWith(TRUE_LISTS));
    expect(r.status).not.toBe(0);
    expect(r.output).toMatch(/startup options/);
  });

  it('REFUSES a ?host= redirect to an address that is not Supabase at all', () => {
    const r = bootstrap(targeting(LOCALHOST_REDIRECT), cwdWith(TRUE_LISTS));
    expect(r.status).not.toBe(0);
    expect(r.output).toMatch(/effective connection host does not match/);
  });

  it('REFUSES a bare non-Supabase host wearing a staging username', () => {
    const bare = `postgresql://postgres.${STAGING}:pw@127.0.0.1:5432/postgres`;
    const r = bootstrap(targeting(bare), cwdWith(TRUE_LISTS));
    expect(r.status).not.toBe(0);
    expect(r.output).toMatch(/not a Supabase pooler host/);
  });

  it('REFUSES a ?port= override, which moves the socket without moving the name', () => {
    const r = bootstrap(targeting(`${poolerUrl(STAGING)}?port=6543`), cwdWith(TRUE_LISTS));
    expect(r.status).not.toBe(0);
    expect(r.output).toMatch(/effective connection port does not match/);
  });

  it('REFUSES a DIRECT db.<ref>.supabase.co target — round 5 withdrew that allowance', () => {
    // Round 4 asked for direct hosts; round 5 showed the ref then comes from DNS rather than from
    // an authenticated username, so a hosts entry can point a staging name at production. The
    // pooler is the only shape where the ref is something the server checks.
    const direct = `postgresql://postgres:pw@db.${STAGING}.supabase.co:5432/postgres`;
    const r = bootstrap(targeting(direct, {
      NEXT_PUBLIC_SUPABASE_URL: `https://${STAGING}.supabase.co`,
    }), cwdWith(TRUE_LISTS));
    expect(r.status).not.toBe(0);
    expect(r.output).toMatch(/not a Supabase pooler host/);
  }, 60_000);
});
