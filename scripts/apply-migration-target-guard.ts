/**
 * apply-migration-target-guard.ts
 *
 * The one place that decides whether a resolved Supabase project ref is an
 * acceptable target for a given --env label, and (see authorizeMigrationTarget
 * at the bottom) the one place that wires that decision to a real connection.
 * Lives apart from apply-migration-set.ts so it can be tested without importing
 * that script's `main()` or its dotenv loading.
 *
 * FAIL CLOSED IS THE WHOLE POINT. An earlier version compared the ref against
 * `process.env.NEXT_BAR_PRODUCTION_PROJECT_REF ?? ''`. With the variable unset
 * that comparison is always false against a non-empty ref, so `--env staging`
 * silently accepted a DATABASE_URL pointing at PRODUCTION. An unverifiable
 * target is refused; it is never assumed safe.
 */
import { readFileSync } from 'node:fs';
import { Client } from 'pg';

/**
 * A Supabase project ref is exactly 20 lowercase alphanumeric characters.
 * Accepting any alphanumeric string let a placeholder like `production` sit in
 * NEXT_BAR_PRODUCTION_PROJECT_REF, pass validation, and then never equal the
 * real ref - the original fail-open, spelled differently (round-3 panel).
 */
const PROJECT_REF = /^[a-z0-9]{20}$/;

/**
 * The username only carries a project ref on Supabase's shared pooler. On any
 * other server `<role>.<something>` is just a role name, so an allowlisted ref
 * sent to an unrelated host would otherwise be accepted by every check: the
 * ref resolves, and the endpoint agrees with its own URL (round-3 panel, both
 * lanes, the higher-severity one). Requiring the pooler is what makes the
 * username-borne ref mean "this project" again.
 */
const POOLER_HOST_SUFFIX = '.pooler.supabase.com';

export interface MigrationTarget {
  /** The --env label the operator named. */
  env: string;
  /** Supabase project ref resolved from DATABASE_URL. */
  ref: string;
  /** NEXT_BAR_PRODUCTION_PROJECT_REF, '' when unset. */
  productionRef: string;
  /** NEXT_BAR_STAGING_PROJECT_REFS, split and trimmed; empty when unset. */
  stagingRefs: string[];
  /** pg's resolved database name. */
  database: string;
  /** NEXT_BAR_DATABASE_NAME, or the documented default. */
  expectedDatabase: string;
}

/** Returns the refusal reason, or null when the target is verified. */
export function checkMigrationTarget(target: MigrationTarget): string | null {
  const { env } = target;
  // Normalize HERE, not at the call site. A whitespace-only
  // NEXT_BAR_PRODUCTION_PROJECT_REF is not a configured ref: untrimmed it is
  // truthy, so it passes the missing-ref check below and then never equals a
  // real ref, which is the same fail-open this module exists to close. Doing it
  // inside the guard covers every caller rather than one call site.
  const ref = target.ref.trim();
  const productionRef = target.productionRef.trim();
  const stagingRefs = target.stagingRefs.map((value) => value.trim()).filter(Boolean);

  if (!ref) return 'could not determine the Supabase project ref from DATABASE_URL';

  // Hoisted above the env split: without the production ref, NO label can be
  // verified. For --env production there is nothing to compare against; for
  // any other label there is no way to prove the target is not production.
  if (!productionRef) {
    return `NEXT_BAR_PRODUCTION_PROJECT_REF is not set, so --env ${env} cannot be verified`;
  }
  // A malformed value is not a configured one. 'prodref,' (a stray separator,
  // or two refs in the variable that takes one) is truthy and non-empty, so it
  // passes the check above and then never equals a real ref — the same
  // fail-open as an unset variable, wearing a value.
  if (!PROJECT_REF.test(productionRef)) {
    return 'NEXT_BAR_PRODUCTION_PROJECT_REF is not a valid project ref, so it cannot be compared '
      + `against DATABASE_URL's; --env ${env} cannot be verified`;
  }

  if (env === 'production') {
    if (ref !== productionRef) {
      return '--env production, but DATABASE_URL does not point at the production project ref';
    }
    // The database check belongs here TOO, and leaving it to the staging path
    // below put the hole on the most dangerous route (round-4 panel, Codex,
    // HIGH): a production ref reaching a second database inside the production
    // project was accepted by every caller of this shared guard.
    return checkDatabaseName(target.database, target.expectedDatabase, env);
  }

  if (ref === productionRef) {
    return `--env ${env}, but DATABASE_URL points at the PRODUCTION project ref`;
  }
  // Not-production is a weaker claim than is-the-named-staging-target. Skipping
  // the membership check because the list is unset would accept any third
  // database that merely is not production.
  if (stagingRefs.length === 0) {
    return `NEXT_BAR_STAGING_PROJECT_REFS is not set, so --env ${env}'s project ref cannot be verified`;
  }
  const malformed = stagingRefs.filter((value) => !PROJECT_REF.test(value));
  if (malformed.length > 0) {
    return `NEXT_BAR_STAGING_PROJECT_REFS contains a value that is not a project ref: ${
      JSON.stringify(malformed[0])}`;
  }
  if (!stagingRefs.includes(ref)) {
    return `--env ${env}, but DATABASE_URL's project ref is not in NEXT_BAR_STAGING_PROJECT_REFS`;
  }
  return checkDatabaseName(target.database, target.expectedDatabase, env);
}

