/**
 * Every refusal that decides WHICH database `apply-migration-set.ts` is about to
 * write to, in one pure function.
 *
 * It lives here rather than inline in the script because the script calls
 * `main()` at import time and opens a `pg` connection: the guard that matters
 * most on the live-revenue path was the one part of it no test could reach.
 *
 * It opens no socket and reads no file — the caller loads the files and passes what it found. It is
 * NOT pure, and that is the point: `resolveIdentity` constructs a `pg.Client` and inspects the
 * libpq environment, because the only honest answer to "what will this connect to" comes from the
 * object that will connect. A version of this module that modelled the input instead was
 * bypassable three times.
 *
 * THE LABEL IS DERIVED FROM THE PROJECT REF. NOTHING ELSE GETS A VOTE.
 *
 * This function used to trust `NEXT_BAR_DATABASE_ENVIRONMENT` and merely check it against `--env`.
 * That is the defect class that destroyed the staging project on 2026-08-28, and it was caught
 * again the same day by `db:whoami`'s first acceptance run: `.env.staging.local` carried a
 * connection string and NO label, dotenv's `override: false` let `.env.local` supply the word, and
 * the staging project reported itself as `production`. Under the old rule
 * `--env production --execute` would have been ACCEPTED while pointed at staging, and
 * `--env staging` REFUSED — the guard inverted by file layout alone, with nothing typed wrong.
 *
 * So the ref decides. `NEXT_BAR_PRODUCTION_PROJECT_REF` and `NEXT_BAR_STAGING_PROJECT_REFS` are
 * operator-set in the repo-root `.env.local` and are the only classification input; the caller
 * reads them from that FILE, never from `process.env`, so a `--secrets-file` cannot supply or
 * shadow them. `NEXT_BAR_DATABASE_ENVIRONMENT` keeps exactly one power: to CONTRADICT the ref,
 * which is a refusal.
 *
 * The old secrets-file pairing rules are GONE, deliberately. They existed to stop a URL from one
 * file marrying a label from another; with the label derived from the ref there is no marriage to
 * police, and keeping them would refuse the legitimate case this repo actually has — a secrets file
 * that supplies a connection string and lets everything else fall through.
 */

import { Client } from 'pg';

export class TargetRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TargetRefusal';
  }
}

export interface Classification {
  /** `NEXT_BAR_PRODUCTION_PROJECT_REF` from the repo-root `.env.local` FILE. MANDATORY. */
  productionRef: string | null;
  /** `NEXT_BAR_STAGING_PROJECT_REFS` from the same file, split on commas/whitespace. */
  stagingRefs: string[];
  /** `NEXT_BAR_DEVELOPMENT_PROJECT_REFS`, optional — bootstrap has always permitted development. */
  developmentRefs?: string[];
}

export interface TargetInput {
  /** The `--env` label the operator named on the command line. */
  env: string;
  /** `process.env.DATABASE_URL` snapshotted BEFORE any dotenv load ran. */
  shellDatabaseUrl: string | undefined;
  /** `process.env.NEXT_BAR_DATABASE_ENVIRONMENT` snapshotted BEFORE any dotenv load ran. */
  shellDeclaredEnv: string | undefined;
  /** `process.env.DATABASE_URL` after every load. */
  databaseUrl: string | undefined;
  /** `process.env.NEXT_PUBLIC_SUPABASE_URL` after every load. */
  apiUrl: string | undefined;
  /** `process.env.NEXT_BAR_DATABASE_ENVIRONMENT` after every load. */
  actualEnv: string | undefined;
  /** Operator-set project lists, read from the repo-root `.env.local` FILE. */
  classification: Classification;
}

function refuse(message: string): never {
  throw new TargetRefusal(message);
}

