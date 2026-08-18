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
  const { env, ref, productionRef, stagingRefs } = target;

  if (!ref) return 'could not determine the Supabase project ref from DATABASE_URL';

  // Hoisted above the env split: without the production ref, NO label can be
  // verified. For --env production there is nothing to compare against; for
  // any other label there is no way to prove the target is not production.
  if (!productionRef) {
    return `NEXT_BAR_PRODUCTION_PROJECT_REF is not set, so --env ${env} cannot be verified`;
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
  if (!stagingRefs.includes(ref)) {
    return `--env ${env}, but DATABASE_URL's project ref is not in NEXT_BAR_STAGING_PROJECT_REFS`;
  }
  return null;
}
