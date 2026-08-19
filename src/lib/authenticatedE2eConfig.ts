/**
 * The "run or fail loudly" decision for the authenticated e2e suites
 * (criterion 5), extracted so it can actually be regression-tested.
 *
 * Round 2 (Codex): the guard itself was correct but lived entirely inside
 * `e2e/night-out.spec.ts`, and vitest's include patterns cover `src/**` and
 * `ceo/**` — never `e2e/**`. Playwright runs the spec, but only when someone
 * runs Playwright. So nothing in the default gate could tell you if the guard
 * regressed to a silent skip, which is the precise failure the guard exists to
 * prevent. A protection that no gate observes is a protection with a countdown
 * on it.
 *
 * Both functions are pure — they take the environment rather than reading it —
 * so the test needs no filesystem or process mocking.
 */

/**
 * Environment FIRST, then `.env.local`. A CI runner or shell supplies config
 * through the environment; reading only the dotenv file is what made every
 * authenticated test skip while the suite reported green.
 */
export function resolveSupabaseUrl(
  fromEnv: string | undefined,
  envFileContents: string | null,
): string | null {
  const trimmed = fromEnv?.trim();
  if (trimmed) return trimmed;
  if (envFileContents === null) return null;
  const match = envFileContents.match(/^NEXT_PUBLIC_SUPABASE_URL=(.+)$/m);
  return match ? match[1].trim() : null;
}

/**
 * Absent credentials are a legitimate reason to skip on a CI runner, which has
 * none by design. Anywhere else a missing URL means the authenticated coverage
 * did NOT run, and that must be loud rather than green.
 */
export function authenticatedE2eSkipAllowed(
  env: Record<string, string | undefined>,
): boolean {
  return env.CI === 'true' || env.CI === '1';
}

export function assertAuthenticatedE2eConfigured(
  url: string | null,
  skipAllowed: boolean,
  specName: string,
): void {
  if (url !== null || skipAllowed) return;
  throw new Error(
    `${specName}: no NEXT_PUBLIC_SUPABASE_URL in the environment or .env.local, `
    + 'so the authenticated lifecycle was NOT exercised. Set it, or set CI=1 to '
    + 'acknowledge that this environment cannot run it.',
  );
}