/**
 * WHAT WILL THIS CONNECTION STRING ACTUALLY CONNECT TO? ASK THE CLIENT, NOT A PARSER.
 *
 * THREE EARLIER VERSIONS OF THIS FUNCTION WERE BYPASSABLE, ALL FOR ONE REASON: they answered a
 * question about a MODEL of the input instead of about the object that opens the socket.
 *
 *   v1 regex-scanned the whole string. A percent-encoded production username plus
 *   `?application_name=postgres.<staging-ref>:` read as staging while pg connected to production.
 *
 *   v2 parsed canonically with `new URL()` and IGNORED SEARCH PARAMS, on the reasoning that nothing
 *   in a query string could name a project. False: `pg-connection-string` reads query parameters
 *   FIRST and lets `?user=` override the authority username, and `?host=` override the host.
 *
 *   v3 called `pg-connection-string.parse()` — closer, and still wrong, because THAT IS NOT WHAT
 *   `pg.Client` RESOLVES. The Client parses the string and then fills anything the string left out
 *   from the libpq environment (`pg/lib/connection-parameters.js`). So
 *   `postgresql://postgres.<staging>@/postgres` with `PGHOST=db.<production>.supabase.co` parsed as
 *   staging and connected to production, and the tests agreed with the guard because they asked
 *   `parse()` too. A shared wrong oracle is worse than no oracle: it makes the matrix green.
 *
 * So identity now comes from `new Client({ connectionString }).connectionParameters` — the same
 * object, built the same way, that the connection is made from. No socket is opened; the Client
 * resolves its parameters at construction, which is exactly the step that has to be matched.
 *
 * The URL authority is still read, for one purpose only: to CONTRADICT. If either half of the
 * authority names a different project than the Client resolves, that is a refusal, not an input to
 * reconcile — which turns every `?user=` / `?host=` override from a bypass into a loud stop.
 */
/**
 * WHAT WAS CERTIFIED, AND WHAT TO CONNECT WITH.
 *
 * Round 4 found the gap this type closes: `db-reset-staging` and `db-dump` certified one snapshot
 * of a secrets file and then RE-READ that file to build the client that actually connected, so an
 * edit landing between the two — or simply a second dotenv load resolving differently — meant the
 * evidence described one project and the socket went to another. The certification therefore hands
 * back the exact string it certified; callers connect with THAT and never re-read anything.
 */
export interface CertifiedTarget {
  /** The exact connection string this certification is about. Connect with this, nothing else. */
  connectionString: string;
  /** The project ref pg will actually authenticate as / connect to. */
  ref: string;
  /** What the Client resolved, for messages and for tests that compare against pg directly. */
  user: string | null;
  host: string | null;
  port: number | null;
  /** Derived from the operator's classification. Null until `resolveTarget` fills it in. */
  label: string | null;
}

/**
 * A Supabase project ref is exactly 20 lowercase alphanumeric characters.
 *
 * This is the same constant as `apply-migration-target-guard.ts:25`, and round 3 found it had NOT
 * been carried into this module: a declared ref of `not-a-project-ref` passed the emptiness and
 * overlap checks, then equalled no real ref, and the project it was meant to name derived from
 * whichever list it was absent from. A validator that accepts a value which can never match is a
 * fail-open with a checkmark next to it.
 */
const PROJECT_REF = /^[a-z0-9]{20}$/;

/** The shared Supabase pooler. The ref lives in the USERNAME here, because the host is shared. */
const POOLER_HOST_SUFFIX = '.pooler.supabase.com';

/** libpq's default when the connection string names no port. */
const DEFAULT_PG_PORT = '5432';

/**
 * WHICH SERVER — as opposed to WHICH PROJECT. Moved here from apply-migration-target-guard.ts,
 * where it was the only copy and guarded only `apply-migration-set.ts`.
 *
 * Round 4, two CRITICALs and a HIGH, all one omission: the shared guard certified the project ref
 * and never looked at the endpoint, so `?options=reference=<production-ref>` (the pooler's own
 * tenant selector), `?host=127.0.0.1`, and a bare non-Supabase host all passed a bootstrap while
 * the guard reported staging. The stricter layer had refused every one of them for months. The ref
 * says which PROJECT; this says which SERVER, and certifying one without the other is the same
 * fail-open by another route.
 *
 * Empty on either side is UNVERIFIABLE, not "no objection": a host-less authority
 * (`postgres:///db?host=elsewhere`) parses cleanly and would otherwise skip the comparison.
 */
