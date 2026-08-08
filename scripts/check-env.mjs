#!/usr/bin/env node
/**
 * Environment preflight for `npm run verify:full`.
 *
 * Two rules govern this file:
 *
 * 1. It NEVER prints a value. Only the variable NAME and whether it is set.
 *    A verification script that echoes configuration is how secrets end up in
 *    CI logs, and CI logs are retained far longer than anyone expects.
 *
 * 2. Missing is a WARNING; malformed is an ERROR. The app is dual-mode and the
 *    production build tolerates absent Supabase publishables — CI builds
 *    without them today. Failing hard on absence would mean the gate could not
 *    run in CI at all, and a gate that cannot run is not a gate. But a variable
 *    that IS set and is obviously wrong (a placeholder left in, a non-https
 *    URL) is a real defect worth failing on, because it will fail confusingly
 *    much later.
 *
 * `--strict` promotes warnings to errors. Use it before a real deploy, where
 * absence genuinely is a defect.
 *
 * Zero runtime dependencies — Node built-ins only.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { REPO_ROOT } from './lib/tier-classify-core.mjs';

const strict = process.argv.slice(2).includes('--strict');

/** Values shipped in `.env.example` that must never survive into a real env. */
const PLACEHOLDERS = [/^your-/i, /^changeme$/i, /^todo$/i, /^xxx+$/i];

const CHECKS = [
  {
    name: 'NEXT_PUBLIC_SUPABASE_URL',
    validate: (v) =>
      /^https:\/\/[^\s/]+\.supabase\.(co|in)$/.test(v)
        ? null
        : 'expected an https://<project>.supabase.co URL',
  },
  {
    name: 'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    validate: (v) => (v.length >= 20 ? null : 'looks truncated (under 20 characters)'),
  },
];

/**
 * Load `.env.local` if present so a local run sees the same values Next.js
 * would. Deliberately minimal: no dependency, no interpolation, no export of
 * anything into a child process.
 */
function readLocalEnv() {
  const file = join(REPO_ROOT, '.env.local');
  if (!existsSync(file)) return {};
  const out = {};
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    out[match[1]] = match[2].trim().replace(/^["'](.*)["']$/, '$1');
  }
  return out;
}

const local = readLocalEnv();
const problems = [];
const missing = [];

for (const check of CHECKS) {
  const raw = process.env[check.name] ?? local[check.name] ?? '';
  const value = String(raw).trim();
  if (value.length === 0) {
    missing.push(check.name);
    continue;
  }
  if (PLACEHOLDERS.some((p) => p.test(value))) {
    problems.push(`${check.name}: still set to a placeholder from .env.example`);
    continue;
  }
  const problem = check.validate(value);
  if (problem) problems.push(`${check.name}: ${problem}`);
}

for (const name of missing) {
  process.stdout.write(`check-env: ${name} is not set${strict ? ' (ERROR under --strict)' : ' (warning)'}\n`);
}
for (const problem of problems) {
  process.stdout.write(`check-env: ${problem}\n`);
}

const failed = problems.length > 0 || (strict && missing.length > 0);
if (failed) {
  process.stderr.write(`check-env: FAILED — ${problems.length} malformed, ${missing.length} missing\n`);
  process.exit(1);
}

process.stdout.write(
  `check-env: OK — ${CHECKS.length - missing.length}/${CHECKS.length} variables set, none malformed\n`,
);