/**
 * WHICH DATABASE, decided by CONFIGURATION rather than by the URL being asked
 * about. `checkConnectionEndpoint` proves pg resolved the database the URL's
 * path names — self-consistency, which is necessary and not sufficient: a URL
 * whose path simply says `/shadow` agrees with itself, and every other check
 * passes because the project ref, the host and the port are all still the
 * allowlisted ones. If that database carries the pinned migration row, an
 * --execute would downgrade and unrecord an unintended database (round-3 panel,
 * Codex, HIGH). One cluster serves many databases; naming which one is expected
 * is the only thing that can tell them apart.
 *
 * `postgres` is Supabase's database for every project, so it is the default
 * rather than a required variable — a check nobody can run because it needs new
 * configuration is a check that gets deleted. NEXT_BAR_DATABASE_NAME overrides
 * it for a project that genuinely uses another.
 */
export function checkDatabaseName(
  database: string,
  expectedDatabase: string,
  env: string,
): string | null {
  const actual = database.trim();
  const expected = expectedDatabase.trim();
  if (!expected) {
    return `NEXT_BAR_DATABASE_NAME is set but empty, so --env ${env}'s database cannot be verified`;
  }
  if (!actual) return 'could not determine which database DATABASE_URL reaches';
  if (actual !== expected) {
    return `--env ${env}, but DATABASE_URL reaches the database ${JSON.stringify(actual)} `
      + `rather than the expected ${JSON.stringify(expected)}`;
  }
  return null;
}

/** libpq's default when the connection string names no port. */
const DEFAULT_PG_PORT = '5432';
/** Supabase serves every project from `postgres`; NEXT_BAR_DATABASE_NAME overrides it. */
const DEFAULT_DATABASE = 'postgres';

/**
 * The Supabase pooler carries the project ref in the USERNAME as
 * `<role>.<project-ref>`, because the hostname is shared. Taking the last
 * dot-separated piece of any username is not that: a direct (non-pooler) URL
 * yields the role name `postgres`, and a username with no dot at all yields
 * itself, so an arbitrary server reached with the staging ref as its username
 * would have "resolved" to the allowlisted ref. Both cases are UNRESOLVED, and
 * an unresolved ref must reach the guard as '' so it refuses — never as a
 * plausible-looking string that an allowlist could then match.
 */
export function resolveProjectRef(effectiveUser: string): string {
  const parts = effectiveUser.trim().split('.');
  if (parts.length !== 2) return '';
  const [role, ref] = parts;
  if (!role || !PROJECT_REF.test(ref)) return '';
  return ref;
}

/**
 * Refuses when pg's effective endpoint is not the one the connection string's
 * authority names. pg gives query parameters precedence over the authority, so
 * `?host=` / `?port=` (or PGHOST / PGPORT) silently redirect a connection whose
 * username — and therefore whose project ref — still looks allowlisted. The ref
 * check answers "which project", this answers "which endpoint"; verifying the
 * ref for an endpoint nobody inspected is the same fail-open by another route.
 *
 * Empty on either side is UNVERIFIABLE, not "no objection": a host-less
 * authority (`postgres:///db?host=elsewhere`) parses cleanly and would
 * otherwise skip the comparison entirely.
 */