export function checkConnectionEndpoint(
  effective: { host: string; port: string; options: string },
  authority: { host: string; port: string },
): string | null {
  const effectiveHost = effective.host.trim();
  const authorityHost = authority.host.trim();
  if (!authorityHost) return 'DATABASE_URL has no host, so the connection target cannot be verified';
  if (!effectiveHost) return 'the effective connection host could not be resolved from DATABASE_URL';
  if (effectiveHost !== authorityHost) {
    return "the effective connection host does not match DATABASE_URL's authority, "
      + 'so the target was overridden by a query parameter';
  }

  // TWO shapes are legitimate, and only two: the shared pooler, where the ref is in the username,
  // and a DIRECT `db.<ref>.supabase.co`, where the ref is the host. Anything else is a server this
  // tooling cannot identify, however Supabase-looking the username is.
  const lower = effectiveHost.toLowerCase();
  if (!lower.endsWith(POOLER_HOST_SUFFIX) && refFromHost(lower) === null) {
    return `DATABASE_URL's host is not a Supabase pooler host (${POOLER_HOST_SUFFIX}) or a direct `
      + 'db.<ref>.supabase.co host, so the project ref in its username cannot identify the target';
  }

  // libpq `options` reaches the server in the startup packet, and Supabase's shared pooler
  // documents `options=reference=<project-ref>` as a way to name the tenant. That is a SECOND
  // target selector the ref check never sees — the same channel class as the `?user=` precedence
  // already closed here — and PGOPTIONS supplies it without touching DATABASE_URL at all. This
  // tooling needs no startup options, so any value is refused rather than parsed.
  if (effective.options.trim()) {
    return 'the connection carries libpq startup options (from DATABASE_URL or PGOPTIONS), which can '
      + 'name a different pooler tenant than the username, so the target cannot be verified';
  }

  const effectivePort = effective.port.trim();
  // An omitted port is not an unknown one: libpq resolves it to 5432, so that is what the operator
  // reading the URL is entitled to assume.
  const authorityPort = authority.port.trim() || DEFAULT_PG_PORT;
  if (!effectivePort) return 'the effective connection port could not be resolved from DATABASE_URL';
  if (effectivePort !== authorityPort) {
    return "the effective connection port does not match DATABASE_URL's authority, "
      + 'so the target was overridden by a query parameter';
  }
  return null;
}

/**
 * The libpq environment can supply any parameter the connection string omits, so with any of it set
 * THE STRING IS NOT THE TARGET. Rather than model which variables move a connection — modelling is
 * what was wrong three times above — this refuses all of them and names what it found.
 *
 * PGSSLROOTCERT is the single exemption: it names a CA FILE and cannot name a project or a host, and
 * it is how this repo configures pooler TLS (`apply-migration-target-guard.ts:260`). Refusing it
 * would refuse the sanctioned production path in exchange for no safety at all.
 *
 * Matched case-INSENSITIVELY: Windows resolves `process.env.PGHOST` against a variable spelled
 * `pghost`, so a case-sensitive scan would miss exactly the platform this runs on.
 */
const PG_ENV_EXEMPT = new Set(['PGSSLROOTCERT']);

function assertNoLibpqEnvironment(): void {
  const found = Object.keys(process.env)
    .filter((key) => /^pg/i.test(key)
      && !PG_ENV_EXEMPT.has(key.toUpperCase())
      && (process.env[key] ?? '') !== '')
    .sort();
  if (found.length > 0) {
    throw new TargetRefusal(
      `libpq environment variables are set (${found.join(', ')}), so the connection string is not `
      + 'the whole target: pg fills anything the string omits from these, and this guard will not '
      + 'certify a target the environment can still move. Unset them and re-run.',
    );
  }
}

function refFromUser(user: string | null | undefined): string | null {
  if (!user) return null;
  const dot = user.indexOf('.');
  if (dot <= 0 || user.slice(0, dot) !== 'postgres') return null;
  const ref = user.slice(dot + 1).toLowerCase();
  return /^[a-z0-9]{16,}$/.test(ref) ? ref : null;
}

function refFromHost(host: string | null | undefined): string | null {
  if (!host) return null;
  const m = /^(?:db\.)?([a-z0-9]{16,})\.supabase\.(?:co|net)$/.exec(host.toLowerCase());
  return m ? m[1] : null;
}

