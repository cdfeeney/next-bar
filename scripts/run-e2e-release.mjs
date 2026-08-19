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
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import net from 'node:net';
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
// Each variable is checked the way ITS OWN consumer reads it, because a check
// that is merely equivalent-ish is what lets a false green through.
//
// NEXT_PUBLIC_SUPABASE_URL is read by seven specs (account-delete, claim-handle,
// follow-requests, friends-real, onboarding-identity, suggestions, vibe-vote)
// that each `readFileSync('.env.local')` and apply the regex below themselves,
// then `test.skip` when it does not match. So the gate applies that same regex
// to those same bytes. dotenv is NOT equivalent for this purpose: it accepts an
// `export ` prefix and strips quotes, so `export NEXT_PUBLIC_SUPABASE_URL=...`
// parses fine for dotenv while the specs' regex returns null — preflight passes,
// the seven skip, and the summary line reads like a full pass. The value in the
// shell only is the same hole with a different cause: those specs never look
// there.
//
// NEXT_PUBLIC_SUPABASE_ANON_KEY has no such direct reader. Its consumer is the
// Next build this wrapper spawns, which inherits `process.env` and loads
// `.env.local` itself, so either source genuinely works and demanding the file
// would reject a working configuration.
const SPEC_SUPABASE_URL_RE = /^NEXT_PUBLIC_SUPABASE_URL=(.+)$/m;
const fileEnv = loadEnvFile({ path: '.env.local', quiet: true }).parsed ?? {};
let rawEnvFile = '';
try {
  rawEnvFile = readFileSync('.env.local', 'utf8');
} catch {
  rawEnvFile = '';
}

const missing = [];
if (!SPEC_SUPABASE_URL_RE.test(rawEnvFile)) {
  missing.push('NEXT_PUBLIC_SUPABASE_URL (as a plain KEY=value line in .env.local)');
}
if (!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY && !fileEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
  missing.push('NEXT_PUBLIC_SUPABASE_ANON_KEY (in .env.local or the environment)');
}
if (missing.length > 0) {
  console.error(
    [
      '',
      'npm run test:e2e cannot run. Missing:',
      ...missing.map((entry) => `  - ${entry}`),
      '',
      'NEXT_PUBLIC_SUPABASE_URL must be a plain `KEY=value` line in .env.local:',
      'seven specs read that file directly with /^NEXT_PUBLIC_SUPABASE_URL=(.+)$/m,',
      'so an `export ` prefix, or the value in the shell only, makes them skip',
      'themselves however well dotenv or Next.js copes.',
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

// An unpinned run defaults to port 3000, where `reuseExistingServer` lets a
// second worktree silently ATTACH to the first one's server and test the other
// branch's code — a false green with nothing to notice. Ask the OS for an
// ephemeral port instead. A caller-supplied PLAYWRIGHT_PORT always wins.
// ponytail: there is a race between closing this listener and Next binding the
// port; a retry loop only matters if it ever actually collides.
function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(String(port)));
    });
  });
}

const port = process.env.PLAYWRIGHT_PORT ?? (await freePort());
console.log(`[e2e] PLAYWRIGHT_RELEASE=1 PLAYWRIGHT_PORT=${port} playwright test ${process.argv.slice(2).join(' ')}`);

const cli = createRequire(import.meta.url).resolve('@playwright/test/cli');
const result = spawnSync(process.execPath, [cli, 'test', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, PLAYWRIGHT_RELEASE: '1', PLAYWRIGHT_PORT: port },
});

if (result.error) throw result.error;
// A wrapper that swallowed the exit code would turn a red suite into a green
// gate. `status` is null when the run died on a signal — that is a failure too.
process.exit(result.status ?? 1);
