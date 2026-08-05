#!/usr/bin/env node
/**
 * CLI around scripts/lib/envCheck.mjs.
 *
 *   node scripts/check-env.mjs --environment production
 *
 * Reads process.env, prints findings, exits 1 on anything critical or high.
 * Never prints a VALUE — only names — so it is safe to run in CI logs.
 *
 * NOTE: this reads process.env directly and does NOT load .env.local — that is
 * Next.js's doing, not Node's. Running it bare in a local shell will therefore
 * report the Supabase variables as missing, which is an artifact of how it was
 * invoked rather than a real finding. Its intended homes are CI and a
 * deployment environment, where the variables are genuinely in the process
 * environment. To check a local file, export them into the shell first.
 */
import { checkEnv, isEnvSafe } from './lib/envCheck.mjs';
import { normalizeEnvironment, resolveEnvironment } from './lib/environmentIdentity.mjs';

// Identity: explicit --environment wins (operators check a target by name),
// otherwise VERCEL_TARGET_ENV → VERCEL_ENV → local. Both paths normalize, so
// an unrecognized name is 'unknown' and refuses below rather than silently
// skipping the deployed-environment requirements (goal g-a5ec7d32).
const argEnv = process.argv.indexOf('--environment');
const flagPresent = argEnv !== -1;
const rawEnvironment = flagPresent ? process.argv[argEnv + 1] : null;

// A PRESENT flag with a missing/blank value is a malformed invocation, not a
// request for local (santa: Codex HIGH + Claude LOW, convergent). The realistic
// case is CI running `--environment "$DEPLOY_ENV"` with the variable unset:
// treating that as 'local' skips every deployed-environment requirement and
// exits 0. An explicitly-passed environment must be explicitly valid.
const flagValueMissing =
  flagPresent && (rawEnvironment === undefined || String(rawEnvironment).trim() === '');

const environment = flagValueMissing
  ? 'unknown'
  : flagPresent
    ? normalizeEnvironment(rawEnvironment)
    : resolveEnvironment(process.env);

if (environment === 'unknown') {
  const source = flagValueMissing
    ? '--environment (flag given with no value)'
    : flagPresent
      ? `--environment ${rawEnvironment}`
      : 'VERCEL_TARGET_ENV/VERCEL_ENV';
  console.error(
    `env check: UNKNOWN environment from ${source}.\n` +
      `      Recognized: local (or development), preview, staging, production.\n` +
      `      Refusing rather than guessing — an unrecognized target would skip ` +
      `every deployed-environment requirement.`,
  );
  process.exit(1);
}

const findings = checkEnv(process.env, { environment });

if (findings.length === 0) {
  console.log(`env check (${environment}): clean`);
  process.exit(0);
}

for (const f of findings) {
  console.log(`  [${f.severity.toUpperCase()}] ${f.name}\n      ${f.message}`);
}

const safe = isEnvSafe(findings);
console.log(`\nenv check (${environment}): ${safe ? 'PASS (advisory findings only)' : 'FAIL'}`);
process.exit(safe ? 0 : 1);