/**
 * The project this connection string REALLY reaches, according to the client that will reach it.
 *
 * Throws TargetRefusal when identity cannot be established, or when the URL authority and the
 * Client's resolution disagree. There is no null return: a target nobody can identify is a stop.
 */
export function resolveIdentity(connectionString: string | undefined): CertifiedTarget {
  if (!connectionString) throw new TargetRefusal('no connection string was supplied');
  assertNoLibpqEnvironment();

  // `connectionParameters` is populated by the constructor and is not in pg's public types. No
  // network call happens here — this is parameter resolution, the step that decides the target.
  let resolved: {
    user?: string | null; host?: string | null; port?: number | string | null; options?: string | null;
  };
  try {
    resolved = (new Client({ connectionString }) as unknown as {
      connectionParameters: {
        user?: string | null; host?: string | null; port?: number | string | null;
        options?: string | null;
      };
    }).connectionParameters;
  } catch (error) {
    throw new TargetRefusal(
      'pg cannot resolve this connection string, so what it would connect to is unknown: '
      + `${(error as Error).message}`,
    );
  }

  const resolvedUser = resolved.user ?? null;
  const resolvedHost = resolved.host ?? null;
  const resolvedPort = String(resolved.port ?? '');

  // THE ENDPOINT IS CERTIFIED BEFORE THE PROJECT IS. A ref verified for a server nobody inspected
  // is the round-4 fail-open: `?options=reference=<other-ref>` and `?host=` both move the
  // connection while leaving the username — and therefore the ref — reading exactly as intended.
  let authority: { host: string; port: string };
  try {
    const url = new URL(connectionString);
    authority = { host: url.hostname, port: url.port };
  } catch {
    throw new TargetRefusal(
      'DATABASE_URL is not a parseable URL, so the connection endpoint cannot be verified',
    );
  }
  const endpointRefusal = checkConnectionEndpoint(
    { host: resolvedHost ?? '', port: resolvedPort, options: resolved.options ?? '' },
    authority,
  );
  if (endpointRefusal) throw new TargetRefusal(endpointRefusal);
  const byUser = refFromUser(resolvedUser);
  const byHost = refFromHost(resolvedHost);
  const ref = byUser ?? byHost;
  if (!ref) {
    throw new TargetRefusal(
      'could not determine a Supabase project ref from what pg resolved '
      + `(user=${resolvedUser ?? 'none'}, host=${resolvedHost ?? 'none'}) — refusing to guess`,
    );
  }
  // Both present and disagreeing is itself a contradiction: `?host=` pointing elsewhere than the
  // username is exactly the override this guard exists to catch.
  //
  // SUBSUMED since round 4, kept deliberately: the endpoint rule forces pg's host to equal the
  // authority's, so this and the authority comparison below now refuse exactly the same payloads
  // and neither can go red alone. It stays as the cheaper, more direct statement of the rule; its
  // matrix row is retired rather than left printing NOT PINNED.
  if (byUser && byHost && byUser !== byHost) {
    throw new TargetRefusal(
      `pg would authenticate as project ${byUser} while connecting to host for ${byHost} — `
      + 'these must name one project',
    );
  }

  // THE AUTHORITY IS COMPARED, NEVER TRUSTED. Its only job is to disagree.
  //
  // BOTH halves are compared. `authorityRef = byUser ?? byHost` collapsed the pair, so an authority
  // host naming another project was never read whenever the username carried a ref (round 3).
  let authorityRefs: Array<string | null> = [];
  try {
    const url = new URL(connectionString);
    authorityRefs = [refFromUser(decodeURIComponent(url.username || '')), refFromHost(url.hostname)];
  } catch {
    authorityRefs = []; // pg accepts some strings new URL() does not; pg's answer still governs.
  }
  for (const authorityRef of authorityRefs) {
    if (authorityRef && authorityRef !== ref) {
      throw new TargetRefusal(
        `the connection string's authority names project ${authorityRef}, but pg resolves `
        + `${ref} (user=${resolvedUser ?? 'none'}, host=${resolvedHost ?? 'none'}). A query parameter `
        + 'that overrides the user or host is a contradiction, not a target.',
      );
    }
  }

  return {
    connectionString,
    ref,
    user: resolvedUser,
    host: resolvedHost,
    port: resolvedPort ? Number(resolvedPort) : null,
    label: null,
  };
}

