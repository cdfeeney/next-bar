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

const argEnv = process.argv.indexOf('--environment');
const environment = argEnv !== -1 ? process.argv[argEnv + 1] : (process.env.VERCEL_ENV ?? 'local');

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