export function checkConnectionEndpoint(
  effective: { host: string; port: string; options: string; database: string },
  authority: { host: string; port: string; database: string },
): string | null {
  const effectiveHost = effective.host.trim();
  const authorityHost = authority.host.trim();
  if (!authorityHost) return 'DATABASE_URL has no host, so the connection target cannot be verified';
  if (!effectiveHost) return 'the effective connection host could not be resolved from DATABASE_URL';
  if (effectiveHost !== authorityHost) {
    return "the effective connection host does not match DATABASE_URL's authority, "
      + 'so the target was overridden by a query parameter';
  }

  if (!effectiveHost.toLowerCase().endsWith(POOLER_HOST_SUFFIX)) {
    return `DATABASE_URL's host is not a Supabase pooler host (${POOLER_HOST_SUFFIX}), so the `
      + 'project ref in its username cannot identify the target';
  }

  // libpq `options` reaches the server in the startup packet, and Supabase's
  // shared pooler documents `options=reference=<project-ref>` as a way to name
  // the tenant. That is a second target selector the ref check never sees - the
  // same channel class as the `?user=` precedence this guard already closed -
  // and PGOPTIONS supplies it without touching DATABASE_URL at all. This tool
  // needs no startup options, so any value is refused rather than parsed.
  if (effective.options.trim()) {
    return 'the connection carries libpq startup options (from DATABASE_URL or PGOPTIONS), which can '
      + 'name a different pooler tenant than the username, so the target cannot be verified';
  }

  const effectivePort = effective.port.trim();
  // An omitted port is not an unknown one: libpq resolves it to 5432, so that
  // is what the operator reading the URL is entitled to assume.
  const authorityPort = authority.port.trim() || DEFAULT_PG_PORT;
  if (!effectivePort) return 'the effective connection port could not be resolved from DATABASE_URL';
  if (effectivePort !== authorityPort) {
    return "the effective connection port does not match DATABASE_URL's authority, "
      + 'so the target was overridden by a query parameter';
  }

  // WHICH PROJECT, WHICH SERVER, and now WHICH DATABASE. The ref and the
  // endpoint together still leave one selector unchecked: a Postgres cluster
  // serves many databases, Supabase supports more than one per project, and
  // `?dbname=` / PGDATABASE override the URL path exactly as `?host=` overrides
  // the authority. Everything above would pass for `.../another_database` on the
  // allowlisted project — and an in-SQL precondition cannot close it either,
  // because a second database holding the same migration row answers every
  // question the SQL can ask (round-1 panel, Codex, HIGH, on the revert runner).
  //
  // An omitted path is UNRESOLVED, not a default worth guessing: libpq falls
  // back to the USERNAME, which on the Supabase pooler is `postgres.<ref>` and
  // is not a database name at all. Refuse rather than infer.
  const effectiveDatabase = effective.database.trim();
  const authorityDatabase = authority.database.trim();
  if (!authorityDatabase) {
    return 'DATABASE_URL names no database, so which database it reaches cannot be verified';
  }
  if (!effectiveDatabase) return 'the effective database could not be resolved from DATABASE_URL';
  if (effectiveDatabase !== authorityDatabase) {
    return "the effective database does not match DATABASE_URL's path, "
      + 'so the target was overridden by a query parameter or PGDATABASE';
  }
  return null;
}

/**
 * The whole target decision, wired: read the environment the caller just
 * loaded, resolve the connection the way pg itself would, and either refuse
 * with a reason or hand back the config that was authorised.
 *
 * WHY THIS LIVES HERE. The pure functions above were shared; the WIRING around
 * them was not. `apply-migration-set.ts` held the only copy, so its sibling
 * `apply-one-migration.mts` reached the database with no guard at all, and the
 * obvious fix - a second copy of the sequence - is the exact failure this
 * module exists to prevent: the round-2 finding set on the set applier was
 * independent parsers of one connection string disagreeing with each other.
 * The ORDER of these refusals is part of the contract too: a wrong target is
 * the more useful error, so it is reported before the TLS resolution.
 *
 * Importing pg here does mean this module is no longer dependency-free. It
 * still imports no SCRIPT - no `main()`, no dotenv, no side effects at import -
 * which is what kept the pure functions testable and still does.
 */