/**
 * Back-compatible name. Every caller wants the ref pg will really use.
 */
export function parseRef(connectionString: string | undefined): string {
  return resolveIdentity(connectionString).ref;
}

/**
 * The project ref out of an API URL — HOSTNAME ONLY.
 *
 * An API URL has no username to carry a ref, so accepting one there would re-open the door this
 * pair was rewritten to close. Search parameters are ignored here too; this is a browser URL, not a
 * connection string, and nothing overrides its host.
 */
export function parseApiRef(value: string | undefined): string {
  if (!value) throw new TargetRefusal('NEXT_PUBLIC_SUPABASE_URL is not set');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TargetRefusal('NEXT_PUBLIC_SUPABASE_URL is not a parseable URL');
  }
  const ref = refFromHost(url.hostname);
  if (ref) return ref;
  throw new TargetRefusal(
    `could not determine a Supabase project ref from the API URL host "${url.hostname}"`,
  );
}

/**
 * production | staging | development | null — and the lists must be COHERENT before any of it counts.
 *
 * THE MANDATORY DECLARATION IS BACK, and removing it was a real defect rather than dead-code
 * cleanup. Codex, round 2: with `NEXT_BAR_PRODUCTION_PROJECT_REF` absent and production mistakenly
 * listed under the staging refs, production derives as "staging" and the bootstrap accepts it. The
 * old `assertNonProductionBootstrapTarget` demanded a declared production ref precisely to stop an
 * undeclared denylist degrading into trusting whatever the lists happened to say; that demand now
 * lives here, where the lists are read.
 *
 * A ref in BOTH lists is a refusal, not a precedence puzzle. Answering "production wins" would let
 * a misconfigured file quietly downgrade to whichever answer the reader assumed.
 */
export function assertCoherentClassification(classification: Classification): void {
  if (!classification.productionRef) {
    throw new TargetRefusal(
      'NEXT_BAR_PRODUCTION_PROJECT_REF is not set in the repo-root .env.local. It is mandatory: '
      + 'without it a project listed under the staging or development refs by mistake would derive '
      + 'as safe and be written to. It is an identifier, not a secret.',
    );
  }

  // SYNTAX BEFORE SEMANTICS. An ill-formed declaration is checked against nothing and equals
  // nothing: with `NEXT_BAR_PRODUCTION_PROJECT_REF=not-a-project-ref` and the real production ref
  // sitting in the staging list by mistake, the overlap check below sees no overlap and production
  // derives as "staging". That is round 2's defect reopened through a value that merely LOOKS
  // declared, which is why this runs first and covers every list rather than just production.
  const declared: Array<readonly [string, string]> = [
    ['NEXT_BAR_PRODUCTION_PROJECT_REF', classification.productionRef],
    ...classification.stagingRefs.map((ref) => ['NEXT_BAR_STAGING_PROJECT_REFS', ref] as const),
    ...(classification.developmentRefs ?? [])
      .map((ref) => ['NEXT_BAR_DEVELOPMENT_PROJECT_REFS', ref] as const),
  ];
  for (const [source, ref] of declared) {
    if (!PROJECT_REF.test(ref)) {
      throw new TargetRefusal(
        `${source} contains ${JSON.stringify(ref)}, which is not a Supabase project ref (exactly 20 `
        + 'lowercase alphanumeric characters). A malformed ref can never equal a real one, so it '
        + 'silently disables the comparison it was written for instead of failing.',
      );
    }
  }

  const staging = classification.stagingRefs;
  const development = classification.developmentRefs ?? [];
  if ([...staging, ...development].includes(classification.productionRef)) {
    throw new TargetRefusal(
      `${classification.productionRef} is declared as production AND listed as staging/development. `
      + 'A ref in two lists is a misconfiguration, and this refuses rather than picking a winner.',
    );
  }

  // The same rule, applied to the pair the production check never looked at. A ref in both of these
  // derived "staging" purely because that branch is written first, so the destructive staging reset
  // would have accepted a development target on the strength of statement order.
  const inBoth = staging.filter((ref) => development.includes(ref));
  if (inBoth.length > 0) {
    throw new TargetRefusal(
      `${inBoth.join(', ')} is listed as BOTH staging and development. A ref in two lists is a `
      + 'misconfiguration, and this refuses rather than picking a winner.',
    );
  }
}

