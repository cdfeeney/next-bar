/**
 * apply-migration-target-guard.ts
 *
 * The one place that decides whether a resolved Supabase project ref is an
 * acceptable target for a given --env label. Lives apart from
 * apply-migration-set.ts so it can be tested without importing that script's
 * `main()`, its pg client, or its dotenv loading.
 *
 * FAIL CLOSED IS THE WHOLE POINT. An earlier version compared the ref against
 * `process.env.NEXT_BAR_PRODUCTION_PROJECT_REF ?? ''`. With the variable unset
 * that comparison is always false against a non-empty ref, so `--env staging`
 * silently accepted a DATABASE_URL pointing at PRODUCTION. An unverifiable
 * target is refused; it is never assumed safe.
 */

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
    return null;
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
  return null;
}

/** libpq's default when the connection string names no port. */
const DEFAULT_PG_PORT = '5432';

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
  effective: { host: string; port: string },
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

  if (!effectiveHost.toLowerCase().endsWith(POOLER_HOST_SUFFIX)) {
    return `DATABASE_URL's host is not a Supabase pooler host (${POOLER_HOST_SUFFIX}), so the `
      + 'project ref in its username cannot identify the target';
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
  return null;
}
