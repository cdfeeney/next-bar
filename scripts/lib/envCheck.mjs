/**
 * Environment-variable safety checks (production-readiness goal 10).
 *
 * Pure functions over a plain env object so they are testable without a
 * process. scripts/check-env.mjs is the thin CLI around them.
 *
 * Deliberately a CHECK SCRIPT rather than app-startup validation: adding a
 * throw to the Next.js startup path would turn a missing optional variable
 * into a failed boot or a failed build, which is a worse failure than the one
 * being prevented. This runs in CI and on demand, and says exactly what is
 * wrong without being able to take the app down.
 */

/** Secrets that must never be readable from the browser bundle. */
export const SERVER_ONLY_SECRETS = [
  'SUPABASE_SERVICE_ROLE_KEY',
  'DATABASE_URL',
  'GOOGLE_MAPS_API_KEY',
];

/** Harness-only flags that must never be set in a production deployment. */
export const HARNESS_ONLY = ['LOOP_UNATTENDED', 'G4_DUMP'];

/** Required for the app to serve its core surface at all. */
export const REQUIRED_ALWAYS = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
];

const SEVERITY = { critical: 3, high: 2, medium: 1 };

/**
 * @param {Record<string,string|undefined>} env
 * @param {{ environment?: 'production'|'preview'|'staging'|'local' }} [opts]
 * @returns {{ severity: string, name: string, message: string }[]}
 */
export function checkEnv(env, opts = {}) {
  const environment = opts.environment ?? 'local';
  const findings = [];
  const present = (n) => typeof env[n] === 'string' && env[n].trim() !== '';

  // 1. A server secret exposed under a NEXT_PUBLIC_ name is compiled into the
  //    browser bundle. This is the single worst misconfiguration available,
  //    and it is silent — the app works perfectly while leaking.
  for (const secret of SERVER_ONLY_SECRETS) {
    const exposed = `NEXT_PUBLIC_${secret}`;
    if (present(exposed)) {
      findings.push({
        severity: 'critical',
        name: exposed,
        message:
          `${exposed} is set. A NEXT_PUBLIC_ prefix compiles the value into the ` +
          `browser bundle, so this secret is public. Remove it and ROTATE ${secret}.`,
      });
    }
  }

  // 2. Harness flags in production. LOOP_UNATTENDED makes /api/account/delete
  //    hard-refuse with 503, so users silently lose their deletion right —
  //    a compliance problem that looks like nothing from the outside.
  if (environment === 'production') {
    for (const flag of HARNESS_ONLY) {
      if (present(flag)) {
        findings.push({
          severity: 'critical',
          name: flag,
          message:
            `${flag} must not be set in production.` +
            (flag === 'LOOP_UNATTENDED'
              ? ' /api/account/delete hard-refuses with 503 while it is set, so users cannot delete their accounts.'
              : ''),
        });
      }
    }
  }

  // 3. Preview must never hold production-capable write credentials: preview
  //    URLs are per-PR and effectively public.
  if (environment === 'preview') {
    for (const secret of ['SUPABASE_SERVICE_ROLE_KEY', 'DATABASE_URL']) {
      if (present(secret)) {
        findings.push({
          severity: 'high',
          name: secret,
          message:
            `${secret} is set in a preview environment. Preview deployments are ` +
            'effectively public; a service-role credential there is a full RLS bypass ' +
            'reachable from a link.',
        });
      }
    }
  }

  // 4. Missing essentials.
  for (const name of REQUIRED_ALWAYS) {
    if (!present(name)) {
      findings.push({
        severity: 'high',
        name,
        message: `${name} is missing. The app cannot reach Supabase without it.`,
      });
    }
  }

  // 5. Analytics half-configured: the server gate is on but the client flag is
  //    off (or vice versa) means the App Privacy answer cannot be stated
  //    truthfully, because collection is neither clearly on nor clearly off.
  const serverAnalytics = env.ANALYTICS_ENABLED === '1';
  const clientAnalytics = env.NEXT_PUBLIC_ANALYTICS === '1';
  if (serverAnalytics !== clientAnalytics) {
    findings.push({
      severity: 'medium',
      name: 'ANALYTICS_ENABLED / NEXT_PUBLIC_ANALYTICS',
      message:
        'Analytics flags disagree (server=' +
        `${serverAnalytics}, client=${clientAnalytics}). App Privacy answers require a ` +
        'definite yes or no on Usage Data collection.',
    });
  }

  return findings.sort((a, b) => SEVERITY[b.severity] - SEVERITY[a.severity]);
}

/** True when nothing critical or high was found. */
export function isEnvSafe(findings) {
  return !findings.some((f) => f.severity === 'critical' || f.severity === 'high');
}
