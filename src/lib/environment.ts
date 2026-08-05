/**
 * Deployment environment identity (goal g-a5ec7d32).
 *
 * WHY VERCEL_TARGET_ENV IS PRIMARY: Vercel reports `VERCEL_ENV='preview'` for
 * custom environments as well as ordinary previews. Reading VERCEL_ENV first
 * therefore identifies a PROTECTED staging target as ordinary preview — and
 * preview is exactly the tier whose rule is "must hold no server-only
 * secrets". Getting this precedence wrong means applying the wrong credential
 * policy to a privileged target. `VERCEL_TARGET_ENV` carries the custom
 * environment's real name, so it decides.
 *
 * WHY UNKNOWN FAILS CLOSED: the previous checker branched on 'production' and
 * 'preview' and consulted a DEPLOYED allow-list; any other string fell through
 * every branch and was treated as non-deployed, silently skipping the required
 * variable checks. A typo'd target (`stg`, `preprod`) is the realistic case,
 * and silence is the wrong answer — 'unknown' is surfaced so the caller can
 * refuse.
 */

export const DEPLOY_ENVIRONMENTS = [
  'local',
  'preview',
  'staging',
  'production',
] as const;

export type DeployEnvironment = (typeof DEPLOY_ENVIRONMENTS)[number];

/** Normalizer output: a recognized identity, or an explicit refusal. */
export type ResolvedEnvironment = DeployEnvironment | 'unknown';

/**
 * Map one raw value to an identity.
 * - absent/blank  → 'local' (a genuinely unset env is local development)
 * - 'development' → 'local' (Vercel's name for the same thing)
 * - unrecognized  → 'unknown' (fail closed; never assume local)
 */
export function normalizeEnvironment(raw: string | undefined | null): ResolvedEnvironment {
  const value = (raw ?? '').trim().toLowerCase();
  if (value === '') return 'local';
  if (value === 'development') return 'local';
  return (DEPLOY_ENVIRONMENTS as readonly string[]).includes(value)
    ? (value as DeployEnvironment)
    : 'unknown';
}

/**
 * Resolve the environment from an env-like object. Pure: reads only what is
 * passed, so tests and the CLI cannot accidentally pick up the ambient shell.
 *
 * Precedence: VERCEL_TARGET_ENV → VERCEL_ENV → 'local'. A PRESENT-but-
 * unrecognized primary returns 'unknown' and deliberately does NOT fall
 * through to the secondary: falling through would let a typo'd target
 * silently inherit a laxer identity, which is the failure this exists to stop.
 */
export function resolveEnvironment(
  env: Record<string, string | undefined>,
): ResolvedEnvironment {
  const primary = (env.VERCEL_TARGET_ENV ?? '').trim();
  if (primary !== '') return normalizeEnvironment(primary);

  const fallback = (env.VERCEL_ENV ?? '').trim();
  if (fallback !== '') return normalizeEnvironment(fallback);

  return 'local';
}

/** True for identities that are real deployments (local is not). */
export function isDeployedEnvironment(value: ResolvedEnvironment): boolean {
  return value === 'preview' || value === 'staging' || value === 'production';
}