export function deriveLabel(ref: string, classification: Classification): string | null {
  assertCoherentClassification(classification);
  if (ref === classification.productionRef) return 'production';
  if (classification.stagingRefs.includes(ref)) return 'staging';
  if ((classification.developmentRefs ?? []).includes(ref)) return 'development';
  return null;
}

export function resolveTarget(input: TargetInput): CertifiedTarget {
  const {
    env, shellDatabaseUrl, shellDeclaredEnv, databaseUrl, apiUrl, actualEnv, classification,
  } = input;

  if (!databaseUrl) refuse('DATABASE_URL is not set');

  // parseRef THROWS TargetRefusal when it cannot establish a ref canonically; there is no null
  // branch to forget. That asymmetry is the fix for the bypass: a value nobody can parse is a
  // target nobody can identify, and the only safe answer is to stop rather than carry on.
  const certified = resolveIdentity(databaseUrl);
  const urlRef = certified.ref;

  // A shell DATABASE_URL naming a DIFFERENT project than the loaded one is genuine ambiguity, and
  // this function will not choose between them. (Naming the SAME project is harmless: the ref is
  // the identity, and it agrees.)
  if (shellDatabaseUrl && parseRef(shellDatabaseUrl) !== urlRef) {
    refuse(
      `a DATABASE_URL exported in this shell names ${parseRef(shellDatabaseUrl)} while the loaded `
      + `environment names ${urlRef} — one of them is wrong and this script will not choose`,
    );
  }

  // RULE 1 — the connection string and the API URL must name ONE project, AFTER CANONICAL PARSING.
  // That agreement is the whole identity check: Supabase's pooler hostname is shared across
  // projects, so a mismatched pair is precisely how a connection string ends up carrying another
  // project's identity, and nothing downstream can tell them apart.
  const apiRef = parseApiRef(apiUrl);
  if (urlRef !== apiRef) {
    refuse(
      `DATABASE_URL names ${urlRef} but NEXT_PUBLIC_SUPABASE_URL names ${apiRef}. `
      + 'The pooler hostname is shared, so these cannot be told apart by inspection — fix the pair '
      + 'before anything writes to it.',
    );
  }

  // RULE 2 — an unclassified project is not one this tooling may write to.
  const derived = deriveLabel(urlRef, classification);
  if (!derived) {
    refuse(
      `unknown project ${urlRef} — operator must classify it in .env.local via `
      + 'NEXT_BAR_PRODUCTION_PROJECT_REF or NEXT_BAR_STAGING_PROJECT_REFS before it can be written to',
    );
  }

  // RULE 3 — the declared label may not contradict the ref, from EITHER source. The shell value is
  // checked separately because a `--secrets-file` loads with `override: true` and would otherwise
  // silently correct a human who exported the wrong label instead of refusing.
  for (const [source, value] of [
    ['shell', shellDeclaredEnv],
    ['loaded environment', actualEnv],
  ] as const) {
    if (value && value.trim().toLowerCase() !== derived) {
      refuse(
        `NEXT_BAR_DATABASE_ENVIRONMENT in the ${source} says ${JSON.stringify(value)} but ref `
        + `${urlRef} is ${derived}. The ref decides; the label is only ever able to be wrong.`,
      );
    }
  }

  // AND `--env` must equal the DERIVED label — not the declared one. This is the check that used to
  // compare `--env` against `NEXT_BAR_DATABASE_ENVIRONMENT`, which made the guard only as truthful
  // as whichever file happened to supply that word.
  if (env !== derived) {
    refuse(
      `you named --env ${JSON.stringify(env)} but ref ${urlRef} is ${JSON.stringify(derived)}. `
      + 'The project ref decides which database this is, not the --env flag and not any label.',
    );
  }

  // Returned rather than merely asserted so the caller connects with the EXACT string this
  // function certified — not a re-read of process.env, and not a second dotenv load. Round 4:
  // certifying one snapshot and connecting from another is how the destructive script could have
  // been pointed at production after passing every check.
  return { ...certified, label: derived };
}
