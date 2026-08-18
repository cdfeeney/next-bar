// This IS `npm run test:e2e` — the standard gate's browser leg, which must run
// against a production build (PLAYWRIGHT_RELEASE=1).
//
// The variable is set here rather than in the command because `VAR=1 cmd` is a
// parse error in PowerShell, this repo's primary shell (CLAUDE.md: "Connor is
// on Windows"). A gate command half the project's shells cannot run is how a
// gate goes unrun, which is the exact failure this goal exists to fix. Use
// `npm run test:e2e:dev` for the dev-server run.
//
// Spawn the CLI through `process.execPath` rather than `npx`/`.bin/playwright`:
// no shell, so no quoting or `.cmd`-spawn platform difference, and extra argv
// (a spec path, `--grep`) passes straight through.
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { config as loadEnvFile } from 'dotenv';

// The gate refuses to run without the Supabase env rather than quietly running
// a smaller suite that reports like the same one.
//
// Measured on 2026-08-18 against a .env.local carrying only PLAYWRIGHT_PORT:
// 446 tests -> 337 passed, 90 skipped, 19 failed. The 90 are specs that gate
// themselves on NEXT_PUBLIC_SUPABASE_URL and skip when it is absent; the 19 are
// data-dependent specs that were never gated, so they failed on assertions
// ("Vibe match card carries no Open · badge") naming nothing like the real
// cause. Neither half says "your environment is not configured", and a
// 0-failed-90-skipped run reads exactly like a full pass in a summary line.
// That is this goal's whole subject: a gate is only a gate if it runs the suite
// it claims to.
//
// The check reads `.env.local` and NOT `process.env`, which looks stricter than
// necessary and is not. Seven specs (account-delete, claim-handle,
// follow-requests, friends-real, onboarding-identity, suggestions, vibe-vote)
// each `readFileSync('.env.local')` and regex the value out themselves, then
// `test.skip` when it is absent. Credentials exported into the shell but never
// written to the file satisfy `process.env`, so a preflight honouring it would
// wave the run through while those same specs skip — the exact
// reads-like-a-full-pass outcome this block exists to stop, now with the gate
// asserting it had checked. The consumers' source of truth is the file, so the
// gate's has to be the file too.
const REQUIRED_ENV = ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'];
const fileEnv = loadEnvFile({ path: '.env.local', quiet: true }).parsed ?? {};
const missing = REQUIRED_ENV.filter((key) => !fileEnv[key]);
if (missing.length > 0) {
  console.error(
    [
      '',
      `npm run test:e2e cannot run: ${missing.join(', ')} missing from .env.local.`,
      '',
      'Exporting them into the shell is not enough: seven specs read .env.local',
      'directly and skip themselves when the value is not in that file.',
      '',
      'Without them ~90 specs skip themselves and ~19 more fail on assertions that do',
      'not name the cause, so the run is not the gate.',
      '',
      'Copy the values into .env.local (see .env.example, and keep any PLAYWRIGHT_PORT',
      'line already there), then re-run.',
      '',
    ].join('\n'),
  );
  process.exit(1);
}

const cli = createRequire(import.meta.url).resolve('@playwright/test/cli');
const result = spawnSync(process.execPath, [cli, 'test', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, PLAYWRIGHT_RELEASE: '1' },
});

if (result.error) throw result.error;
// A wrapper that swallowed the exit code would turn a red suite into a green
// gate. `status` is null when the run died on a signal — that is a failure too.
process.exit(result.status ?? 1);
