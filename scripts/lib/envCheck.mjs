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

/**
 * Names that are PUBLIC BY DESIGN even though they collide with the
 * `NEXT_PUBLIC_${secret}` construction in rule 1.
 *
 * `GOOGLE_MAPS_API_KEY` (server, Places calls) and
 * `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` (browser, Places UI Kit) are two DIFFERENT
 * keys with different restrictions — the browser one is meant to ship in the
 * bundle. Without this exception the checker manufactured a CRITICAL on every
 * correct production config and told the operator to rotate the wrong key.
 * A checker that cries wolf gets switched off, so this false positive was worse
 * than the leak it was guarding against.
 */
export const PUBLIC_BY_DESIGN = ['NEXT_PUBLIC_GOOGLE_MAPS_API_KEY'];

/** Harness-only flags that must never be ENABLED in a production deployment. */
export const HARNESS_ONLY = ['LOOP_UNATTENDED', 'G4_DUMP'];

/** Required for the app to serve its core surface at all. */
export const REQUIRED_ALWAYS = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
];

/**
 * Environments that are real deployments. `local` is excluded deliberately: the
 * app supports a Supabase-free local mode (the client returns null and the
 * middleware no-ops), so demanding those variables locally fails a config that
 * is valid by design.
 */
const DEPLOYED = ['production', 'preview', 'staging'];

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
  // 1a. VALUE mirror. The PUBLIC_BY_DESIGN exemption below is by NAME, which
  //     leaves one realistic mistake invisible: pasting the SERVER key into the
  //     browser variable. The names are then both legitimate and the value is
  //     still in the bundle.
  //
  //     SCOPE, precisely — this net catches a mirrored value of the three names
  //     in SERVER_ONLY_SECRETS and nothing else. A secret that is not in that
  //     list has nothing to compare against and is invisible here. Do not read
  //     this as "the exemption cannot smuggle a secret"; read it as "the
  //     exemption cannot smuggle one of the three secrets we know about."
  //
  //     Substring, not equality: a key pasted into a longer value
  //     (`?key=<secret>&restrict=none`) is just as exposed as a bare one.
  //     Never print the value itself.
  for (const secret of SERVER_ONLY_SECRETS) {
    if (!present(secret)) continue;
    for (const publicName of PUBLIC_BY_DESIGN) {
      if (present(publicName) && env[publicName].includes(env[secret].trim())) {
        findings.push({
          severity: 'critical',
          name: publicName,
          message:
            `${publicName} holds the SAME VALUE as ${secret}, a server-only secret. ` +
            `A NEXT_PUBLIC_ name is compiled into the browser bundle, so that secret is ` +
            `public. These are meant to be two different keys. Set the browser-restricted ` +
            `key here and ROTATE ${secret}.`,
        });
      }
    }
  }

  for (const secret of SERVER_ONLY_SECRETS) {
    const exposed = `NEXT_PUBLIC_${secret}`;
    if (PUBLIC_BY_DESIGN.includes(exposed)) continue;
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
      // The runtime branches on the exact string '1'. Flagging LOOP_UNATTENDED=0
      // would fail a deploy over a config that is explicitly OFF.
      if (env[flag] === '1') {
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

  // 4. Missing essentials — deployed environments only. Local supports a
  //    Supabase-free mode by design, so requiring them there is a false alarm.
  if (DEPLOYED.includes(environment)) {
    for (const name of REQUIRED_ALWAYS) {
      if (!present(name)) {
        findings.push({
          severity: 'high',
          name,
          message: `${name} is missing. The app cannot reach Supabase without it.`,
        });
      }
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
