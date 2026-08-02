/**
 * Deployment environment identity — scripts-side mirror of
 * src/lib/environment.ts (goal g-a5ec7d32).
 *
 * DELIBERATE DUPLICATION: scripts/ must stay dependency-free and runnable by
 * bare node (no bundler, no TS), while src/ is app code. The two are pinned to
 * IDENTICAL behavior by a shared test table — see
 * scripts/lib/environmentIdentity.test.ts, which imports both and asserts they
 * agree on every case. Change one, change the other, or the table fails.
 */

export const DEPLOY_ENVIRONMENTS = ['local', 'preview', 'staging', 'production'];

/** absent/blank → local; 'development' → local; unrecognized → 'unknown'. */
export function normalizeEnvironment(raw) {
  const value = String(raw ?? '').trim().toLowerCase();
  if (value === '') return 'local';
  if (value === 'development') return 'local';
  return DEPLOY_ENVIRONMENTS.includes(value) ? value : 'unknown';
}

/**
 * VERCEL_TARGET_ENV → VERCEL_ENV → 'local'. A present-but-unrecognized primary
 * returns 'unknown' and does NOT fall through (see src/lib/environment.ts for
 * the full rationale).
 */
export function resolveEnvironment(env) {
  const primary = String(env.VERCEL_TARGET_ENV ?? '').trim();
  if (primary !== '') return normalizeEnvironment(primary);
  const fallback = String(env.VERCEL_ENV ?? '').trim();
  if (fallback !== '') return normalizeEnvironment(fallback);
  return 'local';
}

export function isDeployedEnvironment(value) {
  return value === 'preview' || value === 'staging' || value === 'production';
}