export interface AuthorizedTarget {
  /**
   * Exactly the config the probe was built from. Connect with THIS: rebuilding
   * a client from the connection string alone drops the CA and the explicit
   * ssl, so the guard would have authorised a connection nobody made.
   */
  clientConfig: { connectionString: string; ssl: { rejectUnauthorized: true; ca?: string } };
  /** NEXT_BAR_DATABASE_ENVIRONMENT, which matched the operator's --env. */
  env: string;
  /** pg's own resolution, for the operator-facing report. */
  effective: { user: string; host: string; port: string; database: string };
  ref: string;
}

export type TargetAuthorization =
  | { refusal: string; target: null }
  | { refusal: null; target: AuthorizedTarget };

/**
 * The target line an operator reads, with the role password removed. Shared for
 * the same reason as everything else here: two copies of a redaction is one
 * copy away from a tool that prints a production password into a terminal log.
 */
export function redactUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.username}:***@${parsed.host}${parsed.pathname}`;
  } catch {
    return '<invalid url>';
  }
}

/** The --env label the operator named; every other input comes from the loaded environment. */
export function authorizeMigrationTarget(env: string): TargetAuthorization {
  const refuse = (reason: string): TargetAuthorization => ({ refusal: reason, target: null });

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) return refuse('DATABASE_URL is not set');

  const actualEnv = process.env.NEXT_BAR_DATABASE_ENVIRONMENT;
  if (!actualEnv) {
    return refuse('NEXT_BAR_DATABASE_ENVIRONMENT is not set, so the target cannot be identified');
  }
  // A matching LABEL proves only that the same word was typed in two places
  // (cold panel, Codex, HIGH), which is why it is the FIRST check and not the
  // last one. Everything below verifies the actual Supabase project behind
  // DATABASE_URL, using pg's own resolution rather than the URL authority —
  // query parameters override the authority, which is how the live RLS suite's
  // first guard was bypassable.
  if (actualEnv !== env) {
    return refuse(
      `you named --env ${JSON.stringify(env)} but the loaded environment is `
      + `${JSON.stringify(actualEnv)}.`,
    );
  }

  // TLS IS NOT OPTIONAL for a tool that ships DDL and sends a role password.
  // pg's default when the connection string says nothing is NO TLS at all
  // (connection-parameters.js falls back to defaults.ssl === false), and
  // PGSSLMODE=disable can turn it off from the environment - passing ssl
  // explicitly beats that variable. The CA comes from PGSSLROOTCERT; a
  // connection string naming sslrootcert wins over this config and pg loads that
  // file itself. What this config RESOLVES to is checked below, after the target
  // refusals, because a wrong target is the more useful error to show first.
  const caPath = (process.env.PGSSLROOTCERT ?? '').trim();
  let ca = '';
  if (caPath) {
    try {
      ca = readFileSync(caPath, 'utf8');
    } catch (error) {
      return refuse(`cannot read PGSSLROOTCERT ${caPath}: ${(error as Error).message}`);
    }
  }
  const clientConfig = {
    connectionString: databaseUrl,
    ssl: ca ? { rejectUnauthorized: true as const, ca } : { rejectUnauthorized: true as const },
  };
  // The probe must be built from the SAME config as the connection it authorises,
  // or it is answering a question about a different connection.
  const probe = new Client(clientConfig) as unknown as {
    connectionParameters?: {
      user?: string; host?: string; port?: number | string; options?: string;
      database?: string; ssl?: unknown;
    };
  };
  const effective = {
    user: probe.connectionParameters?.user ?? '',
    host: probe.connectionParameters?.host ?? '',
    port: String(probe.connectionParameters?.port ?? ''),
    database: probe.connectionParameters?.database ?? '',
  };
  const effectiveOptions = probe.connectionParameters?.options ?? '';
  const ref = resolveProjectRef(effective.user);

  // The ref says WHICH PROJECT; the endpoint says WHICH SERVER. Checking only
  // the ref verifies a target the tool never inspected, because pg lets
  // `?host=` / `?port=` override the authority the operator reads.
  let authority: { host: string; port: string; database: string };
  try {
    const parsed = new URL(databaseUrl);
    // `/postgres` -> `postgres`; an empty path stays empty and is refused below.
    authority = {
      host: parsed.hostname,
      port: parsed.port,
      database: decodeURIComponent(parsed.pathname.replace(/^\//, '')),
    };
  } catch {
    return refuse('DATABASE_URL is not a parsable URL, so the connection target cannot be verified');
  }
  const endpointRefusal = checkConnectionEndpoint(
    {
      host: effective.host,
      port: effective.port,
      options: effectiveOptions,
      database: effective.database,
    },
    authority,
  );
  if (endpointRefusal) return refuse(endpointRefusal);

  const productionRef = process.env.NEXT_BAR_PRODUCTION_PROJECT_REF ?? '';
  const stagingRefs = (process.env.NEXT_BAR_STAGING_PROJECT_REFS ?? '')
    .split(',').map((value) => value.trim()).filter(Boolean);
  const refusal = checkMigrationTarget({
    env,
    ref,
    productionRef,
    stagingRefs,
    database: effective.database,
    expectedDatabase: process.env.NEXT_BAR_DATABASE_NAME ?? DEFAULT_DATABASE,
  });
  if (refusal) return refuse(refusal);

  // Node's global kill switch turns tls.connect's default verification off, and
  // pg leaves rejectUnauthorized undefined for sslmode=verify-full, so without
  // this the guard would report a verified peer that nothing verified.
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') {
    return refuse('NODE_TLS_REJECT_UNAUTHORIZED=0 disables certificate verification for the whole '
      + 'process, so the pooler host cannot be authenticated. Unset it and re-run.');
  }

  // sslmode=disable in the connection string still wins over the default above.
  const resolvedSsl = probe.connectionParameters?.ssl as {
    rejectUnauthorized?: boolean; checkServerIdentity?: unknown; ca?: unknown;
  } | false | undefined;
  if (!resolvedSsl) {
    return refuse('DATABASE_URL disables TLS, so the migration and the role password would cross '
      + 'the network in the clear and the pooler host could not be authenticated');
  }
  // ENCRYPTED IS NOT AUTHENTICATED. pg leaves rejectUnauthorized undefined for
  // sslmode=verify-full (tls.connect then verifies by default), but hands back a
  // truthy { rejectUnauthorized: false } for sslmode=no-verify - and under
  // uselibpqcompat for plain require/prefer - while verify-ca replaces
  // checkServerIdentity with a no-op, which keeps the chain but drops the
  // hostname. Every one of those is a certificate that proves nothing about WHO
  // answered, and this guard's whole identity chain (the .pooler.supabase.com
  // suffix, the ref in the username) is strings the operator wrote. The
  // certificate is what makes the peer behind that name actually Supabase.
  if (resolvedSsl.rejectUnauthorized === false
    || typeof resolvedSsl.checkServerIdentity === 'function') {
    return refuse('DATABASE_URL turns off peer certificate verification (sslmode=no-verify, '
      + 'verify-ca or a libpq-compat mode), so the pooler host cannot be authenticated and the '
      + 'target could be substituted by whatever answers that name');
  }
  // The pooler's chain is SELF-SIGNED, so "verify against the system store" can
  // never succeed here - proven by pointing the live RLS suite at the real
  // staging pooler with rejectUnauthorized:true: "self-signed certificate in
  // certificate chain". Verification needs Supabase's CA, so ask the RESOLVED
  // config whether it has one rather than whether one was configured: pg merges
  // the parsed connection string OVER this config, and parsing any ssl parameter
  // replaces the whole ssl object - so `?sslmode=verify-full` with PGSSLROOTCERT
  // set silently drops the CA and would die later in the handshake, pointing
  // away from the cause.
  if (!resolvedSsl.ca) {
    return refuse('the connection carries no CA certificate for the pooler, whose chain is '
      + "self-signed. Set PGSSLROOTCERT to Supabase's CA file (dashboard - Settings - Database - "
      + 'SSL configuration). If DATABASE_URL names sslmode or any other ssl parameter, it REPLACES '
      + 'that CA, so the path has to go there too: ?sslmode=verify-full&sslrootcert=<path>.');
  }

  return { refusal: null, target: { clientConfig, env: actualEnv, effective, ref } };
}
